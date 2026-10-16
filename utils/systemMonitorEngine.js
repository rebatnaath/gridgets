import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_ENGINE_POLL_INTERVAL_MS = 2000;
const PROC_NET_DEV_HEADER_LINES_COUNT = 2;
const PROC_NET_DEV_RX_BYTES_INDEX = 0;
const PROC_NET_DEV_TX_BYTES_INDEX = 8;
const MIN_PROC_NET_DEV_FIELDS_COUNT = PROC_NET_DEV_TX_BYTES_INDEX + 1;
const MILLISECONDS_PER_SECOND = 1000;
const MICROSECONDS_TO_MILLISECONDS = 1000;
const KILOBYTES_TO_BYTES = 1024;
const MILLI_UNITS_TO_BASE = 1000;
const SECTOR_BYTES = 512;
const SECONDS_PER_HOUR = 3600;
const HWMON_SEARCH_LIMIT = 8;
const THERMAL_ZONE_SEARCH_LIMIT = 6;
const BATTERY_SEARCH_LIMIT = 3;
const DRM_CARD_SEARCH_LIMIT = 4;
const CPU_HWMON_NAMES = ['k10temp', 'coretemp', 'zenpower', 'cpu_thermal', 'soc_thermal'];
const GPU_HWMON_NAMES = ['amdgpu', 'nouveau', 'i915', 'xe'];
const DISK_COUNTER_FIELDS_COUNT = 10;
const DISK_SECTORS_READ_INDEX = 5;
const DISK_SECTORS_WRITTEN_INDEX = 9;
// Whole block devices only: partitions (sda1, nvme0n1p1) share their parent's
// counters, so summing them too would double-count every byte.
const DISK_DEVICE_NAME_PATTERN = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|hd[a-z]+|mmcblk\d+)$/;

class PollingEngine {
    constructor(intervalMs, fetchFn, resetFn = null) {
        this.intervalMs = intervalMs;
        this.fetchFn = fetchFn;
        this.resetFn = resetFn;
        this.subscribers = [];
        this.timerId = null;
        this.lastData = null;
    }

    subscribe(callback) {
        this.subscribers.push(callback);

        if (this.lastData !== null) {
            callback(this.lastData);
        }

        if (this.subscribers.length === 1) {
            const runFetch = () => {
                if (this.cancellable)
                    this.cancellable.cancel();
                this.cancellable = new Gio.Cancellable();
                const fetchCancellable = this.cancellable;
                this.fetchFn((data) => {
                    if (fetchCancellable.is_cancelled()) return;
                    this.lastData = data;
                    for (const subscriber of [...this.subscribers]) {
                        try {
                            subscriber(data);
                        } catch (error) {
                            console.error('Subscriber callback error:', error);
                        }
                    }
                }, fetchCancellable);
            };

            runFetch();
            this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.intervalMs, () => {
                runFetch();
                return GLib.SOURCE_CONTINUE;
            });
        }

        return () => this.unsubscribe(callback);
    }

    unsubscribe(callback) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
        if (this.subscribers.length === 0)
            this.stop();
    }

    /** Releases the poll regardless of who subscribed, so no teardown path depends on a consumer remembering to unsubscribe. */
    stop() {
        if (this.timerId) {
            GLib.Source.remove(this.timerId);
            this.timerId = null;
        }
        this.lastData = null;
        this.subscribers = [];
        if (this.cancellable) {
            this.cancellable.cancel();
            this.cancellable = null;
        }
        if (this.resetFn)
            this.resetFn();
    }
}

const decoder = new TextDecoder('utf-8');

const PROC_STAT_IDLE_INDEX = 3;
const PROC_STAT_IOWAIT_INDEX = 4;

// Reads a /proc pseudo-filesystem file as UTF-8 text.
function readKernelFileText(filePath, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(filePath).load_contents_async(cancellable, (fileObj, res) => {
            try {
                const [success, contents] = fileObj.load_contents_finish(res);
                resolve(success ? decoder.decode(contents) : '');
            } catch (error) {
                reject(error);
            }
        });
    });
}

