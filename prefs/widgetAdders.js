import {
    addWidget,
    nextWidgetId,
    normalizeAppLauncherApps,
    DEFAULT_TOP_STORY_GENRE,
} from '../utils/widgetUtils.js';

export const DEFAULT_RSS_REFRESH_MINUTES = 15;

export function addTimeWidget(settings, layout = 'digital', cities = null) {
    const config = { id: nextWidgetId(settings, 'time'), type: 'time', layout };
    if (cities && Array.isArray(cities)) {
        config.cities = cities;
    }
    addWidget(settings, config);
}

export function addWeatherWidget(settings, location, layout = 'standard') {
    if (!location?.name || location.latitude === undefined || location.longitude === undefined)
        return;

    addWidget(settings, {
        id: nextWidgetId(settings, 'weather'),
        type: 'weather',
        location: location.name,
        lat: location.latitude,
        lon: location.longitude,
        layout,
        weatherDynamicColorFollowGlobal: true,
        weatherDynamicImageFollowGlobal: true,
    });
}

export function addMusicWidget(settings, isWide = false) {
    const config = { id: nextWidgetId(settings, 'music'), type: 'music' };
    // Must set before addWidget, which keys off isWideMusicLayout()
    config.isLargeLayout = isWide;
    addWidget(settings, config);
}

export function addPomodoroWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro'), type: 'pomodoro' });
}

export function addPomodoroFocusWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'pomodoro-focus'), type: 'pomodoro-focus' });
}

export function addCpuRamWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'cpu-ram'), type: 'cpu-ram' });
}

export function addNetworkSpeedWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'network-speed'), type: 'network-speed' });
}

export function addSystemDashboardWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'system-dashboard'), type: 'system-dashboard' });
}

export function addNotesWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'notes'), type: 'notes' });
}

export function addClipboardWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'clipboard'), type: 'clipboard' });
}

export function addCalendarWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar'), type: 'calendar' });
}

export function addQuotesWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'quotes'), type: 'quotes' });
}

export function addScreenTimeWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'screen-time'), type: 'screen-time' });
}

export function addCalendarGridWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar-grid'), type: 'calendar-grid' });
}

export function addCalendarAgendaWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'calendar-agenda'), type: 'calendar-agenda' });
}

export function addTodoWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'todo'), type: 'todo' });
}

export function addGithubWidget(settings, username = '') {
    const widgetConfig = { id: nextWidgetId(settings, 'github'), type: 'github' };
    if (username)
        widgetConfig.username = username;
    addWidget(settings, widgetConfig);
}

export function addRssHeadlinesWidget(settings, feedUrl = '') {
    if (!feedUrl)
        return;
    addWidget(settings, {
        id: nextWidgetId(settings, 'rss-headlines'),
        type: 'rss-headlines',
        feedUrl,
        refreshMinutes: DEFAULT_RSS_REFRESH_MINUTES,
    });
}

export function addTopStoriesWidget(settings, genre = DEFAULT_TOP_STORY_GENRE) {
    addWidget(settings, { id: nextWidgetId(settings, 'top-stories'), type: 'top-stories', genre });
}

export function addMoodWidget(settings) {
    addWidget(settings, { id: nextWidgetId(settings, 'mood'), type: 'mood' });
}

export function addSunScheduleWidget(settings, city, latitude, longitude) {
    addWidget(settings, {
        id: nextWidgetId(settings, 'sun-schedule'),
        type: 'sun-schedule',
        city,
        latitude,
        longitude,
    });
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
    });
}

export function addSlideshowWidget(settings, folderPath, intervalSeconds = 10, width = 4, height = 4, caption = 'My Slideshow', showCaption = true, useDateCaption = false) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Slideshow';
    const widgetConfig = {
        id: nextWidgetId(settings, 'slideshow'),
        type: 'slideshow',
        slideshowFolder: folderPath,
        intervalSeconds,
        caption: finalCaption,
        showCaption: showCaption !== false,
        captionFollowGlobal: false,
        useDateCaption: useDateCaption === true,
    };

    addWidget(settings, widgetConfig, width, height);
}

export function addImageWidget(settings, imagePath, caption = 'My Image', showCaption = true, width = 2, height = 2, useDateCaption = false) {
    const finalCaption = caption && caption.trim() !== '' ? caption.trim() : 'My Image';
    const widgetConfig = {
        id: nextWidgetId(settings, 'image'),
        type: 'image',
        imagePath,
        caption: finalCaption,
        showCaption: showCaption !== false,
        captionFollowGlobal: false,
        useDateCaption: useDateCaption === true,
    };

    addWidget(settings, widgetConfig, width, height);
}
