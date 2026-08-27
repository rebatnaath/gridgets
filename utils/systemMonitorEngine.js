import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_ENGINE_POLL_INTERVAL_MS = 2000;
const PROC_NET_DEV_HEADER_LINES_COUNT = 2;
const PROC_NET_DEV_RX_BYTES_INDEX = 0;
const PROC_NET_DEV_TX_BYTES_INDEX = 8;
const MIN_PROC_NET_DEV_FIELDS_COUNT = PROC_NET_DEV_TX_BYTES_INDEX + 1;
const MILLISECONDS_PER_SECOND = 1000;
const MICROSECONDS_TO_MILLISECONDS = 1000;

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
                this.fetchFn((data) => {
                    this.lastData = data;
                    for (const cb of [...this.subscribers]) {
                        try {
                            cb(data);
                        } catch (e) {
                            console.error('Subscriber callback error:', e);
                        }
                    }
                });
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

const PROC_STAT_IDLE_INDEX = 3;
const PROC_STAT_IOWAIT_INDEX = 4;

// Reads a /proc pseudo-filesystem file as UTF-8 text.
function readKernelFileText(filePath) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(filePath).load_contents_async(null, (fileObj, res) => {
            try {
                const [success, contents] = fileObj.load_contents_finish(res);
                resolve(success ? decoder.decode(contents) : '');
            } catch (error) {
                reject(error);
            }
        });
    });
}

let prevCpuTotal = 0;
let prevCpuIdle = 0;
let lastCpuProgress = 0;
let lastRamProgress = 0;

/** Logs a read failure only when it starts, so a persistent error does not spam the journal every poll. */
function logReadFailureOnce(failureState, filePath, error) {
    if (failureState.reported) return;
    failureState.reported = true;
    console.error(`Error reading ${filePath}:`, error);
}

const procStatFailure = { reported: false };
const procMeminfoFailure = { reported: false };
const procNetDevFailure = { reported: false };

async function sampleCpuRamUsage() {
    try {
        const statText = await readKernelFileText('/proc/stat');
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
        const memText = await readKernelFileText('/proc/meminfo');
        procMeminfoFailure.reported = false;
        const totalMatch = memText.match(/MemTotal:\s+(\d+)/);
        const availableMatch = memText.match(/MemAvailable:\s+(\d+)/);

        if (totalMatch && availableMatch) {
            const totalMemory = parseInt(totalMatch[1], 10);
            const availableMemory = parseInt(availableMatch[1], 10);
            if (totalMemory > 0) {
                lastRamProgress = 1.0 - (availableMemory / totalMemory);
            }
        }
    } catch (e) {
        logReadFailureOnce(procMeminfoFailure, '/proc/meminfo', e);
    }

    return { cpuProgress: lastCpuProgress, ramProgress: lastRamProgress };
}

function fetchCpuRamData(callback) {
    sampleCpuRamUsage().then(callback);
}

function resetCpuRamState() {
    prevCpuTotal = 0;
    prevCpuIdle = 0;
    lastCpuProgress = 0;
    lastRamProgress = 0;
}

export const cpuRamEngine = new PollingEngine(DEFAULT_ENGINE_POLL_INTERVAL_MS, fetchCpuRamData, resetCpuRamState);

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