// A best-effort read: optional metrics (temperature, battery, GPU) live behind paths
// that may simply not exist, and a missing file is an expected outcome, not a failure.
function readKernelFileTextOrNull(filePath, cancellable) {
    return readKernelFileText(filePath, cancellable).catch(() => null);
}

function parseFirstNumber(text) {
    if (text === null) return null;
    const value = Number.parseFloat(text.trim());
    return Number.isFinite(value) ? value : null;
}

async function readFirstNumber(filePaths, cancellable) {
    for (const filePath of filePaths) {
        const value = parseFirstNumber(await readKernelFileTextOrNull(filePath, cancellable));
        if (value !== null) return value;
    }
    return null;
}

function sumPresent(values) {
    const present = values.filter(value => value !== null);
    return present.length > 0 ? present.reduce((total, value) => total + value, 0) : null;
}

async function findHwmonIndexByName(hwmonNames, cancellable) {
    for (let index = 0; index < HWMON_SEARCH_LIMIT; index++) {
        const name = (await readKernelFileTextOrNull(`/sys/class/hwmon/hwmon${index}/name`, cancellable) || '').trim();
        if (hwmonNames.includes(name)) return index;
    }
    return null;
}

async function readHwmonTemperatureC(hwmonNames, cancellable) {
    const index = await findHwmonIndexByName(hwmonNames, cancellable);
    if (index === null) return null;
    const milliC = await readFirstNumber([`/sys/class/hwmon/hwmon${index}/temp1_input`], cancellable);
    return milliC === null ? null : milliC / MILLI_UNITS_TO_BASE;
}

async function readCpuTemperatureC(cancellable) {
    const hwmonTemp = await readHwmonTemperatureC(CPU_HWMON_NAMES, cancellable);
    if (hwmonTemp !== null) return hwmonTemp;

    for (let index = 0; index < THERMAL_ZONE_SEARCH_LIMIT; index++) {
        const type = await readKernelFileTextOrNull(`/sys/class/thermal/thermal_zone${index}/type`, cancellable);
        if (type && /cpu|pkg_temp|soc|acpitz/i.test(type)) {
            const milliC = await readFirstNumber([`/sys/class/thermal/thermal_zone${index}/temp`], cancellable);
            if (milliC !== null) return milliC / MILLI_UNITS_TO_BASE;
        }
    }
    return null;
}

// /proc/cpuinfo reports one "cpu MHz" line per logical core; the mean is the figure a
// single-number readout wants, and it is the only frequency source common to both the
// intel_pstate and amd_pstate drivers.
function averageCpuFrequencyGhz(cpuinfoText) {
    const matches = [...cpuinfoText.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)];
    if (matches.length === 0) return null;
    const totalMhz = matches.reduce((sum, match) => sum + Number.parseFloat(match[1]), 0);
    return totalMhz / matches.length / MILLI_UNITS_TO_BASE;
}

let prevCpuTotal = 0;
let prevCpuIdle = 0;
let lastCpuProgress = 0;
let lastRamProgress = 0;
let lastMemUsedBytes = 0;
let lastMemTotalBytes = 0;
let lastCpuTempC = null;
let lastCpuFreqGhz = null;

/** Logs a read failure only when it starts, so a persistent error does not spam the journal every poll. */
function logReadFailureOnce(failureState, filePath, error) {
    if (failureState.reported) return;
    failureState.reported = true;
    console.error(`Error reading ${filePath}:`, error);
}

const procStatFailure = { reported: false };
const procMeminfoFailure = { reported: false };
const procNetDevFailure = { reported: false };

