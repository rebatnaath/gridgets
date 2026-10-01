// Shared by the widget and the preferences process, so it must stay free of any gi
// import: the preferences process is GTK4 and cannot load St or Clutter.

export const MIN_CITY_COUNT = 2;
export const MAX_CITY_COUNT = 4;

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
