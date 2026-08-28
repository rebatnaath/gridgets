import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile, saveJsonToFileSync } from './widgetUtils.js';

import { todayDateString, toDateString } from './widgetUtils.js';
export { todayDateString, toDateString };

// Monthly-partitioned mood history: ~/.local/share/gridgets/mood/<year>/<month>.json
const monthCache = new Map();
/** Callbacks waiting on an in-flight month file read, keyed by 'YYYY-MM'. */
const pendingMonthLoads = new Map();
/** Generation counter — stale completions from before a clear are discarded. */
let monthLoadGeneration = 0;


function monthKeyOf(dateString) {
    return dateString.slice(0, 7);
}

function monthFilePath(dateString) {
    const [year, month] = dateString.split('-');
    return GLib.build_filenamev([getGridgetsDataDir('mood'), year, `${month}.json`]);
}

function requestMonthLoad(monthKey, dateString, onLoaded) {
    const filePath = monthFilePath(dateString);
    const queued = pendingMonthLoads.get(monthKey);
    if (queued) {
        queued.push(onLoaded);
        return;
    }

    const generation = monthLoadGeneration;
    const callbacks = [onLoaded];
    pendingMonthLoads.set(monthKey, callbacks);
    loadJsonFromFileAsync(filePath, (data) => {
        if (pendingMonthLoads.get(monthKey) === callbacks) {
            pendingMonthLoads.delete(monthKey);
        }
        if (generation === monthLoadGeneration) {
            monthCache.set(monthKey, data && typeof data === 'object' ? data : {});
        }
        for (const callback of callbacks) {
            callback();
        }
    });
}

/**
 * Ensures every month touched by dateKeys is cached, then invokes callback once.
 */
export function loadDatesAsync(dateKeys, callback) {
    const monthKeys = [...new Set(dateKeys.map(monthKeyOf))].filter(key => !monthCache.has(key));
    if (monthKeys.length === 0) {
        callback();
        return;
    }

    let remaining = monthKeys.length;
    const onOneLoaded = () => {
        remaining -= 1;
        if (remaining === 0) {
            callback();
        }
    };
    for (const monthKey of monthKeys) {
        requestMonthLoad(monthKey, `${monthKey}-01`, onOneLoaded);
    }
}

export function loadDatesSync(dateKeys) {
    const monthKeys = [...new Set(dateKeys.map(monthKeyOf))].filter(key => !monthCache.has(key));
    for (const monthKey of monthKeys) {
        const filePath = monthFilePath(`${monthKey}-01`);
        const file = Gio.File.new_for_path(filePath);
        try {
            const [ok, bytes] = file.load_contents(null);
            if (ok) {
                const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                monthCache.set(monthKey, data && typeof data === 'object' ? data : {});
            } else {
                monthCache.set(monthKey, {});
            }
        } catch (_e) {
            monthCache.set(monthKey, {});
        }
    }
}

/** Returns the logged mood level for a date, or 0 when nothing was logged. */
export function getMood(dateString) {
    const month = monthCache.get(monthKeyOf(dateString));
    return month ? (month[dateString] || 0) : 0;
}

/** Stores a mood level for a date and persists the whole month file. */
export function saveMood(dateString, level) {
    const monthKey = monthKeyOf(dateString);

    if (!monthCache.has(monthKey)) {
        requestMonthLoad(monthKey, `${monthKey}-01`, () => {
            let month = monthCache.get(monthKey);
            if (!month) {
                // Seed the cache so the recursive call takes the direct path
                // instead of re-queuing a load that will fail again.
                month = {};
                monthCache.set(monthKey, month);
            }
            month[dateString] = level;
            saveJsonToFile(monthFilePath(dateString), month);
        });
        return;
    }

    const month = monthCache.get(monthKey);
    month[dateString] = level;
    saveJsonToFile(monthFilePath(dateString), month);
}

/** Clears cached month data; called from the extension's disable(). */
export function clearMoodStoreCache() {
    monthLoadGeneration++;
    monthCache.clear();
    pendingMonthLoads.clear();
}

const MOOD_SEED_DAYS = 30;

