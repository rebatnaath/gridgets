/**
 * ============================================================================
 * PREFERENCES: WIDGET ADDERS
 * 
 * Grid collision detection and factory functions for persisting new widgets to
 * GSettings.
 * ============================================================================
 */

import {
    getWidgets,
    saveWidgets,
    findEmptySpot,
    addWidget,
    normalizeAppLauncherApps,
    getAppLauncherDefaultSize,
} from '../utils/widgetUtils.js';

export function addTimeWidget(settings, width = 3, height = 2, layout = 'digital', cities = null) {
    const config = { id: 'widget-time-' + Date.now(), type: 'time', layout };
    if (cities && Array.isArray(cities)) {
        config.cities = cities;
    }
    addWidget(settings, config, width, height);
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

export function addSystemDashboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-system-dashboard-' + Date.now(), type: 'system-dashboard' }, width, height);
}

export function addNotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-notes-' + Date.now(), type: 'notes' }, width, height);
}

export function addClipboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: 'widget-clipboard-' + Date.now(), type: 'clipboard' }, width, height);
}

export function addCalendarWidget(settings, width = 4, height = 3) {
    addWidget(settings, { id: 'widget-calendar-' + Date.now(), type: 'calendar' }, width, height);
}

export function addQuotesWidget(settings, width = 3, height = 3) {
    addWidget(settings, { id: 'widget-quotes-' + Date.now(), type: 'quotes' }, width, height);
}

export function addCommandWidget(settings, commandName, commandString, iconName, imagePath, showText = true, width = 2, height = 2) {
    addWidget(settings, {
        id: 'widget-command-' + Date.now(),
        type: 'command',
        commandName, commandString, iconName, imagePath, showText
    }, width, height);
}

export function addAppLauncherWidget(settings, apps) {
    const normalizedApps = normalizeAppLauncherApps(apps);
    if (normalizedApps.length === 0) {
        return;
    }

    const defaultSize = getAppLauncherDefaultSize(normalizedApps.length);
    addWidget(settings, {
        id: 'widget-app-launcher-' + Date.now(),
        type: 'app-launcher',
        apps: normalizedApps,
    }, defaultSize.width, defaultSize.height);
}

export function addSlideshowWidget(settings, folderPath, intervalSeconds = 10, width = 4, height = 4, caption = 'My Slideshow', showCaption = true) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Slideshow';
    const widgetConfig = {
        id: 'widget-slideshow-' + Date.now(),
        type: 'slideshow',
        slideshowFolder: folderPath,
        intervalSeconds,
        caption: finalCaption,
    };

    if (showCaption === false) {
        widgetConfig.showCaption = false;
        widgetConfig.showText = false;
    }

    addWidget(settings, widgetConfig, width, height);
}

export function addImageWidget(settings, imagePath, caption = 'My Image', showCaption = true, width = 2, height = 2) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Image';
    const widgetConfig = {
        id: 'widget-image-' + Date.now(),
        type: 'image',
        imagePath,
        caption: finalCaption,
    };

    if (showCaption === false) {
        widgetConfig.showCaption = false;
        widgetConfig.showText = false;
    }

    addWidget(settings, widgetConfig, width, height);
}
