// Shared by the GNOME Clocks and GNOME Weather location pickers, which read their
// locations through different APIs but agree on how a location is validated, keyed
// and displayed.

import GLib from 'gi://GLib';

export function normalizeName(name) {
    return name.trim().toLocaleLowerCase();
}

export function hasValidCoordinates(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
}

// The stored timezone is an IANA id ("Asia/Kathmandu"), which reads as noise beside a
// city name. The current UTC offset is what a person recognises, so it is shown instead.
export function formatUtcOffset(timezoneId) {
    if (!timezoneId)
        return '';
    // new() would silently answer UTC for a bad id; new_identifier returns null, which
    // tells us there is nothing truthful to show.
    const zone = GLib.TimeZone.new_identifier(timezoneId);
    if (!zone)
        return '';

    // get_utc_offset answers a GTimeSpan, which is microseconds, so it is scaled to
    // seconds before the offset is broken out. TimeZone.get_offset is avoided: gjs
    // marshals its interval argument wrongly and the call fails its own assertion.
    const offsetSeconds = Math.round(GLib.DateTime.new_now(zone).get_utc_offset() / 1_000_000);
    const sign = offsetSeconds < 0 ? '-' : '+';
    const total = Math.abs(offsetSeconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Country and UTC offset, the details shared by every list that names a location. */
export function formatLocationDetails(location) {
    return [location.countryName, formatUtcOffset(location.timezone)].filter(Boolean).join(' · ');
}

export function getLocationDisplayName(location) {
    const details = formatLocationDetails(location);
    return details ? `${location.name} - ${details}` : location.name;
}

/** Stable identity for a location across a reload, so a saved choice can be re-found. */
export function locationKey(name, latitude, longitude) {
    return `${normalizeName(name)}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}