async function sampleCpuRamUsage(cancellable) {
    try {
        const statText = await readKernelFileText('/proc/stat', cancellable);
        procStatFailure.reported = false;
        const cpuLineMatch = statText.match(/^cpu\s+(.+)$/m);
        if (cpuLineMatch) {
            const parts = cpuLineMatch[1].trim().split(/\s+/).map(Number);
            const idle = parts[PROC_STAT_IDLE_INDEX] + parts[PROC_STAT_IOWAIT_INDEX];
            const total = parts.reduce((accumulator, value) => accumulator + value, 0);

            if (prevCpuTotal > 0) {
                const deltaTotal = total - prevCpuTotal;
                const deltaIdle = idle - prevCpuIdle;
                if (deltaTotal > 0) {
                    lastCpuProgress = 1.0 - (deltaIdle / deltaTotal);
                }
            }
            prevCpuTotal = total;
            prevCpuIdle = idle;
        }
    } catch (e) {
        logReadFailureOnce(procStatFailure, '/proc/stat', e);
    }

    try {
        const memText = await readKernelFileText('/proc/meminfo', cancellable);
        procMeminfoFailure.reported = false;
        const totalMatch = memText.match(/MemTotal:\s+(\d+)/);
        const availableMatch = memText.match(/MemAvailable:\s+(\d+)/);

        if (totalMatch && availableMatch) {
            const totalMemory = parseInt(totalMatch[1], 10);
            const availableMemory = parseInt(availableMatch[1], 10);
            if (totalMemory > 0) {
                lastRamProgress = 1.0 - (availableMemory / totalMemory);
                lastMemTotalBytes = totalMemory * KILOBYTES_TO_BYTES;
                lastMemUsedBytes = (totalMemory - availableMemory) * KILOBYTES_TO_BYTES;
            }
        }
    } catch (e) {
        logReadFailureOnce(procMeminfoFailure, '/proc/meminfo', e);
    }

    const cpuinfoText = await readKernelFileTextOrNull('/proc/cpuinfo', cancellable);
    if (cpuinfoText !== null)
        lastCpuFreqGhz = averageCpuFrequencyGhz(cpuinfoText);

    const cpuTempC = await readCpuTemperatureC(cancellable);
    if (cpuTempC !== null)
        lastCpuTempC = cpuTempC;

    return {
        cpuProgress: lastCpuProgress,
        ramProgress: lastRamProgress,
        cpuTempC: lastCpuTempC,
        cpuFreqGhz: lastCpuFreqGhz,
        cpuCores: GLib.get_num_processors(),
        memUsedBytes: lastMemUsedBytes,
        memTotalBytes: lastMemTotalBytes,
    };
}

function fetchCpuRamData(callback, cancellable) {
    sampleCpuRamUsage(cancellable).then(data => {
        if (!cancellable.is_cancelled())
            callback(data);
    });
}

function resetCpuRamState() {
    prevCpuTotal = 0;
    prevCpuIdle = 0;
    lastCpuProgress = 0;
    lastRamProgress = 0;
    lastMemUsedBytes = 0;
    lastMemTotalBytes = 0;
    lastCpuTempC = null;
    lastCpuFreqGhz = null;
}

export const cpuRamEngine = new PollingEngine(DEFAULT_ENGINE_POLL_INTERVAL_MS, fetchCpuRamData, resetCpuRamState);

let prevRxBytes = 0;
let prevTxBytes = 0;
let prevTimeMs = 0;
let lastDownloadSpeed = 0;
let lastUploadSpeed = 0;

function fetchNetworkData(callback, cancellable) {
    const netFile = Gio.File.new_for_path('/proc/net/dev');
    netFile.load_contents_async(cancellable, (fileObj, res) => {
        try {
            const [success, contents] = fileObj.load_contents_finish(res);
            procNetDevFailure.reported = false;
            if (success) {
                const text = decoder.decode(contents);
                const lines = text.split('\n');
                let totalRxBytes = 0;
                let totalTxBytes = 0;

                for (let i = PROC_NET_DEV_HEADER_LINES_COUNT; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('lo:')) continue;
                    const colonSplit = line.split(':');
                    if (colonSplit.length >= 2) {
                        const dataParts = colonSplit[1].trim().split(/\s+/);
                        if (dataParts.length >= MIN_PROC_NET_DEV_FIELDS_COUNT) {
                            totalRxBytes += parseInt(dataParts[PROC_NET_DEV_RX_BYTES_INDEX], 10) || 0;
                            totalTxBytes += parseInt(dataParts[PROC_NET_DEV_TX_BYTES_INDEX], 10) || 0;
                        }
                    }
                }

                const nowMs = GLib.get_monotonic_time() / MICROSECONDS_TO_MILLISECONDS;
                if (prevTimeMs > 0) {
                    const deltaMs = nowMs - prevTimeMs;
                    const deltaRxBytes = totalRxBytes - prevRxBytes;
                    const deltaTxBytes = totalTxBytes - prevTxBytes;

                    if (deltaMs > 0) {
                        lastDownloadSpeed = Math.max(0, (deltaRxBytes / deltaMs) * MILLISECONDS_PER_SECOND);
                        lastUploadSpeed = Math.max(0, (deltaTxBytes / deltaMs) * MILLISECONDS_PER_SECOND);
                    }
                }
                prevRxBytes = totalRxBytes;
                prevTxBytes = totalTxBytes;
                prevTimeMs = nowMs;
            }
        } catch (e) {
            logReadFailureOnce(procNetDevFailure, '/proc/net/dev', e);
        }
        if (!cancellable.is_cancelled())
            callback({ downloadSpeed: lastDownloadSpeed, uploadSpeed: lastUploadSpeed });
    });
}

