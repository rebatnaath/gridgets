import GLib from 'gi://GLib';

// World-clock city data and timezone arithmetic. Shared by the widget and the
// preferences process, so it must stay free of St, Clutter and the other shell
// libraries the GTK4 preferences cannot load. The pure helpers take numbers and
// DateTimes rather than reading a clock, which is what makes them testable.

export const MIN_CITY_COUNT = 2;
export const MAX_CITY_COUNT = 4;

// The offset label that means this zone agrees with the local clock. Callers compare
// against it rather than retyping the string, so the wording stays in one place.
export const LOCAL_TIME_LABEL = 'Local time';

export const DEFAULT_CITIES = Object.freeze([
    { name: 'London', timezone: 'Europe/London', country: 'GB' },
    { name: 'New York', timezone: 'America/New_York', country: 'US' },
]);

/**
 * Normalises a configured city list to the supported count.
 *
 * A row needs a timezone to be truthful: without one the widget falls back to the local
 * zone and would print this city's name beside the wrong time, so an entry without one
 * is dropped rather than repaired. Repeats are dropped so two rows can never show the
 * same clock. A list left short is topped up from the defaults rather than rendered
 * short, and one longer than the maximum is trimmed, so a config written before the cap
 * cannot ask for rows the face has no room for.
 */
export function resolveCityList(configured) {
    const source = Array.isArray(configured) ? configured : [];
    const picked = [];
    const seen = new Set();

    for (const city of source) {
        if (!city?.timezone) continue;
        if (seen.has(city.timezone)) continue;
        seen.add(city.timezone);
        picked.push(city);
        if (picked.length === MAX_CITY_COUNT) break;
    }

    // Nothing usable configured is the one case that means "no preference", and it takes
    // the whole default set rather than the bare minimum.
    if (picked.length === 0)
        return [...DEFAULT_CITIES];

    for (const city of DEFAULT_CITIES) {
        if (picked.length >= MIN_CITY_COUNT) break;
        if (seen.has(city.timezone)) continue;
        seen.add(city.timezone);
        picked.push(city);
    }

    return picked;
}

// The hour the sun is treated as up, and the hour it is treated as down. A real sunrise
// table would need a latitude this widget does not have; the hour range is what the rest
// of the extension's weather art is judged against anyway.
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86400;

/** True when the given hour counts as daylight. */
export function isDaytimeHour(hour) {
    return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR;
}

/**
 * How far a city sits from the local zone, as the row says it.
 *
 * The sign is city minus local, so a negative difference is a city behind us. Zero is
 * worded as local time rather than as "0m behind", because a row that agrees with the
 * clock in the corner has nothing to add to it.
 */
export function formatOffsetLabel(offsetSeconds) {
    if (!Number.isFinite(offsetSeconds) || offsetSeconds === 0)
        return LOCAL_TIME_LABEL;

    const behind = offsetSeconds < 0;
    const total = Math.abs(offsetSeconds);
    // Truncated rather than rounded: a zone 5h 45m off stays 5h 45m, and rounding it up to
    // six would be a different offset from the one the time beside it is drawn on.
    const hours = Math.floor(total / SECONDS_PER_HOUR);
    const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

    let amount;
    if (hours === 0)
        amount = `${minutes}m`;
    else if (minutes === 0)
        amount = `${hours}h`;
    else
        amount = `${hours}h ${minutes}m`;
    return `${amount} ${behind ? 'behind' : 'ahead'}`;
}

/**
 * How the city's calendar day relates to the local one.
 *
 * Both are reduced to midnight UTC before the difference is taken, so the answer depends
 * only on the dates and never on the hour each clock happens to be showing.
 */
export function dayRelationLabel(cityDate, localDate) {
    // new_utc takes all six fields; the time ones are zeroed so only the dates matter.
    const cityMidnight = GLib.DateTime.new_utc(
        cityDate.get_year(), cityDate.get_month(), cityDate.get_day_of_month(), 0, 0, 0);
    const localMidnight = GLib.DateTime.new_utc(
        localDate.get_year(), localDate.get_month(), localDate.get_day_of_month(), 0, 0, 0);
    const days = Math.round((cityMidnight.to_unix() - localMidnight.to_unix()) / SECONDS_PER_DAY);

    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    // Far enough away that a name stops meaning much; the date is more use than "in 3 days".
    return cityDate.format('%a %d %b');
}

/** The difference in seconds between two zones at `now`: city minus local. */
export function offsetFrom(cityTimezone, localTimezone, now) {
    if (!cityTimezone)
        return 0;
    const city = cityTimezone.get_offset(now);
    const local = localTimezone ? localTimezone.get_offset(now) : 0;
    return city - local;
}

/** The zone for a configured city, falling back to the local one when it cannot be read. */
export function zoneFor(timezoneId) {
    if (!timezoneId)
        return GLib.TimeZone.new_local();
    // Only new_identifier, which returns null on failure; new() would answer UTC
    // and hide the fallback.
    return GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new_local();
}
