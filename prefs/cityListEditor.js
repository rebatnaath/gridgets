import Gtk from 'gi://Gtk';
import { createGnomeClocksLocationPicker, createClocksActionRow } from './gnomeClocksLocations.js';
import { MIN_CITY_COUNT, MAX_CITY_COUNT } from '../utils/worldClockCities.js';

/**
 * A list of city pickers whose length follows the supported count rather than a fixed
 * three, shared by the add dialog and the settings page so both edit a city list the
 * same way.
 *
 * The list starts at the number of cities already saved, or the minimum when there are
 * none, and grows to the maximum on request. Every picker keeps its own selection across
 * an add or a remove, so changing the count never discards a city the user already chose.
 *
 * @param {?Array} savedCities cities already stored on the widget, if any
 * @param {?Function} onChange called whenever the list length or a selection changes
 * @returns {{widget: Gtk.Widget, actionWidget: Gtk.Widget, getCities: Function, isComplete: Function}}
 */
export function createCityListEditor(savedCities = null, onChange = null) {
    // Only cities that can still be resolved are worth a row. This is deliberately not
    // resolveCityList: that pads a short list out to the defaults, and a widget with
    // nothing saved should open asking for the minimum rather than pre-filled with three.
    const saved = Array.isArray(savedCities) ? savedCities.filter(city => city?.timezone) : [];
    const pickers = [];

    const listBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        hexpand: true,
    });

    const statusLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        css_classes: ['dim-label'],
    });

    const addButton = new Gtk.Button({
        label: 'Add City',
        css_classes: ['flat'],
        halign: Gtk.Align.START,
        tooltip_text: `Show up to ${MAX_CITY_COUNT} cities`,
    });

    const actionBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        hexpand: true,
    });
    actionBox.append(addButton);

    const removeEntry = entry => {
        const at = pickers.indexOf(entry);
        if (at < 0 || pickers.length <= MIN_CITY_COUNT) return;
        listBox.remove(entry.box);
        pickers.splice(at, 1);
        relabel();
        notifyChanged();
    };

    const notifyChanged = () => {
        // One status line for the whole list. A per-row label would repeat the same
        // failure once per city, which is noise rather than information.
        const message = pickers.map(entry => entry.picker.statusText).find(text => text.length > 0) || '';
        statusLabel.set_text(message);
        statusLabel.set_visible(message.length > 0);
        syncControls();
        if (onChange) onChange();
    };

    const chosenNames = () => pickers
        .map(entry => entry.picker.getSelectedLocation()?.name)
        .filter(name => !!name);

    const createPicker = city => {
        // A row added to a list starts on a city the rows above it are not using, so the
        // list never comes back holding the same city twice by accident.
        const picker = createGnomeClocksLocationPicker(city, null, false, city ? [] : chosenNames());
        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            hexpand: true,
        });
        const label = new Gtk.Label({ xalign: 0, valign: Gtk.Align.CENTER });
        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Remove this city',
        });
        row.append(label);
        row.append(picker.locationWidget);
        row.append(removeButton);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
        });
        box.append(row);

        const entry = { picker, box, row, label, removeButton };
        removeButton.connect('clicked', () => removeEntry(entry));
        picker.connectSelectionChanged(notifyChanged);
        return entry;
    };

    const relabel = () => {
        pickers.forEach((entry, index) => entry.label.set_label(`City ${index + 1}:`));
    };

    const syncControls = () => {
        const anyHasLocations = pickers.some(entry => entry.picker.hasLocations);
        addButton.set_sensitive(pickers.length < MAX_CITY_COUNT && anyHasLocations);
        for (const entry of pickers)
            entry.removeButton.set_sensitive(pickers.length > MIN_CITY_COUNT);
    };

    const appendPicker = city => {
        const entry = createPicker(city);
        pickers.push(entry);
        listBox.append(entry.box);
        relabel();
        notifyChanged();
    };

    addButton.connect('clicked', () => {
        if (pickers.length >= MAX_CITY_COUNT) return;
        appendPicker(null);
    });

    // Refreshing every row from one pair of buttons is the point of sharing the action
    // row: each picker reloads the same list, so one click can drive all of them.
    actionBox.append(createClocksActionRow(
        () => Promise.all(pickers.map(entry => entry.picker.reload())),
        message => {
            statusLabel.set_text(message);
            statusLabel.set_visible(true);
        }
    ));

    const startCount = Math.min(Math.max(saved.length, MIN_CITY_COUNT), MAX_CITY_COUNT);
    for (let i = 0; i < startCount; i++)
        appendPicker(saved[i] ?? null);

    listBox.append(statusLabel);

    return {
        widget: listBox,
        actionWidget: actionBox,
        // Null entries are dropped rather than returned, so a half-filled list reads as
        // shorter instead of storing a hole the widget would have to guard against.
        getCities() {
            return pickers.map(entry => entry.picker.getSelectedLocation()).filter(Boolean);
        },
        // True when the list can be saved: at least the minimum, and every row chosen
        // with a timezone the widget can actually resolve.
        isComplete() {
            return pickers.length >= MIN_CITY_COUNT && pickers.every(entry => {
                const location = entry.picker.getSelectedLocation();
                return location !== null && !!location.timezone;
            });
        },
    };
}
