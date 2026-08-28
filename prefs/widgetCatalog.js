import { isWideMusicLayout } from '../utils/widgetUtils.js';

export const STORE_WIDGETS = Object.freeze({
    weatherStandard: {
        title: 'Weather Standard',
        description: 'A clean weather widget with current conditions and temperature.',
        gridSize: '3x3',
        thumbnail: 'weathers/weather-standard.svg',
        fallbackIconName: 'weather-few-clouds-symbolic',
    },
    weatherMinimal: {
        title: 'Weather Minimal',
        description: 'A compact weather widget focused on the current condition and temperature.',
        gridSize: '3x3',
        thumbnail: 'weathers/weather-minimal.svg',
        fallbackIconName: 'weather-few-clouds-symbolic',
    },
    weatherForecast: {
        title: 'Weather Forecast',
        description: 'An expanded weather layout with hourly forecast details.',
        gridSize: '6x4',
        thumbnail: 'weathers/weather-forecast.svg',
        fallbackIconName: 'weather-overcast-symbolic',
    },
    musicPlayer: {
        title: 'Music Player',
        description: 'Displays the currently playing media album art.',
        gridSize: '4x4',
        thumbnail: 'music/music-small.svg',
        fallbackIconName: 'audio-x-generic-symbolic',
    },
    musicPlayerWide: {
        title: 'Music Player (Wide)',
        description: 'Wide layout displaying album art and player controls.',
        gridSize: '8x4',
        thumbnail: 'music/music-large.svg',
        fallbackIconName: 'audio-x-generic-symbolic',
    },
    timeAndDate: {
        title: 'Time & Date',
        description: 'A clean digital clock with the current date.',
        gridSize: '3x2',
        thumbnail: 'date-and-time/date-and-time.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    worldClock: {
        title: 'World Clock',
        description: 'Multi-city world clock displaying time across global timezones.',
        gridSize: '4x4',
        thumbnail: 'date-and-time/world-clock.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    imageGif: {
        title: 'Image / GIF',
        description: 'Display an image or animated GIF directly on your desktop.',
        gridSize: '2x2',
        thumbnail: 'images/image-and-slideshow.svg',
        fallbackIconName: 'image-x-generic-symbolic',
    },
    imageSlideshow: {
        title: 'Image Slideshow',
        description: 'Cycle through images in a folder with crossfade transitions.',
        gridSize: '4x4',
        thumbnail: 'images/image-and-slideshow.svg',
        fallbackIconName: 'view-paged-symbolic',
    },
    systemDashboard: {
        title: 'System Dashboard',
        description: 'All-in-one system dashboard with CPU history, temp, tasks, network speed, and RAM.',
        gridSize: '4x4',
        thumbnail: 'system-utils/system-dashboard.svg',
        fallbackIconName: 'resources-symbolic',
    },
    pomodoroTimer: {
        title: 'Pomodoro Timer',
        description: 'A focus timer with work and break cycles.',
        gridSize: '4x4',
        thumbnail: 'pomodoro/pomodoro.svg',
        fallbackIconName: 'alarm-symbolic',
    },
    pomodoroFocus: {
        title: 'Pomodoro Focus',
        description: 'Compact focus timer with mode switching, a circular gauge, and session tracking.',
        gridSize: '4x2',
        thumbnail: 'pomodoro/pomodoro-focus.svg',
        fallbackIconName: 'alarm-symbolic',
    },
    systemMonitor: {
        title: 'System Monitor',
        description: 'Monitor your CPU and RAM resource usage in real time.',
        gridSize: '4x2',
        thumbnail: 'system-utils/system-monitor.svg',
        fallbackIconName: 'resources-symbolic',
    },
    networkSpeed: {
        title: 'Network Speed',
        description: 'A live tracker for upload and download speeds.',
        gridSize: '3x2',
        thumbnail: 'system-utils/network-speed.svg',
        fallbackIconName: 'network-workgroup-symbolic',
    },
    quickNotes: {
        title: 'Quick Notes',
        description: 'A markdown sticky note to quickly write down notes.',
        gridSize: '4x4',
        thumbnail: 'quick-notes/quick-notes.svg',
        fallbackIconName: 'text-editor-symbolic',
    },
    clipboardHistory: {
        title: 'Clipboard History',
        description: 'Access a history of your recently copied text items.',
        gridSize: '4x4',
        thumbnail: 'clipboard/clipboard.svg',
        fallbackIconName: 'edit-copy-symbolic',
    },
    appLauncher: {
        title: 'App Launcher',
        description: 'Launch up to 8 installed applications from a compact desktop widget.',
        gridSize: '4x3',
        thumbnail: 'apps/app-launcher.svg',
        fallbackIconName: 'view-grid-symbolic',
    },
    calendarWidget: {
        title: 'Calendar',
        description: 'A monthly calendar with today highlighted and month navigation.',
        gridSize: '4x3',
        thumbnail: 'calendar/calendar.svg',
        fallbackIconName: 'x-office-calendar-symbolic',
    },
    quotesWidget: {
        title: 'Quotes',
        description: 'Daily quotes from philosophers, programmers, and thinkers that refresh every 30 seconds.',
        gridSize: '3x3',
        thumbnail: 'quotes/quotes.svg',
        fallbackIconName: 'help-about-symbolic',
    },
    screenTimeWidget: {
        title: 'Screen Time',
        description: 'Track your desktop screen time at a glance.',
        gridSize: '6x3',
        thumbnail: 'system-utils/screen-time.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    calendarGrid: {
        title: 'Month Calendar',
        description: 'A compact month grid with today highlighted and weekends colored.',
        gridSize: '4x4',
        thumbnail: 'calendar/month-calendar.svg',
        fallbackIconName: 'x-office-calendar-symbolic',
    },
    todoWidget: {
        title: 'Tasks',
        description: 'A todo list with a pending counter, checkable tasks, and quick add.',
        gridSize: '5x3',
        thumbnail: 'tasks/tasks.svg',
        fallbackIconName: 'view-list-symbolic',
    },
    githubWidget: {
        title: 'GitHub Activity',
        description: 'Your GitHub contribution graph with avatar, yearly total, and sync status.',
        gridSize: '7x3',
        thumbnail: 'github/github.svg',
        fallbackIconName: 'starred-symbolic',
    },
    rssHeadlinesWidget: {
        title: 'RSS Headlines',
        description: 'A compact card that auto-rotates through article headlines from any feed.',
        gridSize: '3x3',
        thumbnail: 'rss/rss-headlines.svg',
        fallbackIconName: 'application-rss+xml-symbolic',
    },
    moodWidget: {
        title: 'Mood Logger',
        description: 'Log how you feel each day and watch the past four weeks fill with color.',
        gridSize: '6x3',
        thumbnail: 'quotes/mood-logger.svg',
        fallbackIconName: 'face-smile-big-symbolic',
    },
    sunScheduleWidget: {
        title: 'Solar Schedule',
        description: 'Sunrise and sunset times for any city, powered by Open-Meteo.',
        gridSize: '3x3',
        thumbnail: 'solar-schedule/solar-schedule.svg',
        fallbackIconName: 'daytime-sunset-symbolic',
    },
});

