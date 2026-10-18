import Gio from 'gi://Gio';
import { loadGWeather } from './appAvailability.js';
import { hasValidCoordinates, locationKey } from './locationCommon.js';

// GNOME Weather and GNOME Clocks keep their own saved city lists, but both resolve them
// against the same libgweather location database and the same serialized format, and both
// persist them in GSettings. Pooling the two therefore yields one list a widget can pick
// from no matter which app a city was saved in, while the per-widget "open app" button
// stays tied to its own app. Reading both from GSettings also means neither app has to be
// running: the Clocks D-Bus interface would launch it in the background just to be read.

const WEATHER_SCHEMA_ID = 'org.gnome.Weather';
const WEATHER_LOCATIONS_KEY = 'locations';

const CLOCKS_SCHEMA_ID = 'org.gnome.clocks';
const CLOCKS_LOCATIONS_KEY = 'world-clocks';

/** Turns a list of serialized GWeather locations into the shared normalized shape. */
function normalizeLocations(GWeather, serializedLocations, source) {
    const world = GWeather.Location.get_world();
    const locations = [];
    const locationKeys = new Set();

    for (const serializedLocation of serializedLocations) {
        const location = world.deserialize(serializedLocation);
        if (!location?.has_coords()) continue;

        const name = location.get_name() || location.get_city_name();
        const [latitude, longitude] = location.get_coords();
        if (!name || !hasValidCoordinates(latitude, longitude)) continue;

        const normalizedLocation = {
            name,
            latitude,
            longitude,
            countryName: location.get_country_name() || '',
            timezone: location.get_timezone_str() || '',
            // Which app the city was saved in, so a list that pools both apps can say
            // where each entry came from.
            sources: [source],
        };
        const key = locationKey(name, latitude, longitude);
        if (locationKeys.has(key)) continue;

        locationKeys.add(key);
        locations.push(normalizedLocation);
    }

    return locations;
}

export async function loadWeatherLocations() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(WEATHER_SCHEMA_ID, true);
    if (!schema) {
        return { locations: [], message: 'GNOME Weather is unavailable. Install GNOME Weather to select a saved city.' };
    }

    const GWeather = await loadGWeather();
    if (!GWeather) {
        return { locations: [], message: 'GNOME Weather is unavailable. Install GNOME Weather to select a saved city.' };
    }

    try {
        const settings = new Gio.Settings({ settings_schema: schema });
        const serializedLocations = settings.get_value(WEATHER_LOCATIONS_KEY).deep_unpack();
        const locations = normalizeLocations(GWeather, serializedLocations, 'weather');
        return {
            locations,
            message: locations.length === 0 ? 'No saved cities found. Add a city in GNOME Weather first.' : '',
        };
    } catch (error) {
        console.error('Unable to load GNOME Weather locations:', error);
        return { locations: [], message: 'GNOME Weather locations could not be loaded in this environment.' };
    }
}

export async function loadClocksLocations() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(CLOCKS_SCHEMA_ID, true);
    if (!schema) {
        return { locations: [], message: 'GNOME Clocks is unavailable. Install GNOME Clocks to select a saved city.' };
    }

    const GWeather = await loadGWeather();
    if (!GWeather)
        return { locations: [], message: 'GNOME Clocks locations could not be loaded in this environment.' };

    try {
        const settings = new Gio.Settings({ settings_schema: schema });
        const worldClocks = settings.get_value(CLOCKS_LOCATIONS_KEY);
        // Each world clock is a dict whose only stored field is the serialized location,
        // so the entries are collected before the shared normalize step reads them.
        const serializedLocations = [];
        const count = worldClocks.n_children();
        for (let index = 0; index < count; index++) {
            const location = worldClocks.get_child_value(index).lookup_value('location', null);
            if (location)
                serializedLocations.push(location);
        }

        const locations = normalizeLocations(GWeather, serializedLocations, 'clocks');
        return {
            locations,
            message: locations.length === 0 ? 'No world clocks found in GNOME Clocks.' : '',
        };
    } catch (error) {
        console.error('Unable to load GNOME Clocks locations:', error);
        return { locations: [], message: 'GNOME Clocks locations could not be loaded in this environment.' };
    }
}

/** Every saved city from both apps, deduplicated, with a message only when none loaded. */
export async function loadMergedLocations() {
    const [weather, clocks] = await Promise.all([loadWeatherLocations(), loadClocksLocations()]);
    const merged = new Map();

    for (const location of [...weather.locations, ...clocks.locations]) {
        const key = locationKey(location.name, location.latitude, location.longitude);
        const existing = merged.get(key);
        if (existing) {
            // A city saved in both apps is one row, but it keeps both sources.
            for (const source of location.sources) {
                if (!existing.sources.includes(source))
                    existing.sources.push(source);
            }
            continue;
        }
        merged.set(key, location);
    }

    const locations = [...merged.values()];
    return {
        locations,
        // A single source failing is not worth reporting while the other still supplies
        // cities, so the reasons are only surfaced when the merged list ends up empty.
        message: locations.length > 0 ? '' : mergeMessages(weather.message, clocks.message),
    };
}

function mergeMessages(...messages) {
    return [...new Set(messages.filter(Boolean))].join(' ');
}