function resetNetworkState() {
    prevRxBytes = 0;
    prevTxBytes = 0;
    prevTimeMs = 0;
    lastDownloadSpeed = 0;
    lastUploadSpeed = 0;
}

export const networkEngine = new PollingEngine(DEFAULT_ENGINE_POLL_INTERVAL_MS, fetchNetworkData, resetNetworkState);

let prevDiskReadBytes = 0;
let prevDiskWriteBytes = 0;
let prevDiskTimeMs = 0;
let lastDiskReadSpeed = 0;
let lastDiskWriteSpeed = 0;
let lastDiskUsedBytes = 0;
let lastDiskTotalBytes = 0;
let lastUptimeSeconds = 0;
let lastLoadAverage = 0;
let lastBattery = null;
let lastGpu = null;

function parseDiskCounters(text) {
    let readBytes = 0;
    let writeBytes = 0;
    for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < DISK_COUNTER_FIELDS_COUNT) continue;
        if (!DISK_DEVICE_NAME_PATTERN.test(parts[2])) continue;
        readBytes += (parseInt(parts[DISK_SECTORS_READ_INDEX], 10) || 0) * SECTOR_BYTES;
        writeBytes += (parseInt(parts[DISK_SECTORS_WRITTEN_INDEX], 10) || 0) * SECTOR_BYTES;
    }
    return { readBytes, writeBytes };
}

function queryRootFilesystem(cancellable) {
    return new Promise((resolve) => {
        Gio.File.new_for_path('/').query_filesystem_info_async(
            'filesystem::size,filesystem::free',
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (fileObj, res) => {
                try {
                    const info = fileObj.query_filesystem_info_finish(res);
                    const total = info.get_attribute_uint64('filesystem::size');
                    const free = info.get_attribute_uint64('filesystem::free');
                    resolve({ totalBytes: total, usedBytes: total - free });
                } catch (error) {
                    resolve(null);
                }
            });
    });
}

async function readBattery(cancellable) {
    for (let index = 0; index < BATTERY_SEARCH_LIMIT; index++) {
        const base = `/sys/class/power_supply/BAT${index}`;
        const percentage = parseFirstNumber(await readKernelFileTextOrNull(`${base}/capacity`, cancellable));
        if (percentage === null) continue;

        const status = (await readKernelFileTextOrNull(`${base}/status`, cancellable) || '').trim();
        // energy_now/power_now are Wh/W while charge_now/current_now are Ah/A; either pair
        // divides to hours, so the same ratio covers both charge-based and energy-based drivers.
        const chargeNow = await readFirstNumber([`${base}/energy_now`, `${base}/charge_now`], cancellable);
        const currentNow = await readFirstNumber([`${base}/power_now`, `${base}/current_now`], cancellable);
        let secondsRemaining = null;
        if (chargeNow !== null && currentNow !== null && currentNow > 0)
            secondsRemaining = Math.round((chargeNow / currentNow) * SECONDS_PER_HOUR);

        return { percentage, status, secondsRemaining };
    }
    return null;
}

