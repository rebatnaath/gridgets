import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { createSwitchRow } from './aestheticControls.js';
import { loadMergedLocations } from './locationSources.js';
import { formatLocationDetails } from './locationCommon.js';
import { addPageStylesheet } from './displayUtils.js';

// Shown left-to-right starting on Monday, the common calendar week order, rather
// than the sunday-first order the stored day names happen to use.
const WEEKEND_DAY_ORDER = Object.freeze([
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
const WEEKEND_DAY_INITIALS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);

// Two weekend days at most, matching the accent styling the calendar widget draws.
const MAX_WEEKEND_DAYS = 2;

const WEEKEND_PICKER_RADIUS_PX = 9;
const WEEKEND_PICKER_PADDING_PX = 3;
const WEEKEND_DAY_MIN_WIDTH_PX = 24;
const WEEKEND_DAY_MIN_HEIGHT_PX = 26;
const WEEKEND_DAY_PADDING = '0 8px';
const WEEKEND_DAY_RADIUS_PX = 6;

const CSS_DATA = `
    /* The fill and text colours mirror libadwaita's Adw.ToggleGroup so the multi-select
       weekday picker matches the single-select Temperature control; the cell size is
       trimmed so seven letters do not squeeze the row's subtitle. */
    .weekend-day-picker {
        background: color-mix(in srgb, currentColor 10%, transparent);
        border-radius: ${WEEKEND_PICKER_RADIUS_PX}px;
        padding: ${WEEKEND_PICKER_PADDING_PX}px;
    }
    .weekend-day-picker button.weekend-day {
        min-width: ${WEEKEND_DAY_MIN_WIDTH_PX}px;
        min-height: ${WEEKEND_DAY_MIN_HEIGHT_PX}px;
        padding: ${WEEKEND_DAY_PADDING};
        border-radius: ${WEEKEND_DAY_RADIUS_PX}px;
    }
    .weekend-day-picker button.weekend-day:hover {
        background-color: color-mix(in srgb, currentColor 7%, transparent);
    }
    .weekend-day-picker button.weekend-day:checked {
        background-color: var(--active-toggle-bg-color);
        color: var(--active-toggle-fg-color);
        box-shadow: 0 1px 3px 1px RGB(0 0 6/7%), 0 2px 6px 2px RGB(0 0 6/3%);
    }
`;

function buildWeekendDayPicker(settings, selectedWeekendDays) {
    const picker = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        valign: Gtk.Align.CENTER,
        spacing: 3,
        css_classes: ['weekend-day-picker'],
    });
    let updatingWeekendDays = false;

    WEEKEND_DAY_ORDER.forEach((dayName, index) => {
        const toggle = new Gtk.ToggleButton({
            label: WEEKEND_DAY_INITIALS[index],
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'weekend-day'],
        });
        toggle.set_active(selectedWeekendDays.has(dayName));
        toggle.connect('toggled', () => {
            if (updatingWeekendDays)
                return;
            if (toggle.get_active()) {
                if (selectedWeekendDays.size >= MAX_WEEKEND_DAYS) {
                    // A third day is refused rather than bumping the oldest off, so a
                    // mis-click never silently changes which two days are highlighted.
                    updatingWeekendDays = true;
                    toggle.set_active(false);
                    updatingWeekendDays = false;
                    return;
                }
                selectedWeekendDays.add(dayName);
            } else {
                selectedWeekendDays.delete(dayName);
            }
            settings.set_strv('calendar-weekend-days', [...selectedWeekendDays]);
        });
        picker.append(toggle);
    });

    return picker;
}

function buildTimeAndCalendarGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Time and Calendar',
        description: 'Configure the time format and month calendar.',
    });

    group.add(createSwitchRow(
        '24-Hour Format',
        'Use 24-hour time instead of 12-hour time.',
        settings,
        'time-format-24h'
    ).row);

    const firstDayRow = new Adw.ComboRow({
        title: 'First Day of Week',
        subtitle: 'Use the calendar default or choose a day.',
        model: new Gtk.StringList({
            strings: ['Calendar default', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        }),
    });
    firstDayRow.selected = Math.max(0, settings.get_int('calendar-first-day') + 1);
    firstDayRow.connect('notify::selected', () => {
        settings.set_int('calendar-first-day', firstDayRow.selected - 1);
    });
    group.add(firstDayRow);

    const selectedWeekendDays = new Set(
        settings.get_strv('calendar-weekend-days')
            .filter(day => WEEKEND_DAY_ORDER.includes(day))
    );
    // The month calendar always highlights the chosen days, and no control turns the
    // accent off, so the stored flag is forced on to match.
    settings.set_boolean('calendar-weekend-accent', true);

    const weekendRow = new Adw.ActionRow({
        title: 'Weekend Days',
        subtitle: 'Highlighted in the month calendar.',
    });
    weekendRow.add_suffix(buildWeekendDayPicker(settings, selectedWeekendDays));
    group.add(weekendRow);
    return group;
}

// Names the app a saved city came from. A city saved in both apps lists both, which is
// why the value is an array rather than a single source.
const SOURCE_LABELS = Object.freeze({
    weather: 'GNOME Weather',
    clocks: 'GNOME Clocks',
});

function formatSources(sources) {
    return (sources ?? []).map(source => SOURCE_LABELS[source] ?? source).join(' · ');
}

function buildLocationRow(location) {
    const subtitle = [
        formatLocationDetails(location),
        formatSources(location.sources),
    ].filter(Boolean).join(' · ');

    return new Adw.ActionRow({
        title: location.name,
        subtitle,
    });
}

function buildLocationsGroup(isDisposed) {
    const group = new Adw.PreferencesGroup({
        title: 'Locations',
        description: 'Cities are shared with GNOME Weather and GNOME Clocks.',
    });

    // The list comes from two other apps, so it is read asynchronously. The page can be
    // closed before the read finishes, hence the disposal guard around every add.
    loadMergedLocations()
        .then(result => {
            if (isDisposed())
                return;
            if (result.locations.length === 0) {
                group.add(new Adw.ActionRow({
                    title: 'No saved cities',
                    subtitle: result.message,
                }));
                return;
            }
            for (const location of result.locations)
                group.add(buildLocationRow(location));
        })
        .catch(error => console.error('Unable to load saved cities:', error));

    return group;
}

function buildUnitsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Units',
    });

    const row = new Adw.ActionRow({
        title: 'Temperature',
        subtitle: 'Used by weather widgets.',
    });
    const unitToggle = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER });
    unitToggle.add(new Adw.Toggle({ name: 'celsius', label: '°C' }));
    unitToggle.add(new Adw.Toggle({ name: 'fahrenheit', label: '°F' }));
    unitToggle.set_active_name(settings.get_boolean('weather-use-fahrenheit') ? 'fahrenheit' : 'celsius');
    unitToggle.connect('notify::active-name', () => {
        settings.set_boolean('weather-use-fahrenheit', unitToggle.get_active_name() === 'fahrenheit');
    });
    row.add_suffix(unitToggle);
    group.add(row);

    return group;
}

export function buildRegionPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Region',
        icon_name: 'preferences-desktop-locale-symbolic',
    });

    addPageStylesheet(page, CSS_DATA);
    let disposed = false;
    page.connect('destroy', () => {
        disposed = true;
    });
    page.add(buildTimeAndCalendarGroup(settings));
    page.add(buildUnitsGroup(settings));
    page.add(buildLocationsGroup(() => disposed));
    return page;
}
