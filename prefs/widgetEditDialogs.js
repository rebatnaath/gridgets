import Gtk from 'gi://Gtk';
import { getWidgets, saveWidgets } from '../utils/widgetUtils.js';
import {
    buildStandardSettings,
    buildRssSettings,
    buildSunScheduleSettings,
    buildWeatherSettings,
    buildTimeSettings,
    buildMusicSettings,
    buildPomodoroSettings,
    buildAppLauncherSettings,
    buildSlideshowSettings,
    buildGifSettings,
    buildImageSettings,
} from './widgetSettings.js';

export function buildWidgetEditPanel(parentWindow, widget, settings, onSavedCallback) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 12,
        margin_end: 12,
    });

    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 10 });
    box.append(grid);

    const saveHandlers = [];
    let rowIdx = 0;

    rowIdx = buildStandardSettings(grid, rowIdx, widget, settings, saveHandlers);

    switch (widget.type) {
        case 'rss-feed':
        case 'rss-headlines':
            rowIdx = buildRssSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'sun-schedule':
            rowIdx = buildSunScheduleSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'weather':
            rowIdx = buildWeatherSettings(grid, rowIdx, widget, settings, saveHandlers);
            break;
        case 'time':
            rowIdx = buildTimeSettings(grid, rowIdx, widget, settings, saveHandlers);
            break;
        case 'music':
            rowIdx = buildMusicSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'pomodoro-focus':
            rowIdx = buildPomodoroSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'app-launcher':
            rowIdx = buildAppLauncherSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'slideshow':
            rowIdx = buildSlideshowSettings(grid, rowIdx, widget, settings, saveHandlers);
            break;
        case 'gif':
            rowIdx = buildGifSettings(grid, rowIdx, widget, saveHandlers);
            break;
        case 'image':
            rowIdx = buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, parentWindow);
            break;
    }

    const saveButton = new Gtk.Button({
        label: 'Save Changes',
        css_classes: ['suggested-action', 'pill'],
        halign: Gtk.Align.END,
        margin_top: 10,
    });

    saveButton.connect('clicked', () => {
        const target = { ...widget };
        for (const handler of saveHandlers) {
            handler(target);
        }

        const widgets = getWidgets(settings);
        const idx = widgets.findIndex(w => w.id === widget.id);
        if (idx !== -1) {
            widgets[idx] = target;
            saveWidgets(settings, widgets);
        }

        if (onSavedCallback) {
            onSavedCallback(target);
        }
    });

    box.append(saveButton);
    return box;
}
