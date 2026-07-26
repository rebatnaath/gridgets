/**
 * ============================================================================
 * PREFERENCES: GLOBAL SETTINGS PAGE
 * 
 * Defines global extension settings including multi-monitor options, image/GIF
 * behavior, weather configurations, and time formats.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { createSwitchRow } from './aestheticControls.js';
import { performCitySearch } from './weatherSearch.js';
import { getWidgets, saveWidgets } from '../utils/widgetUtils.js';

export function buildGlobalSettingsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Global Settings',
        icon_name: 'preferences-system-symbolic',
    });

    // 1. Multi-Monitor Group
    const monitorGroup = new Adw.PreferencesGroup({
        title: 'Multi-Monitor Display',
        description: 'Choose default monitor display mode for widgets.',
    });
    const globalMonitorRow = new Adw.ComboRow({
        title: 'Global Target Monitor',
        subtitle: 'Choose which monitor(s) display widgets by default.',
        model: new Gtk.StringList({
            strings: ['Primary Monitor', 'All Monitors', 'Monitor 2', 'Monitor 3']
        }),
    });
    const monitorValues = ['primary', 'all', '1', '2'];
    const currentGlobalMonitor = settings.get_string('global-monitor') || 'primary';
    const currentIdx = monitorValues.indexOf(currentGlobalMonitor);
    globalMonitorRow.set_selected(currentIdx >= 0 ? currentIdx : 0);

    globalMonitorRow.connect('notify::selected', () => {
        const selectedVal = monitorValues[globalMonitorRow.get_selected()];
        settings.set_string('global-monitor', selectedVal);
    });
    monitorGroup.add(globalMonitorRow);
    page.add(monitorGroup);

    // 2. Image Settings Group
    const imageConfigGroup = new Adw.PreferencesGroup({
        title: 'Image Settings',
        description: 'Configuration for image and GIF widgets.',
    });
    imageConfigGroup.add(createSwitchRow('Animate GIFs', 'Toggle GIF animations on or off.', settings, 'image-animate-gif').row);
    imageConfigGroup.add(createSwitchRow('Show Image Captions', 'Toggle captions for image and GIF widgets.', settings, 'image-show-caption').row);
    imageConfigGroup.add(createSwitchRow('Show Slideshow Captions', 'Toggle captions for slideshow widgets.', settings, 'slideshow-show-caption').row);
    page.add(imageConfigGroup);

    // 3. Weather Settings Group
    const weatherConfigGroup = new Adw.PreferencesGroup({
        title: 'Weather Settings',
        description: 'Configure your default city and appearance.',
    });
    weatherConfigGroup.add(createSwitchRow('Use Fahrenheit (°F)', 'Display temperatures in Fahrenheit instead of Celsius by default.', settings, 'weather-use-fahrenheit').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Color', 'Change weather widget background color depending on the weather and time of day.', settings, 'weather-dynamic-color').row);
    weatherConfigGroup.add(createSwitchRow('Dynamic Weather Overlay Image', 'Show an overlay image depending on the weather condition.', settings, 'weather-dynamic-image').row);

    const searchRow = new Adw.ActionRow({
        title: 'Default City',
        subtitle: `Current: ${settings.get_string('weather-city')}`,
    });

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search city and press Enter...',
        width_request: 240,
        valign: Gtk.Align.CENTER,
    });
    searchRow.add_suffix(searchEntry);

    const resultsList = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        css_classes: ['boxed-list']
    });
    resultsList.set_margin_top(10);
    resultsList.set_margin_bottom(10);
    resultsList.set_visible(false);

    weatherConfigGroup.add(searchRow);
    weatherConfigGroup.add(resultsList);

    searchEntry.connect('activate', () => {
        const query = searchEntry.get_text();
        performCitySearch(query, resultsList, null, (locationName) => {
            settings.set_string('weather-city', locationName);
            searchRow.set_subtitle(`Current: ${locationName}`);
            searchEntry.set_text('');
            
            try {
                const widgets = getWidgets(settings);
                let modified = false;
                for (const widget of widgets) {
                    if (widget.type === 'weather') {
                        widget.location = locationName;
                        modified = true;
                    }
                }
                if (modified) {
                    saveWidgets(settings, widgets);
                }
            } catch (e) {
                console.error('Failed to update widgets with new location:', e);
            }

            let child = resultsList.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                resultsList.remove(child);
                child = next;
            }
            resultsList.set_visible(false);
        }, settings);
    });

    page.add(weatherConfigGroup);

    // 4. Time Settings Group
    const timeConfigGroup = new Adw.PreferencesGroup({
        title: 'Time Settings',
        description: 'Configuration for time widgets.',
    });
    timeConfigGroup.add(createSwitchRow('24-Hour Format', 'Use 24-hour time format instead of 12-hour.', settings, 'time-format-24h').row);
    
    page.add(timeConfigGroup);
    return page;
}
