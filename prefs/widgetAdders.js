import {
    addWidget,
    nextWidgetId,
    normalizeAppLauncherApps,
    WIDE_MUSIC_LAYOUT_ASPECT_RATIO,
} from '../utils/widgetUtils.js';

export const DEFAULT_RSS_REFRESH_MINUTES = 15;

export function addTimeWidget(settings, width = 3, height = 2, layout = 'digital', cities = null) {
    const config = { id: nextWidgetId(settings, 'time'), type: 'time', layout };
    if (cities && Array.isArray(cities)) {
        config.cities = cities;
    }
    addWidget(settings, config, width, height);
}

export function addWeatherWidget(settings, city = 'London', width = 3, height = 3, layout = 'standard') {
    addWidget(settings, { id: nextWidgetId(settings, 'weather'), type: 'weather', location: city, layout }, width, height);
}

export function addMusicWidget(settings, width = 4, height = 4) {
    const config = { id: nextWidgetId(settings, 'music'), type: 'music' };
    // Must set before addWidget, which keys off isWideMusicLayout()
    config.isLargeLayout = width / height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
    addWidget(settings, config, width, height);
}

export function addPomodoroWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro'), type: 'pomodoro' }, width, height);
}

export function addPomodoroFocusWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro-focus'), type: 'pomodoro-focus' }, width, height);
}

export function addCpuRamWidget(settings, width = 4, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'cpu-ram'), type: 'cpu-ram' }, width, height);
}

export function addNetworkSpeedWidget(settings, width = 3, height = 2) {
    addWidget(settings, { id: nextWidgetId(settings, 'network-speed'), type: 'network-speed' }, width, height);
}

export function addSystemDashboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'system-dashboard'), type: 'system-dashboard' }, width, height);
}

export function addNotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'notes'), type: 'notes' }, width, height);
}

export function addClipboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'clipboard'), type: 'clipboard' }, width, height);
}

export function addCalendarWidget(settings, width = 4, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar'), type: 'calendar' }, width, height);
}

export function addQuotesWidget(settings, width = 3, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'quotes'), type: 'quotes' }, width, height);
}

export function addScreenTimeWidget(settings, width = 6, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'screen-time'), type: 'screen-time' }, width, height);
}

export function addCalendarGridWidget(settings, width = 4, height = 4) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar-grid'), type: 'calendar-grid' }, width, height);
}

export function addTodoWidget(settings, width = 5, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'todo'), type: 'todo' }, width, height);
}

export function addGithubWidget(settings, username = '', width = 7, height = 3) {
    const widgetConfig = { id: nextWidgetId(settings, 'github'), type: 'github' };
    if (username)
        widgetConfig.username = username;
    addWidget(settings, widgetConfig, width, height);
}

export function addRssHeadlinesWidget(settings, feedUrl = '', width = 3, height = 3) {
    if (!feedUrl)
        return;
    addWidget(settings, {
        id: nextWidgetId(settings, 'rss-headlines'),
        type: 'rss-headlines',
        feedUrl,
        refreshMinutes: DEFAULT_RSS_REFRESH_MINUTES,
    }, width, height);
}

export function addMoodWidget(settings, width = 6, height = 3) {
    addWidget(settings, { id: nextWidgetId(settings, 'mood'), type: 'mood' }, width, height);
}

export function addSunScheduleWidget(settings, city, latitude, longitude, width = 3, height = 3) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'sun-schedule'),
        type: 'sun-schedule',
        city,
        latitude,
        longitude,
    }, width, height);
}

export function addAppLauncherWidget(settings, apps) {
    const normalizedApps = normalizeAppLauncherApps(apps);
    if (normalizedApps.length === 0) {
        return;
    }

    addWidget(settings, {
        id: nextWidgetId(settings, 'app-launcher'),
        type: 'app-launcher',
        apps: normalizedApps,
    }, 4, 3);
}

export function addSlideshowWidget(settings, folderPath, intervalSeconds = 10, width = 4, height = 4, caption = 'My Slideshow', showCaption = true) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Slideshow';
    const widgetConfig = {
        id: nextWidgetId(settings, 'slideshow'),
        type: 'slideshow',
        slideshowFolder: folderPath,
        intervalSeconds,
        caption: finalCaption,
        showCaption: showCaption !== false,
    };

    addWidget(settings, widgetConfig, width, height);
}

export function addImageWidget(settings, imagePath, caption = 'My Image', showCaption = true, width = 2, height = 2) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Image';
    const widgetConfig = {
        id: nextWidgetId(settings, 'image'),
        type: 'image',
        imagePath,
        caption: finalCaption,
        showCaption: showCaption !== false,
    };

    addWidget(settings, widgetConfig, width, height);
}
