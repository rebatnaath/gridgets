import { createTimeNode } from '../widgets/time/index.js';
import { createWeatherNode } from '../widgets/weather/index.js';
import { createMusicNode } from '../widgets/music/index.js';
import { createNotesNode } from '../widgets/notes.js';
import { createClipboardNode } from '../widgets/clipboard.js';
import { createCalendarNode } from '../widgets/calendar.js';
import { createQuotesNode } from '../widgets/quotes.js';
import {
    createCpuRamNode,
    createNetworkSpeedNode,
    createSystemDashboardNode
} from '../widgets/system/index.js';
import { createPomodoroNode } from '../widgets/pomodoro.js';
import { createPomodoroFocusNode } from '../widgets/pomodoroFocus.js';
import { createAppLauncherNode } from '../widgets/appLauncher.js';
import { createScreenTimeNode } from '../widgets/screenTimeWidget.js';
import { createCalendarGridNode } from '../widgets/calendarGrid.js';
import { createTodoNode } from '../widgets/todo.js';
import { createGithubNode } from '../widgets/github.js';
import { createSunScheduleNode } from '../widgets/solarSchedule.js';
import { createRssHeadlinesNode } from '../widgets/rssHeadlines.js';
import { createMoodNode } from '../widgets/moodLogger.js';
import {
    createStaticImageNode,
    createAnimatedImageNode,
    createSlideshowNode
} from '../widgets/media/index.js';
import { isAnimatedImageFile } from '../utils/widgetUtils.js';

export function createWidgetNode(data, width, height, x, y) {
    const dynamicColor = data.dynamicColor !== undefined ? data.dynamicColor : (data.globalWeatherDynamicColor !== false);
    const dynamicImage = data.dynamicImage !== undefined ? data.dynamicImage : (data.globalWeatherDynamicImage !== false);

    switch (data.type) {
        case 'time':
            return createTimeNode(data, width, height, x, y);
        case 'weather':
            return createWeatherNode(data, width, height, x, y, dynamicColor, dynamicImage);
        case 'music':
            return createMusicNode(data, width, height, x, y);
        case 'notes':
            return createNotesNode(data, width, height, x, y);
        case 'clipboard':
            return createClipboardNode(data, width, height, x, y);
        case 'cpu-ram':
            return createCpuRamNode(data, width, height, x, y);
        case 'network-speed':
            return createNetworkSpeedNode(data, width, height, x, y);
        case 'system-dashboard':
            return createSystemDashboardNode(data, width, height, x, y);
        case 'pomodoro':
            return createPomodoroNode(data, width, height, x, y);
        case 'pomodoro-focus':
            return createPomodoroFocusNode(data, width, height, x, y);
        case 'app-launcher':
            return createAppLauncherNode(data, width, height, x, y);
        case 'calendar':
            return createCalendarNode(data, width, height, x, y);
        case 'quotes':
            return createQuotesNode(data, width, height, x, y);
        case 'screen-time':
            return createScreenTimeNode(data, width, height, x, y);
        case 'calendar-grid':
            return createCalendarGridNode(data, width, height, x, y);
        case 'todo':
            return createTodoNode(data, width, height, x, y);
        case 'github':
            return createGithubNode(data, width, height, x, y);
        case 'sun-schedule':
            return createSunScheduleNode(data, width, height, x, y);
        case 'rss-headlines':
        case 'rss-feed':
            return createRssHeadlinesNode(data, width, height, x, y);
        case 'mood':
            return createMoodNode(data, width, height, x, y);
        case 'slideshow':
            return createSlideshowNode(data, width, height, x, y);
        case 'image':
            if (data.imagePath && isAnimatedImageFile(data.imagePath)) {
                const shouldAnimate = data.animateGif !== undefined ? data.animateGif : (data.globalAnimateGif !== false);
                return createAnimatedImageNode(data, width, height, x, y, shouldAnimate);
            }
            return createStaticImageNode(data, width, height, x, y);
        default:
            console.error(`Unknown widget type: ${data.type}`);
            return null;
    }
}
