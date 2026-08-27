import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile, todayDateString } from './widgetUtils.js';


const TICK_INTERVAL_MS = 1000;
const SAVE_THROTTLE_MS = 15000;
const MICROSECONDS_PER_SECOND = 1000000;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

function dayFilePath(dateString) {
    return GLib.build_filenamev([getGridgetsDataDir('screen-time'), `${dateString}.json`]);
}

/**
 * Shared focus-tracking engine. Accumulates per-app, per-hour seconds while any
 * consumer holds a reference, persisting one JSON file per day.
 */
export const screenTimeEngine = {
    _refCount: 0,
    _appHours: new Map(),
    _focusedKey: null,
    _focusStartMicro: null,
    _currentDate: null,
    _tickId: 0,
    _focusSignalId: 0,
    _saveThrottleId: 0,
    _listeners: new Set(),

    /** Registers a consumer; tracking starts with the first and stops with the last. */
    acquire() {
        this._refCount++;
        if (this._refCount === 1) this._start();
        return () => this.release();
    },

    release() {
        if (this._refCount === 0) return;
        this._refCount--;
        if (this._refCount === 0) this._stop();
    },

    addListener(callback) {
        this._listeners.add(callback);
    },

    removeListener(callback) {
        this._listeners.delete(callback);
    },

    getTodayDate() {
        return this._currentDate;
    },

    /** Live snapshot of today's data: { date, totalSeconds, apps: [{key, seconds}], hours }. */
    getTodaySnapshot() {
        return this._buildSnapshot(this._currentDate, this._appHours);
    },

    /** Loads a past day from disk and passes a snapshot of the same shape to callback. */
    loadDayAsync(dateString, callback) {
        this._loadRawAsync(dateString, (appsMap) => {
            callback(this._buildSnapshot(dateString, appsMap));
        });
    },

    _loadRawAsync(dateString, callback) {
        loadJsonFromFileAsync(dayFilePath(dateString), (data) => {
            const appsMap = new Map();
            if (data && typeof data.apps === 'object') {
                for (const [key, hours] of Object.entries(data.apps)) {
                    if (Array.isArray(hours))
                        appsMap.set(key, hours.slice(0, HOURS_PER_DAY));
                }
            }
            callback(appsMap);
        });
    },

    _buildSnapshot(dateString, appsMap) {
        const hoursAggregate = new Array(HOURS_PER_DAY).fill(0);
        const apps = [];
        let totalSeconds = 0;

        for (const [key, hours] of appsMap) {
            let appTotal = 0;
            for (let hour = 0; hour < hours.length; hour++) {
                appTotal += hours[hour];
                hoursAggregate[hour] += hours[hour];
            }
            totalSeconds += appTotal;
            if (appTotal > 0)
                apps.push({ key, seconds: appTotal });
        }

        apps.sort((a, b) => b.seconds - a.seconds);
        return { date: dateString, totalSeconds, apps, hours: hoursAggregate };
    },

    _start() {
        this._currentDate = todayDateString();
        this._focusedKey = this._resolveFocusedKey();
        this._focusStartMicro = this._focusedKey ? GLib.get_real_time() : null;
        this._focusSignalId = global.display.connect('notify::focus-window', () => this._onFocusChanged());
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        // Seed in-memory state from today's persisted file so reloads keep history.
        const loadDate = this._currentDate;
        this._loadRawAsync(loadDate, (loadedMap) => {
            if (this._refCount === 0 || this._currentDate !== loadDate)
                return;
            for (const [key, hours] of loadedMap) {
                if (!this._appHours.has(key))
                    this._appHours.set(key, hours);
            }
        });
    },

    _stop() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
        if (this._focusSignalId) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = 0;
        }
        this._flushFocused(GLib.get_real_time());
        this._saveNow();
        this._appHours.clear();
        this._listeners.clear();
        this._focusedKey = null;
        this._focusStartMicro = null;
    },

    _onFocusChanged() {
        const now = GLib.get_real_time();
        this._flushFocused(now);
        this._focusedKey = this._resolveFocusedKey();
        this._focusStartMicro = this._focusedKey ? now : null;
    },

    _tick() {
        const now = GLib.get_real_time();
        this._flushFocused(now);
        this._maybeRollover();
        this._scheduleSave();
        for (const callback of this._listeners)
            callback();
    },

    _maybeRollover() {
        const today = todayDateString();
        if (today === this._currentDate) return;
        this._saveNow();
        this._currentDate = today;
        this._appHours.clear();
    },

    /**
     * Attributes all time elapsed since the last flush to the focused app,
     * splitting segments at local-hour boundaries so buckets stay accurate.
     */
    _flushFocused(nowMicro) {
        if (!this._focusedKey || this._focusStartMicro === null) return;

        let cursor = this._focusStartMicro;
        while (cursor < nowMicro) {
            const epochSecond = Math.floor(cursor / MICROSECONDS_PER_SECOND);
            const segmentStart = GLib.DateTime.new_from_unix_local(epochSecond);
            const secondsIntoHour = segmentStart.get_minute() * 60 + segmentStart.get_second();

            this._maybeRollover();


            const boundaryEpochSecond = epochSecond - secondsIntoHour + SECONDS_PER_HOUR;
            const cursorEnd = Math.min(nowMicro, boundaryEpochSecond * MICROSECONDS_PER_SECOND);
            const seconds = Math.floor((cursorEnd - cursor) / MICROSECONDS_PER_SECOND);
            if (seconds > 0)
                this._addSeconds(this._focusedKey, segmentStart.get_hour(), seconds);

            cursor = cursorEnd;
        }
        this._focusStartMicro = nowMicro;
    },

    _addSeconds(appKey, hour, seconds) {
        let hours = this._appHours.get(appKey);
        if (!hours) {
            hours = new Array(HOURS_PER_DAY).fill(0);
            this._appHours.set(appKey, hours);
        }
        hours[hour] += seconds;
    },

    _resolveFocusedKey() {
        const focusedWindow = global.display.focus_window;
        if (!focusedWindow) return null;
        const app = Shell.WindowTracker.get_default().get_window_app(focusedWindow);
        if (!app) return null;
        return app.get_id() || app.get_name() || null;
    },

    _scheduleSave() {
        if (this._saveThrottleId) return;
        this._saveThrottleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_THROTTLE_MS, () => {
            this._saveThrottleId = 0;
            this._saveNow();
            return GLib.SOURCE_REMOVE;
        });
    },

    _saveNow() {
        if (this._saveThrottleId) {
            GLib.Source.remove(this._saveThrottleId);
            this._saveThrottleId = 0;
        }
        saveJsonToFile(dayFilePath(this._currentDate), {
            date: this._currentDate,
            apps: Object.fromEntries(this._appHours),
        });
    },
};
