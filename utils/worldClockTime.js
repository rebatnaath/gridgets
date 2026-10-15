import GLib from 'gi://GLib';

// Timezone arithmetic for the world clock, kept apart from the widget so it can be
// exercised on its own. The pure helpers take numbers and DateTimes rather than reading
// a clock, which is what makes them testable at all.

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
        return 'Local time';

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
    return GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId) || GLib.TimeZone.new_local();
}