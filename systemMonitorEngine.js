/**
 * ============================================================================
 * SYSTEM MONITOR ENGINE
 * 
 * This module centralizes polling logic for system resources (CPU, RAM, Network).
 * It deduplicates timers and file reads, allowing multiple widgets to subscribe
 * to a single data stream, significantly improving extension efficiency.
 * ============================================================================
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class PollingEngine {
    constructor(intervalMs, fetchFn) {
        this.intervalMs = intervalMs;
        this.fetchFn = fetchFn;
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
            this.fetchFn((data) => {
                this.lastData = data;
                this.subscribers.forEach(cb => cb(data));
            });
            this.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.intervalMs, () => {
                this.fetchFn((data) => {
                    this.lastData = data;
                    this.subscribers.forEach(cb => cb(data));
                });
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
        }
    }
}

const decoder = new TextDecoder('utf-8');

// CPU/RAM Engine 

let prevCpuTotal = 0;
let prevCpuIdle = 0;
let lastCpuProgress = 0;
let lastRamProgress = 0;

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
                    const idle = parts[3] + parts[4];
                    const total = parts.reduce((a, b) => a + b, 0);

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
            callback({ cpuProgress: lastCpuProgress, ramProgress: lastRamProgress });
        });
    });
}

export const cpuRamEngine = new PollingEngine(2000, fetchCpuRamData);

// Network Engine 

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

                for (let i = 2; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('lo:')) continue;
                    const colonSplit = line.split(':');
                    if (colonSplit.length >= 2) {
                        const dataParts = colonSplit[1].trim().split(/\s+/);
                        if (dataParts.length >= 8) {
                            totalRxBytes += parseInt(dataParts[0], 10) || 0;
                            totalTxBytes += parseInt(dataParts[8], 10) || 0;
                        }
                    }
                }

                const nowMs = GLib.get_monotonic_time() / 1000;
                if (prevTimeMs > 0 && totalRxBytes > 0) {
                    const deltaMs = nowMs - prevTimeMs;
                    const deltaRxBytes = totalRxBytes - prevRxBytes;
                    const deltaTxBytes = totalTxBytes - prevTxBytes;

                    if (deltaMs > 0) {
                        const MILLISECONDS_PER_SECOND = 1000;
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

export const networkEngine = new PollingEngine(2000, fetchNetworkData);