export function generateFakeMoodData() {
    const today = GLib.DateTime.new_now_local();
    const todayStr = toDateString(today);
    const months = {};

    // Load existing month files from disk to find the latest date
    const moodDir = getGridgetsDataDir('mood');
    let latestExistingDate = null;

    // Scan year directories
    const dirFile = Gio.File.new_for_path(moodDir);
    try {
        const enumerator = dirFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let yearInfo;
        while ((yearInfo = enumerator.next_file(null)) !== null) {
            const yearName = yearInfo.get_name();
            if (yearInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
            const yearDir = Gio.File.new_for_path(GLib.build_filenamev([moodDir, yearName]));
            try {
                const monthEnum = yearDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let monthInfo;
                while ((monthInfo = monthEnum.next_file(null)) !== null) {
                    const monthName = monthInfo.get_name();
                    if (!monthName.endsWith('.json')) continue;
                    const monthKey = monthName.replace('.json', '');
                    const filePath = GLib.build_filenamev([moodDir, yearName, monthName]);
                    const file = Gio.File.new_for_path(filePath);
                    try {
                        const [ok, bytes] = file.load_contents(null);
                        if (!ok) continue;
                        const contents = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                        if (typeof contents === 'object' && contents !== null) {
                            // Update cache
                            const fullMonthKey = `${yearName}-${monthKey}`;
                            monthCache.set(fullMonthKey, contents);
                            for (const dateKey of Object.keys(contents)) {
                                if (contents[dateKey] > 0 && (!latestExistingDate || dateKey > latestExistingDate)) {
                                    latestExistingDate = dateKey;
                                }
                            }
                        }
                    } catch (_e) { /* skip unreadable files */ }
                }
            } catch (_e) { /* skip unreadable directories */ }
        }
    } catch (_e) { /* skip if mood dir doesn't exist */ }

    // Generate from (latestExistingDate + 1) through today, or MOOD_SEED_DAYS backwards if no data
    let startDate;
    if (latestExistingDate && latestExistingDate < todayStr) {
        const [y, m, d] = latestExistingDate.split('-').map(Number);
        const lastDate = GLib.DateTime.new_local(y, m, d, 0, 0, 0);
        startDate = lastDate.add_days(1);
    } else {
        startDate = today.add_days(-(MOOD_SEED_DAYS - 1));
    }

    // Generate from startDate to today
    let day = startDate;
    while (day.compare(today) <= 0) {
        const dateString = toDateString(day);
        const monthKey = monthKeyOf(dateString);
        const existing = monthCache.has(monthKey) ? monthCache.get(monthKey) : null;
        if (existing && existing[dateString] !== undefined) {
            day = day.add_days(1);
            continue;
        }
        if (!months[monthKey]) {
            months[monthKey] = existing ? { ...existing } : {};
        }
        months[monthKey][dateString] = Math.floor(Math.random() * 5) + 1;
        day = day.add_days(1);
    }

    for (const [monthKey, data] of Object.entries(months)) {
        monthCache.set(monthKey, data);
        const [year, month] = monthKey.split('-');
        const filePath = GLib.build_filenamev([getGridgetsDataDir('mood'), year, `${month}.json`]);
        saveJsonToFileSync(filePath, data);
    }
}

export function listMoodDates(callback) {
    const moodDir = getGridgetsDataDir('mood');
    const dates = [];
    try {
        const dirFile = Gio.File.new_for_path(moodDir);
        const enumerator = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let yearInfo;
        while ((yearInfo = enumerator.next_file(null)) !== null) {
            if (yearInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
            const yearName = yearInfo.get_name();
            const yearDir = Gio.File.new_for_path(GLib.build_filenamev([moodDir, yearName]));
            let monthEnum;
            try {
                monthEnum = yearDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            } catch (_e) {
                continue;
            }
            let monthInfo;
            while ((monthInfo = monthEnum.next_file(null)) !== null) {
                const monthName = monthInfo.get_name();
                if (!monthName.endsWith('.json')) continue;
                const monthKey = monthName.replace('.json', '');
                const filePath = GLib.build_filenamev([moodDir, yearName, monthName]);
                const file = Gio.File.new_for_path(filePath);
                let contents;
                try {
                    const [ok, bytes] = file.load_contents(null);
                    if (!ok) continue;
                    contents = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                } catch (_e) {
                    continue;
                }
                if (typeof contents === 'object' && contents !== null) {
                    const prefix = `${yearName}-${monthKey}`;
                    for (const dateKey of Object.keys(contents)) {
                        if (dateKey.startsWith(prefix) && contents[dateKey] > 0)
                            dates.push(dateKey);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error listing mood dates:', e);
    }
    dates.sort().reverse();
    callback(dates);
}

/** Synchronous version of listMoodDates for use in prefs where async may not complete. */
export function listMoodDatesSync() {
    const moodDir = getGridgetsDataDir('mood');
    const dates = [];
    try {
        const dirFile = Gio.File.new_for_path(moodDir);
        const enumerator = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let yearInfo;
        while ((yearInfo = enumerator.next_file(null)) !== null) {
            if (yearInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
            const yearName = yearInfo.get_name();
            const yearDir = Gio.File.new_for_path(GLib.build_filenamev([moodDir, yearName]));
            let monthEnum;
            try {
                monthEnum = yearDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            } catch (_e) {
                continue;
            }
            let monthInfo;
            while ((monthInfo = monthEnum.next_file(null)) !== null) {
                const monthName = monthInfo.get_name();
                if (!monthName.endsWith('.json')) continue;
                const monthKey = monthName.replace('.json', '');
                const filePath = GLib.build_filenamev([moodDir, yearName, monthName]);
                const file = Gio.File.new_for_path(filePath);
                let contents;
                try {
                    const [ok, bytes] = file.load_contents(null);
                    if (!ok) continue;
                    contents = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                } catch (_e) {
                    continue;
                }
                if (typeof contents === 'object' && contents !== null) {
                    const prefix = `${yearName}-${monthKey}`;
                    for (const dateKey of Object.keys(contents)) {
                        if (dateKey.startsWith(prefix) && contents[dateKey] > 0)
                            dates.push(dateKey);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error listing mood dates:', e);
    }
    dates.sort().reverse();
    return dates;
}
