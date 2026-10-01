import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { loadGWeather } from './appAvailability.js';
import { normalizeName, hasValidCoordinates, getLocationDisplayName, locationKey } from './locationCommon.js';

const CLOCKS_BUS_NAME = 'org.gnome.clocks';
const CLOCKS_OBJECT_PATH = '/org/gnome/clocks';
const CLOCKS_INTERFACE = 'org.gnome.Shell.ClocksIntegration';

function launchGnomeClocks() {
    return new Promise(resolve => {
        // (commandline, working_directory, flags). Passing the flags second throws.
        const appInfo = Gio.AppInfo.create_from_commandline('gnome-clocks', null, GLib.SpawnFlags.SEARCH_PATH);
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
                        const key = locationKey(name, latitude, longitude);
                        if (locationKeys.has(key)) continue;

                        locationKeys.add(key);
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

/**
 * The GNOME Clocks buttons, shared so a list of pickers carries one pair rather than a
 * pair per row. `reload` is supplied by the caller, which is what lets the list refresh
 * every row from one click. `onError` is for the one failure a reload cannot report:
 * GNOME Clocks refusing to start.
 */
export function createClocksActionRow(reload, onError = null) {
    const openClocksButton = new Gtk.Button({
        label: 'Open GNOME Clocks',
        css_classes: ['suggested-action'],
        tooltip_text: 'Add a world clock in GNOME Clocks',
    });
    const refreshButton = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        tooltip_text: 'Check GNOME Clocks for saved world clocks',
    });
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        halign: Gtk.Align.END,
    });
    box.append(openClocksButton);
    box.append(refreshButton);

    openClocksButton.connect('clicked', async () => {
        openClocksButton.set_sensitive(false);
        const didLaunch = await launchGnomeClocks();
        openClocksButton.set_sensitive(true);
        if (!didLaunch) {
            if (onError)
                onError('GNOME Clocks could not be launched. Make sure it is installed, then try again.');
            return;
        }
        await reload();
    });

    refreshButton.connect('clicked', () => {
        reload().catch(error => console.error('Unable to refresh GNOME Clocks locations:', error));
    });

    return box;
}

/**
 * Which entry of a freshly loaded list a picker should land on.
 *
 * The current selection is tried before the saved city, because a reload exists to pick
 * up cities added in GNOME Clocks and must not undo a choice made since the picker was
 * built. Returns -1 when neither is in the list any more, leaving the fallback to the
 * caller, which differs between the local and non-local pickers.
 */
export function findReloadedSelectionIndex(locations, candidates) {
    const list = locations || [];
    for (const candidate of candidates) {
        if (!candidate?.name) continue;
        const wantedName = normalizeName(candidate.name);
        const at = list.findIndex(location => normalizeName(location.name) === wantedName
            && (!candidate.timezone || location.timezone === candidate.timezone));
        if (at >= 0) return at;
    }
    return -1;
}

/**
 * The first city not already chosen by a sibling picker, so a row added to a list starts
 * somewhere new instead of on a duplicate of the row above it.
 */
export function firstUnusedSelectionIndex(locations, excludeNames) {
    const taken = new Set((excludeNames || []).map(name => normalizeName(name)));
    const list = locations || [];
    const at = list.findIndex(location => !taken.has(normalizeName(location.name)));
    return at >= 0 ? at : 0;
}

export function createGnomeClocksLocationPicker(savedLocation = null, onLocationsChanged = null, allowLocal = false, excludeNames = []) {
    let locations = [];
    // With a local entry in front, index 0 means local and the cities start one later.
    const offset = allowLocal ? 1 : 0;
    const localEntryLabel = 'Local Time';
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
    const supportingWidget = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        hexpand: true,
    });
    supportingWidget.append(statusLabel);

    const locationWidget = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        hexpand: true,
    });
    locationWidget.append(dropdown);

    const reload = async () => {
        // Read before the model is rebuilt: this is the choice a refresh has to preserve.
        const selectedIndex = dropdown.get_selected();
        const currentLocation = selectedIndex >= offset ? locations[selectedIndex - offset] || null : null;

        const result = await getGnomeClocksLocations();
        locations = result.locations;
        const labels = locations.map(getLocationDisplayName);
        dropdown.set_model(Gtk.StringList.new(allowLocal ? [localEntryLabel, ...labels] : labels));
        dropdown.set_visible(true);
        dropdown.set_sensitive(allowLocal || locations.length > 0);

        const kept = findReloadedSelectionIndex(locations, [currentLocation, savedLocation]);
        if (kept >= 0) {
            dropdown.set_selected(offset + kept);
        } else if (allowLocal) {
            // Local is the fallback whenever nothing is saved or the saved city is gone,
            // so the widget never opens on a city the user did not choose.
            dropdown.set_selected(0);
        } else if (locations.length === 0) {
            dropdown.set_selected(-1);
        } else {
            dropdown.set_selected(offset + firstUnusedSelectionIndex(locations, excludeNames));
        }

        // Only a failure to load is worth saying. A saved city that is simply gone is not:
        // the dropdown has already fallen back, and naming the absent city reads as an
        // error where the list is working correctly.
        statusLabel.set_text(locations.length > 0 ? '' : result.message);
        statusLabel.set_visible(statusLabel.get_text().length > 0);
        if (onLocationsChanged) onLocationsChanged(locations.length > 0);
    };

    const actionWidget = createClocksActionRow(reload, message => {
        statusLabel.set_text(message);
        statusLabel.set_visible(true);
    });

    reload().catch(error => console.error('Unable to load GNOME Clocks locations:', error));

    return {
        locationWidget,
        supportingWidget,
        actionWidget,
        get hasLocations() {
            return locations.length > 0;
        },
        get statusText() {
            return statusLabel.get_text();
        },
        reload,
        // Null for the local entry, so a caller storing a single city can treat local and
        // "nothing saved in GNOME Clocks" the same way.
        getSelectedLocation() {
            const selectedIndex = dropdown.get_selected();
            if (selectedIndex < 0 || selectedIndex < offset)
                return null;
            return locations[selectedIndex - offset] || null;
        },
        // Fires on the picked city changing, not only when the locations load, so a
        // caller gating a button on a complete selection stays in step with the dropdown.
        connectSelectionChanged(handler) {
            dropdown.connect('notify::selected', () => handler());
            reload();
        },
    };
}
