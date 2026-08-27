import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { getGridgetsDataDir, saveJsonToFile, toDateString } from './widgetUtils.js';

const HOURS_PER_DAY = 24;
const SEED_DAYS = 30;
const MIN_DAYS_TO_SEED = 5;

const APP_PROFILES = [
    {
        key: 'firefox',
        weekday: [0, 0, 0, 0, 0, 0, 0, 300, 2700, 1800, 900, 600, 300, 900, 1800, 2700, 1800, 1200, 1800, 2400, 1800, 900, 300, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 600, 1200, 1800, 1200, 900, 600, 900, 1200, 1800, 2400, 2700, 1800, 1200, 600, 300, 0],
    },
    {
        key: 'vscode',
        weekday: [0, 0, 0, 0, 0, 0, 0, 600, 3600, 3600, 2700, 1800, 900, 2700, 3600, 3600, 2700, 1800, 900, 600, 0, 0, 0, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 600, 1200, 900, 0, 0, 600, 1200, 900, 600, 0, 0, 0, 0, 0, 0],
    },
    {
        key: 'gnome-terminal',
        weekday: [0, 0, 0, 0, 0, 0, 0, 300, 1800, 900, 600, 300, 300, 600, 900, 1200, 900, 600, 300, 300, 0, 0, 0, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 600, 300, 0, 0, 300, 600, 300, 0, 0, 0, 0, 0, 0, 0],
    },
    {
        key: 'spotify',
        weekday: [0, 0, 0, 0, 0, 0, 0, 600, 1200, 1200, 900, 600, 1200, 900, 1200, 900, 1200, 900, 1200, 1800, 1200, 600, 0, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 600, 1200, 1800, 1200, 1800, 1200, 1800, 1200, 1800, 2400, 2400, 1800, 1200, 600, 0, 0],
    },
    {
        key: 'discord',
        weekday: [0, 0, 0, 0, 0, 0, 0, 0, 300, 300, 0, 0, 300, 0, 0, 300, 300, 600, 1200, 1800, 2400, 1800, 900, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 600, 900, 600, 900, 600, 900, 1200, 1800, 2400, 2400, 1800, 1200, 600, 0, 0],
    },
    {
        key: 'nautilus',
        weekday: [0, 0, 0, 0, 0, 0, 0, 0, 300, 300, 600, 300, 300, 300, 300, 300, 300, 300, 0, 0, 0, 0, 0, 0],
        weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 600, 300, 300, 0, 300, 600, 300, 0, 0, 0, 0, 0, 0, 0],
    },
];

function randomVariance(value, variancePercent) {
    const variance = value * (variancePercent / 100);
    return Math.max(0, Math.round(value + (Math.random() * 2 - 1) * variance));
}

function generateDayData(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    const dt = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
    const dayOfWeek = dt.get_day_of_week();
    const isWeekend = dayOfWeek === 6 || dayOfWeek === 7;

    const apps = {};
    for (const profile of APP_PROFILES) {
        const base = isWeekend ? profile.weekend : profile.weekday;
        apps[profile.key] = base.map(h => randomVariance(h, 30));
    }
    return { date: dateString, apps };
}

export function generateFakeScreenTimeData() {
    const screenTimeDir = getGridgetsDataDir('screen-time');
    const today = GLib.DateTime.new_now_local();

    for (let i = 0; i < SEED_DAYS; i++) {
        const day = today.add_days(-(SEED_DAYS - 1 - i));
        const dateString = toDateString(day);
        const filePath = GLib.build_filenamev([screenTimeDir, `${dateString}.json`]);
        const file = Gio.File.new_for_path(filePath);
        if (file.query_exists(null))
            continue;
        saveJsonToFile(filePath, generateDayData(dateString));
    }
}

export function seedScreenTimeIfEmpty() {
    const screenTimeDir = getGridgetsDataDir('screen-time');
    const dirFile = Gio.File.new_for_path(screenTimeDir);
    let jsonCount = 0;
    try {
        const enumerator = dirFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_name().endsWith('.json'))
                jsonCount++;
        }
    } catch (_e) {
        // Directory doesn't exist or can't be read — seed fresh data.
    }
    if (jsonCount < MIN_DAYS_TO_SEED)
        generateFakeScreenTimeData();
}
