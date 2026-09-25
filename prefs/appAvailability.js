import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const WEATHER_SCHEMA_ID = 'org.gnome.Weather';

// GWeather ships with GNOME Weather, so the typelib is absent when that package
// is not installed. Importing it at module scope would abort loading the module,
// and therefore the whole preferences window, so resolve it lazily and let
// callers degrade instead.
let gWeatherPromise = null;

/** Resolves the GWeather namespace, or null when the typelib is unavailable. */
export function loadGWeather() {
    if (!gWeatherPromise) {
        gWeatherPromise = import('gi://GWeather?version=4.0')
            .then(module => module.default)
            .catch(error => {
                console.error('The GWeather typelib is unavailable:', error);
                gWeatherPromise = null;
                return null;
            });
    }

    return gWeatherPromise;
}

function hasSchema(schemaId) {
    return Boolean(Gio.SettingsSchemaSource.get_default().lookup(schemaId, true));
}

/** True when GNOME Weather is installed, so its cities can be read. */
export function isGnomeWeatherAvailable() {
    return hasSchema(WEATHER_SCHEMA_ID) && Boolean(GLib.find_program_in_path('gnome-weather'));
}

