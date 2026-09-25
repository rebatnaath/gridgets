import { createTimeNode } from '../widgets/time/index.js';
import { createWeatherNode, createSunScheduleNode } from '../widgets/weather/index.js';
import { createMusicNode } from '../widgets/music/index.js';
import { createNotesNode, createClipboardNode, createTodoNode } from '../widgets/productivity/index.js';
import { createCalendarNode, createCalendarGridNode } from '../widgets/calendar/index.js';
import { createQuotesNode, createGithubNode, createRssHeadlinesNode } from '../widgets/social/index.js';
import {
    createCpuRamNode,
    createNetworkSpeedNode,
    createSystemDashboardNode
} from '../widgets/system/index.js';
import { createPomodoroNode, createPomodoroFocusNode } from '../widgets/pomodoro/index.js';
import { createAppLauncherNode } from '../widgets/appLauncher/index.js';
import { createScreenTimeNode, createMoodNode } from '../widgets/wellness/index.js';
import {
    createStaticImageNode,
    createAnimatedImageNode,
    createSlideshowNode
} from '../widgets/media/index.js';
import { isAnimatedImageFile } from '../utils/widgetUtils.js';

const WIDGET_CREATORS = {
    'time': (data, w, h, x, y) => createTimeNode(data, w, h, x, y),
    'weather': (data, w, h, x, y) => {
        const dynamicColor = data.weatherDynamicColorFollowGlobal === true
            ? (data.globalWeatherDynamicColor !== false)
            : (data.dynamicColor !== undefined ? data.dynamicColor : (data.globalWeatherDynamicColor !== false));
        const dynamicImage = data.weatherDynamicImageFollowGlobal === true
            ? (data.globalWeatherDynamicImage !== false)
            : (data.dynamicImage !== undefined ? data.dynamicImage : (data.globalWeatherDynamicImage !== false));
        return createWeatherNode(data, w, h, x, y, dynamicColor, dynamicImage);
    },
    'music': (data, w, h, x, y) => createMusicNode(data, w, h, x, y),
    'notes': (data, w, h, x, y) => createNotesNode(data, w, h, x, y),
    'clipboard': (data, w, h, x, y) => createClipboardNode(data, w, h, x, y),
    'cpu-ram': (data, w, h, x, y) => createCpuRamNode(data, w, h, x, y),
    'network-speed': (data, w, h, x, y) => createNetworkSpeedNode(data, w, h, x, y),
    'system-dashboard': (data, w, h, x, y) => createSystemDashboardNode(data, w, h, x, y),
    'pomodoro': (data, w, h, x, y) => createPomodoroNode(data, w, h, x, y),
    'pomodoro-focus': (data, w, h, x, y) => createPomodoroFocusNode(data, w, h, x, y),
    'app-launcher': (data, w, h, x, y) => createAppLauncherNode(data, w, h, x, y),
    'calendar': (data, w, h, x, y) => createCalendarNode(data, w, h, x, y),
    'quotes': (data, w, h, x, y) => createQuotesNode(data, w, h, x, y),
    'screen-time': (data, w, h, x, y) => createScreenTimeNode(data, w, h, x, y),
    'calendar-grid': (data, w, h, x, y) => createCalendarGridNode(data, w, h, x, y),
    'todo': (data, w, h, x, y) => createTodoNode(data, w, h, x, y),
    'github': (data, w, h, x, y) => createGithubNode(data, w, h, x, y),
    'sun-schedule': (data, w, h, x, y) => createSunScheduleNode(data, w, h, x, y),
    'rss-headlines': (data, w, h, x, y) => createRssHeadlinesNode(data, w, h, x, y),
    'mood': (data, w, h, x, y) => createMoodNode(data, w, h, x, y),
    'slideshow': (data, w, h, x, y) => createSlideshowNode(data, w, h, x, y),
    'image': (data, w, h, x, y) => {
        if (data.imagePath && isAnimatedImageFile(data.imagePath)) {
            const shouldAnimate = data.animateGif !== undefined ? data.animateGif : (data.globalAnimateGif !== false);
            return createAnimatedImageNode(data, w, h, x, y, shouldAnimate);
        }
        return createStaticImageNode(data, w, h, x, y);
    },
};

export function createWidgetNode(data, width, height, x, y) {
    const creator = WIDGET_CREATORS[data.type];
    if (!creator) {
        console.error(`Unknown widget type: ${data.type}`);
        return null;
    }
    return creator(data, width, height, x, y);
}