async function readGpu(cancellable) {
    for (let index = 0; index < DRM_CARD_SEARCH_LIMIT; index++) {
        const cardBase = `/sys/class/drm/card${index}/device`;
        const busyPercent = parseFirstNumber(await readKernelFileTextOrNull(`${cardBase}/gpu_busy_percent`, cancellable));
        if (busyPercent === null) continue;

        // An integrated GPU's dedicated VRAM is only a small UMA carve-out; the memory it
        // really draws from is the shared GTT pool. Summing both is the figure that reflects
        // "GPU memory in use" on an APU, and still reduces to VRAM alone on a discrete card.
        const vramUsed = await readFirstNumber([`${cardBase}/mem_info_vram_used`], cancellable);
        const vramTotal = await readFirstNumber([`${cardBase}/mem_info_vram_total`], cancellable);
        const gttUsed = await readFirstNumber([`${cardBase}/mem_info_gtt_used`], cancellable);
        const gttTotal = await readFirstNumber([`${cardBase}/mem_info_gtt_total`], cancellable);
        const tempC = await readHwmonTemperatureC(GPU_HWMON_NAMES, cancellable);

        return {
            gpuProgress: busyPercent / 100,
            tempC,
            usedBytes: sumPresent([vramUsed, gttUsed]),
            totalBytes: sumPresent([vramTotal, gttTotal]),
        };
    }
    return null;
}

async function sampleSystemStats(cancellable) {
    const diskText = await readKernelFileTextOrNull('/proc/diskstats', cancellable);
    if (diskText !== null) {
        const { readBytes, writeBytes } = parseDiskCounters(diskText);
        const nowMs = GLib.get_monotonic_time() / MICROSECONDS_TO_MILLISECONDS;
        if (prevDiskTimeMs > 0) {
            const deltaMs = nowMs - prevDiskTimeMs;
            if (deltaMs > 0) {
                lastDiskReadSpeed = Math.max(0, ((readBytes - prevDiskReadBytes) / deltaMs) * MILLISECONDS_PER_SECOND);
                lastDiskWriteSpeed = Math.max(0, ((writeBytes - prevDiskWriteBytes) / deltaMs) * MILLISECONDS_PER_SECOND);
            }
        }
        prevDiskReadBytes = readBytes;
        prevDiskWriteBytes = writeBytes;
        prevDiskTimeMs = nowMs;
    }

    const filesystem = await queryRootFilesystem(cancellable);
    if (filesystem !== null) {
        lastDiskUsedBytes = filesystem.usedBytes;
        lastDiskTotalBytes = filesystem.totalBytes;
    }

    const uptimeSeconds = await readFirstNumber(['/proc/uptime'], cancellable);
    if (uptimeSeconds !== null)
        lastUptimeSeconds = uptimeSeconds;

    const loadAverage = await readFirstNumber(['/proc/loadavg'], cancellable);
    if (loadAverage !== null)
        lastLoadAverage = loadAverage;

    const battery = await readBattery(cancellable);
    if (battery !== null)
        lastBattery = battery;

    const gpu = await readGpu(cancellable);
    if (gpu !== null)
        lastGpu = gpu;

    return {
        diskUsedBytes: lastDiskUsedBytes,
        diskTotalBytes: lastDiskTotalBytes,
        diskReadBytesPerSec: lastDiskReadSpeed,
        diskWriteBytesPerSec: lastDiskWriteSpeed,
        uptimeSeconds: lastUptimeSeconds,
        loadAverage: lastLoadAverage,
        battery: lastBattery,
        gpu: lastGpu,
    };
}

function fetchSystemStatsData(callback, cancellable) {
    sampleSystemStats(cancellable).then(data => {
        if (!cancellable.is_cancelled())
            callback(data);
    });
}

function resetSystemStatsState() {
    prevDiskReadBytes = 0;
    prevDiskWriteBytes = 0;
    prevDiskTimeMs = 0;
    lastDiskReadSpeed = 0;
    lastDiskWriteSpeed = 0;
    lastDiskUsedBytes = 0;
    lastDiskTotalBytes = 0;
    lastUptimeSeconds = 0;
    lastLoadAverage = 0;
    lastBattery = null;
    lastGpu = null;
}

export const systemStatsEngine = new PollingEngine(DEFAULT_ENGINE_POLL_INTERVAL_MS, fetchSystemStatsData, resetSystemStatsState);

/** Stops every monitor and clears its sampling state; called from the extension's disable(). */
export function resetSystemMonitorEngines() {
    cpuRamEngine.stop();
    networkEngine.stop();
    systemStatsEngine.stop();
}
