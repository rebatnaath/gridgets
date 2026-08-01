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
    commandLauncher: {
        title: 'Command Launcher',
        description: 'Run custom bash scripts and commands from your desktop.',
        gridSize: '2x2',
        thumbnail: 'commands/commands.svg',
        fallbackIconName: 'system-run-symbolic',
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
});

/** Catalog entries for panel indicators (not desktop widgets). */
export const PANEL_WIDGETS = Object.freeze({
    screenTime: {
        title: 'Screen Time',
        description: 'Tracks how long each app has been in focus today. Shows a ranked list with usage bars in the panel.',
        settingKey: 'panel-screen-time',
        thumbnail: 'panel/screen-time.svg',
        fallbackIconName: 'preferences-system-time-symbolic',
    },
    storePanel: {
        title: 'Store Panel Button',
        description: 'Quick-add widgets from a panel popup. Image, Slideshow, Command, and World Clock are omitted — use the full Store page for those.',
        settingKey: 'panel-store-button',
        thumbnail: 'panel/panel-store.svg',
        fallbackIconName: 'software-update-available-symbolic',
    },
});

export const STORE_CATEGORIES = Object.freeze({
    weather: ['weatherStandard', 'weatherMinimal', 'weatherForecast'],
    music: ['musicPlayer', 'musicPlayerWide'],
    time: ['timeAndDate', 'worldClock', 'calendarWidget'],
    media: ['imageGif', 'imageSlideshow'],
    utilities: [
        'systemDashboard',
        'pomodoroTimer',
        'systemMonitor',
        'networkSpeed',
        'quickNotes',
        'clipboardHistory',
        'commandLauncher',
        'appLauncher',
        'quotesWidget',
    ],
    panel: ['screenTime', 'storePanel'],
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
    if (widget.width === widget.height * 2 || widget.isLargeLayout) {
        return 'musicPlayerWide';
    }
    return 'musicPlayer';
}

export function getStoreWidgetKey(widget) {
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
        case 'cpu-ram':
            return 'systemMonitor';
        case 'network-speed':
            return 'networkSpeed';
        case 'notes':
            return 'quickNotes';
        case 'clipboard':
            return 'clipboardHistory';
        case 'command':
            return 'commandLauncher';
        case 'app-launcher':
            return 'appLauncher';
        case 'calendar':
            return 'calendarWidget';
        case 'quotes':
            return 'quotesWidget';
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
        case 'command':
            return `Command: ${widget.commandName || 'Launcher'}`;
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
