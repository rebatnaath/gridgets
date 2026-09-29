// Shared by the GNOME Clocks and GNOME Weather location pickers, which read their
// locations through different APIs but agree on how a location is validated, keyed
// and displayed.

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

export function getLocationDisplayName(location) {
    const details = [location.countryName, location.timezone].filter(Boolean);
    return details.length > 0
        ? `${location.name} - ${details.join(' · ')}`
        : location.name;
}

/** Stable identity for a location across a reload, so a saved choice can be re-found. */
export function locationKey(name, latitude, longitude) {
    return `${normalizeName(name)}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}
