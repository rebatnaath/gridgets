import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { loadGWeather } from './appAvailability.js';

const WEATHER_SCHEMA_ID = 'org.gnome.Weather';
const COORDINATE_TOLERANCE = 0.0001;

function hasValidCoordinates(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
}

function normalizeName(name) {
    return name.trim().toLocaleLowerCase();
}

function locationsMatch(firstLocation, secondLocation) {
    if (!firstLocation || !secondLocation)
        return false;

    const hasFirstCoordinates = firstLocation.latitude !== undefined && firstLocation.longitude !== undefined;
    const hasSecondCoordinates = secondLocation.latitude !== undefined && secondLocation.longitude !== undefined;
    if (hasFirstCoordinates && hasSecondCoordinates) {
        return Math.abs(firstLocation.latitude - secondLocation.latitude) <= COORDINATE_TOLERANCE
            && Math.abs(firstLocation.longitude - secondLocation.longitude) <= COORDINATE_TOLERANCE;
    }

    return normalizeName(firstLocation.name) === normalizeName(secondLocation.name);
}

export function findGnomeWeatherLocation(locations, savedLocation) {
    return locations.find(location => locationsMatch(location, savedLocation)) ?? null;
}

function getLocationDisplayName(location) {
    const details = [location.countryName, location.timezone].filter(Boolean);
    return details.length > 0
        ? `${location.name} - ${details.join(' · ')}`
        : location.name;
}

function launchGnomeWeather() {
    return new Promise(resolve => {
        const parameters = new GLib.Variant('(a{sv})', [{}]);
        Gio.DBus.session.call(
            'org.gnome.Weather',
            '/org/gnome/Weather',
            'org.gtk.Application',
            'Activate',
            parameters,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            }
        );
    });
}

async function loadGnomeWeatherLocations() {
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
        const world = GWeather.Location.get_world();
        const serializedLocations = settings.get_value('locations').deep_unpack();
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
            };
            const locationKey = `${normalizeName(name)}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
            if (locationKeys.has(locationKey)) continue;

            locationKeys.add(locationKey);
            locations.push(normalizedLocation);
        }

        if (locations.length === 0) {
            return { locations, message: 'No saved cities found. Add a city in GNOME Weather first.' };
        }

        return { locations, message: '' };
    } catch (error) {
        console.error('Unable to load GNOME Weather locations:', error);
        return { locations: [], message: 'GNOME Weather locations could not be loaded in this environment.' };
    }
}

export function createGnomeWeatherLocationPicker(savedLocation = null, onLocationsChanged = null) {
    let locations = [];
    const dropdown = new Gtk.DropDown({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END,
        hexpand: true,
    });
    const statusLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        css_classes: ['dim-label'],
    });
    const openWeatherButton = new Gtk.Button({
        label: 'Open GNOME Weather',
        css_classes: ['suggested-action'],
        tooltip_text: 'Add a city to GNOME Weather',
    });
    const refreshButton = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        tooltip_text: 'Check GNOME Weather for saved cities',
    });
    const actionBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        halign: Gtk.Align.END,
    });
    actionBox.append(openWeatherButton);
    actionBox.append(refreshButton);

    const locationWidget = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        hexpand: true,
    });
    locationWidget.append(dropdown);

    const supportingWidget = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        hexpand: true,
    });
    supportingWidget.append(statusLabel);
    supportingWidget.append(actionBox);

    const reload = async () => {
        const result = await loadGnomeWeatherLocations();
        locations = result.locations;
        dropdown.set_model(Gtk.StringList.new(locations.map(getLocationDisplayName)));
        dropdown.set_visible(locations.length > 0);
        dropdown.set_sensitive(locations.length > 0);
        actionBox.set_visible(true);

        const selectedLocation = findGnomeWeatherLocation(locations, savedLocation);
        if (selectedLocation) {
            dropdown.set_selected(locations.indexOf(selectedLocation));
            statusLabel.set_text('');
        } else if (locations.length === 0) {
            dropdown.set_selected(-1);
            statusLabel.set_text(result.message);
        } else if (savedLocation?.name) {
            dropdown.set_selected(-1);
            statusLabel.set_text(`${savedLocation.name} is not currently saved in GNOME Weather. Choose a replacement.`);
        }

        statusLabel.set_visible(statusLabel.get_text().length > 0);
        if (onLocationsChanged) onLocationsChanged(locations.length > 0);
    };

    openWeatherButton.connect('clicked', async () => {
        openWeatherButton.set_sensitive(false);
        const didLaunch = await launchGnomeWeather();
        openWeatherButton.set_sensitive(true);
        if (!didLaunch) {
            statusLabel.set_text('GNOME Weather could not be launched. Make sure it is installed, then try again.');
            statusLabel.set_visible(true);
        }
    });
    refreshButton.connect('clicked', reload);
    reload();

    return {
        locationWidget,
        supportingWidget,
        get hasLocations() {
            return locations.length > 0;
        },
        reload,
        getSelectedLocation() {
            const selectedIndex = dropdown.get_selected();
            return selectedIndex >= 0 ? locations[selectedIndex] : null;
        },
    };
}
