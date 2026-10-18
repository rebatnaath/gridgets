import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { loadMergedLocations } from './locationSources.js';
import { normalizeName, getLocationDisplayName } from './locationCommon.js';

const COORDINATE_TOLERANCE = 0.0001;

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
        tooltip_text: 'Check GNOME Weather and GNOME Clocks for saved cities',
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
        const result = await loadMergedLocations();
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
            statusLabel.set_text(`${savedLocation.name} is not saved in GNOME Weather or GNOME Clocks. Choose a replacement.`);
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
