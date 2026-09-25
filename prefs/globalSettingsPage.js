import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { createSwitchRow } from './aestheticControls.js';
import { getConnectedMonitorsCount, buildMonitorEntries } from './displayUtils.js';

function buildMonitorGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Monitors',
        description: 'Choose where widgets are displayed by default.',
    });
    const monitorCount = getConnectedMonitorsCount();

    if (monitorCount <= 1) {
        group.add(new Adw.ActionRow({
            title: 'Target Monitor',
            subtitle: 'Only one monitor is currently connected.',
        }));
        return group;
    }

    const labels = [
        'Primary Monitor',
        'All Monitors (Span Canvas)',
        'All Monitors (Independent Grids)',
    ];
    const values = ['primary', 'all', 'each'];
    buildMonitorEntries(monitorCount).forEach(entry => {
        labels.push(entry.label);
        values.push(entry.key);
    });

    const monitorRow = new Adw.ComboRow({
        title: 'Target Monitor',
        subtitle: 'Select the default monitor or layout.',
        model: new Gtk.StringList({ strings: labels }),
    });
    const currentValue = settings.get_string('global-monitor') || 'primary';
    const currentIndex = values.indexOf(currentValue);
    monitorRow.set_selected(currentIndex >= 0 ? currentIndex : 0);
    monitorRow.connect('notify::selected', () => {
        const selectedValue = values[monitorRow.get_selected()];
        if (selectedValue)
            settings.set_string('global-monitor', selectedValue);
    });
    group.add(monitorRow);
    return group;
}

function buildImageGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Images',
        description: 'Configure image and slideshow widgets.',
    });
    group.add(createSwitchRow(
        'Animate GIFs',
        'Play animated GIFs automatically.',
        settings,
        'image-animate-gif'
    ).row);
    group.add(createSwitchRow(
        'Show Image Captions',
        'Show captions on image and GIF widgets.',
        settings,
        'image-show-caption'
    ).row);
    group.add(createSwitchRow(
        'Show Slideshow Captions',
        'Show captions on slideshow widgets.',
        settings,
        'slideshow-show-caption'
    ).row);
    return group;
}

function buildWeatherGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Weather',
        description: 'Configure weather widget appearance.',
    });
    group.add(createSwitchRow(
        'Use Fahrenheit',
        'Display temperatures in Fahrenheit instead of Celsius.',
        settings,
        'weather-use-fahrenheit'
    ).row);
    group.add(createSwitchRow(
        'Dynamic Weather Color',
        'Adjust widget colors for the current weather and time.',
        settings,
        'weather-dynamic-color'
    ).row);
    group.add(createSwitchRow(
        'Dynamic Weather Overlay',
        'Show an overlay image based on weather conditions.',
        settings,
        'weather-dynamic-image'
    ).row);
    group.add(new Adw.ActionRow({
        title: 'Saved Cities',
        subtitle: 'Manage cities in GNOME Weather.',
    }));
    return group;
}

function buildTimeGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Time',
        description: 'Configure the default time format.',
    });
    group.add(createSwitchRow(
        '24-Hour Format',
        'Use 24-hour time instead of 12-hour time.',
        settings,
        'time-format-24h'
    ).row);
    return group;
}

export function buildGlobalSettingsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Global Settings',
        icon_name: 'preferences-system-symbolic',
    });

    page.add(buildMonitorGroup(settings));
    page.add(buildImageGroup(settings));
    page.add(buildWeatherGroup(settings));
    page.add(buildTimeGroup(settings));
    return page;
}
