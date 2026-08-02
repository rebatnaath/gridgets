/**
 * ============================================================================
 * SYSTEM MONITOR ENGINE
 * 
 * Centralized polling engine for system resources (CPU, RAM, Network).
 * Deduplicates timers and file reads, allowing multiple widgets to subscribe
 * to a single data stream, significantly improving extension efficiency.
 * ============================================================================
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/** Polling engine metrics & file parsing constants */
const DEFAULT_ENGINE_POLL_INTERVAL_MS = 2000;
const PROC_NET_DEV_HEADER_LINES_COUNT = 2;
const PROC_NET_DEV_RX_BYTES_INDEX = 0;
const PROC_NET_DEV_TX_BYTES_INDEX = 8;
const MIN_PROC_NET_DEV_FIELDS_COUNT = 8;
const MILLISECONDS_PER_SECOND = 1000;
const MICROSECONDS_TO_MILLISECONDS = 1000;

export class PollingEngine {
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
                this.fetchFn((data) => {
                    this.lastData = data;
                    this.subscribers.forEach(cb => cb(data));
                });
            };

            runFetch();
            this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.intervalMs, () => {
                runFetch();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    unsubscribe(callback) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
        if (this.subscribers.length === 0 && this.timerId) {
            GLib.Source.remove(this.timerId);
            this.timerId = null;
            this.lastData = null;
            if (this.resetFn) {
                this.resetFn();
            }
        }
    }
}

const decoder = new TextDecoder('utf-8');

// CPU & RAM Data Source

let prevCpuTotal = 0;
let prevCpuIdle = 0;
let lastCpuProgress = 0;
let lastRamProgress = 0;
let lastCpuTempC = 34;
let lastCpuFreqGhz = 4.2;
let lastTaskCount = 2135;

function fetchCpuRamData(callback) {
    const statFile = Gio.File.new_for_path('/proc/stat');
    statFile.load_contents_async(null, (fileObj, res) => {
        try {
            const [success, contents] = fileObj.load_contents_finish(res);
            if (success) {
                const text = decoder.decode(contents);
                const cpuLineMatch = text.match(/^cpu\s+(.+)$/m);
                if (cpuLineMatch) {
                    const parts = cpuLineMatch[1].trim().split(/\s+/).map(Number);
                    const idleIndex = 3;
                    const iowaitIndex = 4;
                    const idle = parts[idleIndex] + parts[iowaitIndex];
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
            }
        } catch (e) {
            console.error('Error reading /proc/stat:', e);
        }

        const memFile = Gio.File.new_for_path('/proc/meminfo');
        memFile.load_contents_async(null, (memObj, memRes) => {
            try {
                const [memSuccess, memContents] = memObj.load_contents_finish(memRes);
                if (memSuccess) {
                    const memText = decoder.decode(memContents);
                    const totalMatch = memText.match(/MemTotal:\s+(\d+)/);
                    const availableMatch = memText.match(/MemAvailable:\s+(\d+)/);

                    if (totalMatch && availableMatch) {
                        const totalMemory = parseInt(totalMatch[1], 10);
                        const availableMemory = parseInt(availableMatch[1], 10);
                        if (totalMemory > 0) {
                            lastRamProgress = 1.0 - (availableMemory / totalMemory);
                        }
                    }
                }
            } catch (e) {
                console.error('Error reading /proc/meminfo:', e);
            }

            // Async read CPU temperature from /sys/class/thermal
            const thermalFile = Gio.File.new_for_path('/sys/class/thermal/thermal_zone0/temp');
            thermalFile.load_contents_async(null, (tFile, tRes) => {
                try {
                    const [tSuccess, tContents] = tFile.load_contents_finish(tRes);
                    if (tSuccess) {
                        const tempVal = parseInt(decoder.decode(tContents).trim(), 10);
                        if (!isNaN(tempVal) && tempVal > 0) {
                            lastCpuTempC = Math.round(tempVal > 1000 ? tempVal / 1000 : tempVal);
                        }
                    }
                } catch (_err) {
                    // Fallback to default CPU temp
                }

                // Async read loadavg total task count
                const loadFile = Gio.File.new_for_path('/proc/loadavg');
                loadFile.load_contents_async(null, (lFile, lRes) => {
                    try {
                        const [lSuccess, lContents] = lFile.load_contents_finish(lRes);
                        if (lSuccess) {
                            const loadText = decoder.decode(lContents).trim();
                            const parts = loadText.split(/\s+/);
                            if (parts.length >= 4) {
                                const taskParts = parts[3].split('/');
                                if (taskParts.length >= 2) {
                                    const total = parseInt(taskParts[1], 10);
                                    if (!isNaN(total) && total > 0)
                                        lastTaskCount = total;
                                }
                            }
                        }
                    } catch (_err) {
                        // Fallback to default task count
                    }

                    // Async read CPU frequency in GHz
                    const cpuInfoFile = Gio.File.new_for_path('/proc/cpuinfo');
                    cpuInfoFile.load_contents_async(null, (cFile, cRes) => {
                        try {
                            const [cSuccess, cContents] = cFile.load_contents_finish(cRes);
                            if (cSuccess) {
                                const cpuInfoText = decoder.decode(cContents);
                                const mhzMatch = cpuInfoText.match(/cpu MHz\s+:\s+([\d.]+)/i);
                                if (mhzMatch) {
                                    const mhz = parseFloat(mhzMatch[1]);
                                    if (!isNaN(mhz) && mhz > 0)
                                        lastCpuFreqGhz = parseFloat((mhz / 1000).toFixed(1));
                                }
                            }
                        } catch (_err) {
                            // Fallback to default CPU frequency
                        }

                        callback({
                            cpuProgress: lastCpuProgress,
                            ramProgress: lastRamProgress,
                            cpuTempC: lastCpuTempC,
                            cpuFreqGhz: lastCpuFreqGhz,
                            taskCount: lastTaskCount,
                        });
                    });
                });
            });
        });
    });
}

function resetCpuRamState() {
    prevCpuTotal = 0;
    prevCpuIdle = 0;
    lastCpuProgress = 0;
    lastRamProgress = 0;
    lastCpuTempC = 34;
    lastCpuFreqGhz = 4.2;
    lastTaskCount = 2135;
}

export const cpuRamEngine = new PollingEngine(DEFAULT_ENGINE_POLL_INTERVAL_MS, fetchCpuRamData, resetCpuRamState);

// Network Speed Data Source

let prevRxBytes = 0;
let prevTxBytes = 0;
let prevTimeMs = 0;
let lastDownloadSpeed = 0;
let lastUploadSpeed = 0;

function fetchNetworkData(callback) {
    const netFile = Gio.File.new_for_path('/proc/net/dev');
    netFile.load_contents_async(null, (fileObj, res) => {
        try {
            const [success, contents] = fileObj.load_contents_finish(res);
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
                if (prevTimeMs > 0 && totalRxBytes > 0) {
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
            console.error('Error reading /proc/net/dev:', e);
        }
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
