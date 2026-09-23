import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GioUnix from 'gi://GioUnix';
import { connectTimerCleanup, createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import {
    REFRESH_INTERVAL_SECONDS,
    createBackgroundImageActor,
    createMainLayout,
    fetchWeatherViaOpenMeteo,
    releaseWeatherSession,
    resolveWeatherLayoutVariant,
} from './weatherCommon.js';
import { buildForecastLayout, attachForecastScaler } from './weatherForecast.js';
import { buildSimpleLayout, attachSimpleScaler } from './weatherSimple.js';
import { buildStandardLayout, attachStandardScaler } from './weatherStandard.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

export { createSunScheduleNode } from './solarSchedule.js';

const GNOME_WEATHER_APP_ID = 'org.gnome.Weather.desktop';
const CLICK_MAX_DURATION_MS = 300;

/** Launches GNOME Weather through GIO's app launcher instead of spawning a shell command. */
function launchGnomeWeather() {
    try {
        const desktopAppInfo = GioUnix.DesktopAppInfo.new(GNOME_WEATHER_APP_ID);
        if (desktopAppInfo && desktopAppInfo.get_id()) {
            desktopAppInfo.launch([], null);
            return;
        }
    } catch {
        // No usable desktop entry; fall back to the command-line app info below.
    }

    try {
        const appInfo = Gio.AppInfo.create_from_commandline('gnome-weather', null, Gio.AppInfoCreateFlags.NONE);
        if (appInfo)
            appInfo.launch([], null);
    } catch {
        // GNOME Weather could not be launched; nothing left to try.
    }
}

export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    let pressTime = 0;
    let pressStageId = 0;

    widgetNode.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== 1) return false;
        pressTime = Date.now();

        const releaseHandler = (_s, ev) => {
            if (ev.get_button() === 1) {
                const duration = Date.now() - pressTime;
                if (duration < CLICK_MAX_DURATION_MS) {
                    launchGnomeWeather();
                }
                if (pressStageId) {
                    global.stage.disconnect(pressStageId);
                    pressStageId = 0;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        };

        if (pressStageId) {
            global.stage.disconnect(pressStageId);
            pressStageId = 0;
        }
        pressStageId = global.stage.connect('button-release-event', releaseHandler);

        return false;
    });

    const bgImageActor = createBackgroundImageActor(widgetNode);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode);
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);

    let uiElements;
    if (layoutVariant === 'forecast') {
        uiElements = buildForecastLayout(layout, widgetData, extensionPath);
        attachForecastScaler(widgetNode, uiElements, widgetData);
    } else if (layoutVariant === 'simple') {
        uiElements = buildSimpleLayout(layout, widgetData);
        attachSimpleScaler(widgetNode, uiElements, widgetData);
    } else {
        uiElements = buildStandardLayout(layout, widgetData, extensionPath);
        attachStandardScaler(widgetNode, uiElements, widgetData);
    }

    widgetNode.add_child(layout);

    const context = {
        widgetData,
        uiElements,
        widgetNode,
        bgImageActor,
        isDynamicColor,
        isDynamicImage,
        extensionPath,
    };

    const triggerWeatherFetch = () => {
        if (isActorDestroyed(widgetNode)) return;
        fetchWeatherViaOpenMeteo(context);
    };

    triggerWeatherFetch();

    const state = { timerId: null };
    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        triggerWeatherFetch();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(widgetNode, state);
    registerWidgetCleanup(widgetNode, () => releaseWeatherSession(widgetNode));
    registerWidgetCleanup(widgetNode, () => {
        if (pressStageId) {
            global.stage.disconnect(pressStageId);
            pressStageId = 0;
        }
    });

    return widgetNode;
}
