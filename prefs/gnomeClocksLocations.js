import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { loadGWeather } from './appAvailability.js';

const CLOCKS_BUS_NAME = 'org.gnome.clocks';
const CLOCKS_OBJECT_PATH = '/org/gnome/clocks';
const CLOCKS_INTERFACE = 'org.gnome.Shell.ClocksIntegration';

function normalizeName(name) {
    return name.trim().toLocaleLowerCase();
}

function hasValidCoordinates(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
}

function getLocationDisplayName(location) {
    const details = [location.countryName, location.timezone].filter(Boolean);
    return details.length > 0
        ? `${location.name} - ${details.join(' · ')}`
        : location.name;
}

function launchGnomeClocks() {
    return new Promise(resolve => {
        const appInfo = Gio.AppInfo.create_from_commandline('gnome-clocks', GLib.SpawnFlags.SEARCH_PATH, null);
        if (!appInfo) {
            resolve(false);
            return;
        }

        try {
            appInfo.launch([], null);
        } catch (error) {
            console.error('Unable to launch GNOME Clocks:', error);
            resolve(false);
            return;
        }

        // Give the app a moment to start before the caller reloads locations.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            resolve(true);
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function getGnomeClocksLocations() {
    const GWeather = await loadGWeather();
    if (!GWeather)
        return { locations: [], message: 'GNOME Clocks locations could not be loaded in this environment.' };

    return new Promise(resolve => {
        const parameters = new GLib.Variant('(ss)', [CLOCKS_INTERFACE, 'Locations']);
        Gio.DBus.session.call(
            CLOCKS_BUS_NAME,
            CLOCKS_OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Get',
            parameters,
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result).deep_unpack();
                    const serializedLocations = reply[0].deep_unpack();
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
                        };
                        const locationKey = `${normalizeName(name)}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
                        if (locationKeys.has(locationKey)) continue;

                        locationKeys.add(locationKey);
                        locations.push(normalizedLocation);
                    }

                    resolve({ locations, message: locations.length === 0 ? 'No world clocks found in GNOME Clocks.' : '' });
                } catch (error) {
                    console.error('Unable to load GNOME Clocks locations:', error);
                    resolve({ locations: [], message: 'GNOME Clocks could not be reached. Open it and try again.' });
                }
            }
        );
    });
}

export function createGnomeClocksLocationPicker(savedLocation = null, initialIndex = 0) {
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
    const openClocksButton = new Gtk.Button({
        label: 'Open GNOME Clocks',
        css_classes: ['suggested-action'],
        tooltip_text: 'Add a world clock in GNOME Clocks',
    });
    const refreshButton = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        tooltip_text: 'Check GNOME Clocks for saved world clocks',
    });
    const actionBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        halign: Gtk.Align.END,
    });
    actionBox.append(openClocksButton);
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

    const reload = async () => {
        const result = await getGnomeClocksLocations();
        locations = result.locations;
        dropdown.set_model(Gtk.StringList.new(locations.map(getLocationDisplayName)));
        dropdown.set_visible(true);
        dropdown.set_sensitive(locations.length > 0);

        const selectedLocation = savedLocation
            ? locations.find(location => normalizeName(location.name) === normalizeName(savedLocation.name)
                && (!savedLocation.timezone || location.timezone === savedLocation.timezone))
            : null;
        if (selectedLocation) {
            dropdown.set_selected(locations.indexOf(selectedLocation));
            statusLabel.set_text('');
        } else {
            dropdown.set_selected(locations.length > 0 ? Math.min(initialIndex, locations.length - 1) : -1);
            statusLabel.set_text(result.message || (savedLocation?.name ? `${savedLocation.name} is no longer saved in GNOME Clocks.` : ''));
        }

        statusLabel.set_visible(statusLabel.get_text().length > 0);
    };

    openClocksButton.connect('clicked', async () => {
        openClocksButton.set_sensitive(false);
        const didLaunch = await launchGnomeClocks();
        openClocksButton.set_sensitive(true);
        if (!didLaunch) {
            statusLabel.set_text('GNOME Clocks could not be launched. Make sure it is installed, then try again.');
            statusLabel.set_visible(true);
        } else {
            await reload();
        }
    });
    refreshButton.connect('clicked', () => {
        reload().catch(error => console.error('Unable to refresh GNOME Clocks locations:', error));
    });
    reload().catch(error => console.error('Unable to load GNOME Clocks locations:', error));

    return {
        locationWidget,
        supportingWidget,
        actionWidget: actionBox,
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
