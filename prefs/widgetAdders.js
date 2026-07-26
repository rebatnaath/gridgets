/**
 * ============================================================================
 * PREFERENCES: WIDGET ADDERS
 * 
 * Grid collision detection and factory functions for persisting new widgets to
 * GSettings.
 * ============================================================================
 */

import { getWidgets, saveWidgets, findEmptySpot } from '../utils/widgetUtils.js';

export function addWidget(settings, widgetData, defaultWidth, defaultHeight) {
    const widgets = getWidgets(settings);
    const pos = findEmptySpot(widgets, defaultWidth, defaultHeight, settings);
    widgetData.x = pos ? pos.x : 0;
    widgetData.y = pos ? pos.y : 0;
    widgetData.width = defaultWidth;
    widgetData.height = defaultHeight;
    widgets.push(widgetData);
    saveWidgets(settings, widgets);
}

export function addTimeWidget(settings, width = 3, height = 2) {
    addWidget(settings, { id: 'widget-time-' + Date.now(), type: 'time' }, width, height);
}

export function addWeatherWidget(settings, city = 'London', width = 3, height = 3, layout = 'standard') {
    addWidget(settings, { id: 'widget-weather-' + Date.now(), type: 'weather', location: city, layout }, width, height);
}

export function addMusicWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-music-' + Date.now(), type: 'music' }, width, height);
}

export function addPomodoroWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-pomodoro-' + Date.now(), type: 'pomodoro' }, width, height);
}

export function addCpuRamWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: 'widget-cpu-ram-' + Date.now(), type: 'cpu-ram' }, width, height);
}

export function addNetworkSpeedWidget(settings, width = 3, height = 2) {
    addWidget(settings, { id: 'widget-network-speed-' + Date.now(), type: 'network-speed' }, width, height);
}

export function addNotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-notes-' + Date.now(), type: 'notes' }, width, height);
}

export function addClipboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-clipboard-' + Date.now(), type: 'clipboard' }, width, height);
}

export function addCommandWidget(settings, commandName, commandString, iconName, imagePath, showText = true, width = 2, height = 2) {
    addWidget(settings, {
        id: 'widget-command-' + Date.now(),
        type: 'command',
        commandName, commandString, iconName, imagePath, showText
    }, width, height);
}

export function addSlideshowWidget(settings, folderPath, width = 4, height = 4, caption = '', showText = undefined) {
    addWidget(settings, {
        id: 'widget-slideshow-' + Date.now(),
        type: 'slideshow',
        slideshowFolder: folderPath,
        caption, showText
    }, width, height);
}

export function addImageWidget(settings, imagePath, caption = '', showText = undefined, width = 2, height = 2) {
    addWidget(settings, {
        id: 'widget-image-' + Date.now(),
        type: 'image',
        imagePath, caption, showText
    }, width, height);
}
