import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { CALENDAR_WEEKDAY_NAMES } from '../../utils/widgetUtils.js';

// Both calendar panels pad by this much so their grids start on the same row. Kept
// small because the agenda's day column needs the height for events.
export const GRID_REF_PADDING_PX = 8;

/** How often each calendar widget checks whether the day rolled over. */
export const DATE_POLL_INTERVAL_MS = 60000;

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const SUNDAY_FIRST_REGIONS = new Set([
    'US', 'CA', 'AU', 'NZ', 'IN', 'JP', 'KR', 'TW', 'HK', 'SG', 'PH', 'ZA', 'BR', 'MX',
    'AR', 'CL', 'CO', 'PE', 'VE', 'IL', 'EG', 'SA', 'AE', 'TH', 'ID', 'MY', 'CN',
]);
const WEEKDAY_NAMES_BY_LOCALE = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Long enough for a client to finish rewriting the file, short enough to feel current.
const CALENDAR_RELOAD_DEBOUNCE_MS = 200;

export function getDaysInMonth(year, month) {
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}

/** The setting wins, then the desktop calendar, then the locale's region. */
export function resolveFirstDay(settings) {
    const override = settings.get_int('calendar-first-day');
    if (override >= 0 && override <= 6)
        return override;

    const desktopCalendar = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });
    const configuredIndex = WEEKDAY_NAMES_BY_LOCALE.indexOf(desktopCalendar.get_string('week-start-day'));
    if (configuredIndex >= 0)
        return configuredIndex;

    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const region = locale.match(/-([A-Z]{2})(?:-|$)/)?.[1] || '';
    return SUNDAY_FIRST_REGIONS.has(region) ? 0 : 1;
}

export function resolveWeekendDays(settings) {
    return new Set(settings.get_strv('calendar-weekend-days')
        .filter(day => CALENDAR_WEEKDAY_NAMES.includes(day)));
}

export function watchCalendarSettings(settings, onChanged) {
    const state = {
        firstDay: resolveFirstDay(settings),
        weekendDays: resolveWeekendDays(settings),
        accentWeekends: settings.get_boolean('calendar-weekend-accent'),
    };

    const refresh = () => {
        state.firstDay = resolveFirstDay(settings);
        state.weekendDays = resolveWeekendDays(settings);
        state.accentWeekends = settings.get_boolean('calendar-weekend-accent');
        onChanged(state);
    };

    const signalIds = [
        settings.connect('changed::calendar-first-day', refresh),
        settings.connect('changed::calendar-weekend-days', refresh),
        settings.connect('changed::calendar-weekend-accent', refresh),
    ];

    return {
        state,
        dispose() {
            signalIds.forEach(id => settings.disconnect(id));
        },
    };
}

/** 0 for Sunday. */
export function getColumnForDate(date, firstDay) {
    return (date.get_day_of_week() - firstDay + 7) % 7;
}

export function isWeekend(date, weekendDays) {
    return weekendDays.has(CALENDAR_WEEKDAY_NAMES[date.get_day_of_week() % 7].toLowerCase());
}

/** Matches the DTSTART form used by the calendar file. */
export function toDateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function eventDatesInMonth(eventsByDate, date) {
    const year = date.get_year();
    const month = date.get_month();
    const dates = new Set();
    for (const key of eventsByDate.keys()) {
        const [eventYear, eventMonth] = key.split('-').map(Number);
        if (eventYear === year && eventMonth === month)
            dates.add(key);
    }
    return dates;
}

function unfoldIcsLines(text) {
    // RFC 5545 folds long lines by inserting CRLF plus a single space.
    return text.replace(/\r?\n[ \t]/g, '');
}

function unescapeIcsText(value) {
    return value
        .replace(/\\n/gi, ' ')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\')
        .trim();
}

function readIcsProperty(block, name) {
    const match = block.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'mi'));
    return match ? unescapeIcsText(match[1]) : '';
}

/**
 * Polls for the day rolling over so today stays highlighted. It only acts when the
 * date actually changed, which keeps the redraw off every other tick.
 */
export function watchDayRollover(monthGrid, onRolledOver = null) {
    let lastDayKey = '';
    return () => {
        const now = GLib.DateTime.new_now_local();
        const dayKey = toDateKey(now.get_year(), now.get_month(), now.get_day_of_month());
        if (dayKey === lastDayKey)
            return GLib.SOURCE_CONTINUE;
        if (monthGrid.displayDate.get_year() === now.get_year()
            && monthGrid.displayDate.get_month() === now.get_month())
            monthGrid.refreshForNewDay();
        lastDayKey = dayKey;
        onRolledOver?.(now);
        return GLib.SOURCE_CONTINUE;
    };
}

export function parseCalendarEvents(bytes) {
    const text = unfoldIcsLines(new TextDecoder('utf-8').decode(bytes));
    const byDate = new Map();

    for (const block of text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []) {
        const startValue = readIcsProperty(block, 'DTSTART');
        const dateMatch = startValue.match(/^(\d{4})(\d{2})(\d{2})/);
        if (!dateMatch)
            continue;

        const timeMatch = startValue.match(/T(\d{2})(\d{2})/);
        const key = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        if (!byDate.has(key))
            byDate.set(key, []);

        byDate.get(key).push({
            summary: readIcsProperty(block, 'SUMMARY') || 'Untitled event',
            // All-day events have no time, so they sort ahead of timed ones on the day.
            sortMinutes: timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : -1,
        });
    }

    for (const events of byDate.values())
        events.sort((a, b) => a.sortMinutes - b.sortMinutes);

    return byDate;
}

function getCalendarFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'evolution',
        'calendar',
        'system',
        'calendar.ics',
    ]));
}

export function watchCalendarEvents({ onEvents, isStale, cancellable }) {
    const file = getCalendarFile();
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, cancellable);
    let monitorChangedId = 0;
    let debounceId = 0;
    let loadGeneration = 0;
    let disposed = false;

    const readFile = (generation) => {
        file.load_contents_async(cancellable, (source, result) => {
            // A newer read has started, so this answer is no longer the one wanted.
            if (disposed || generation !== loadGeneration || isStale())
                return;
            try {
                const [success, bytes] = source.load_contents_finish(result);
                if (success)
                    onEvents(parseCalendarEvents(bytes));
            } catch (error) {
                // Only a missing file means "no events". A cancelled or unreadable
                // read says nothing about the calendar, and clearing the map on one
                // would hide events that are still there.
                if (error.matches && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    onEvents(new Map());
            }
        });
    };

    // One save can raise several change events, and clients rewrite the file in
    // place, so reads are coalesced and only the newest one is ever applied.
    const load = () => {
        if (debounceId) {
            GLib.Source.remove(debounceId);
            debounceId = 0;
        }
        debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CALENDAR_RELOAD_DEBOUNCE_MS, () => {
            debounceId = 0;
            loadGeneration += 1;
            readFile(loadGeneration);
            return GLib.SOURCE_REMOVE;
        });
    };

    monitorChangedId = monitor.connect('changed', load);
    loadGeneration += 1;
    readFile(loadGeneration);

    return {
        dispose() {
            disposed = true;
            if (debounceId) {
                GLib.Source.remove(debounceId);
                debounceId = 0;
            }
            if (monitorChangedId) {
                monitor.disconnect(monitorChangedId);
                monitorChangedId = 0;
            }
            monitor.cancel();
        },
    };
}