export const STORE_CATEGORIES = Object.freeze({
    weather: ['weatherStandard', 'weatherMinimal', 'weatherForecast', 'sunScheduleWidget'],
    music: ['musicPlayer', 'musicPlayerWide'],
    time: ['timeAndDate', 'worldClock', 'calendarWidget', 'calendarGrid'],
    media: ['imageGif', 'imageSlideshow'],
    utilities: [
        'systemDashboard',
        'pomodoroTimer',
        'pomodoroFocus',
        'systemMonitor',
        'networkSpeed',
        'quickNotes',
        'clipboardHistory',
        'appLauncher',
        'quotesWidget',
        'screenTimeWidget',
        'githubWidget',
        'todoWidget',
        'rssHeadlinesWidget',
        'moodWidget',
    ],
});

function getWeatherEntryKey(widget) {
    const layout = widget.layout || (widget.width >= 6 ? 'forecast' : (widget.width === 4 ? 'simple' : 'standard'));
    if (layout === 'forecast') {
        return 'weatherForecast';
    }
    if (layout === 'simple') {
        return 'weatherMinimal';
    }
    return 'weatherStandard';
}

function getMusicEntryKey(widget) {
    if (isWideMusicLayout(widget)) {
        return 'musicPlayerWide';
    }
    return 'musicPlayer';
}

function getStoreWidgetKey(widget) {
    switch (widget.type) {
        case 'weather':
            return getWeatherEntryKey(widget);
        case 'music':
            return getMusicEntryKey(widget);
        case 'time':
            return widget.layout === 'world' ? 'worldClock' : 'timeAndDate';
        case 'slideshow':
            return 'imageSlideshow';
        case 'image':
            return 'imageGif';
        case 'system-dashboard':
            return 'systemDashboard';
        case 'pomodoro':
            return 'pomodoroTimer';
        case 'pomodoro-focus':
            return 'pomodoroFocus';
        case 'cpu-ram':
            return 'systemMonitor';
        case 'network-speed':
            return 'networkSpeed';
        case 'notes':
            return 'quickNotes';
        case 'clipboard':
            return 'clipboardHistory';
        case 'app-launcher':
            return 'appLauncher';
        case 'calendar':
            return 'calendarWidget';
        case 'calendar-grid':
            return 'calendarGrid';
        case 'quotes':
            return 'quotesWidget';
        case 'screen-time':
            return 'screenTimeWidget';
        case 'todo':
            return 'todoWidget';
        case 'github':
            return 'githubWidget';
        case 'rss-headlines':
        case 'rss-feed':
            return 'rssHeadlinesWidget';
        case 'mood':
            return 'moodWidget';
        case 'sun-schedule':
            return 'sunScheduleWidget';
        default:
            return null;
    }
}

export function getStoreWidgetEntry(widget) {
    const key = getStoreWidgetKey(widget);
    if (!key) {
        return null;
    }
    return STORE_WIDGETS[key] || null;
}

function getPathBaseName(filePath, fallbackText) {
    if (!filePath) {
        return fallbackText;
    }
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) {
        return fallbackText;
    }
    return parts[parts.length - 1];
}

export function getWidgetDetailText(widget) {
    switch (widget.type) {
        case 'weather':
            return `Location: ${widget.location || 'London'}`;
        case 'slideshow':
            return `Folder: ${getPathBaseName(widget.slideshowFolder, 'Unknown')}`;
        case 'image':
            return `File: ${getPathBaseName(widget.imagePath, 'Unknown')}`;
        case 'rss-headlines':
        case 'rss-feed':
            return `Feed: ${widget.feedUrl || 'Not configured'}`;
        case 'pomodoro-focus':
            return `Focus: ${widget.workMinutes || 25} min sessions`;
        case 'sun-schedule':
            return `Location: ${widget.city || 'Unknown'}`;
        case 'app-launcher': {
            const apps = Array.isArray(widget.apps) ? widget.apps : [];
            if (apps.length === 0) {
                return 'Apps: None selected';
            }
            const previewNames = apps.slice(0, 3).map(app => app.name || app.id);
            const remainingCount = apps.length - previewNames.length;
            const suffix = remainingCount > 0 ? ` +${remainingCount} more` : '';
            return `Apps: ${previewNames.join(', ')}${suffix}`;
        }
        default:
            return '';
    }
}
