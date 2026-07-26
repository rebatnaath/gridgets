/**
 * ============================================================================
 * WEATHER WIDGET MODULE INDEX
 * ============================================================================
 */

import GLib from 'gi://GLib';
import { createWidgetContainer, connectTimerCleanup } from '../../utils/widgetUIUtils.js';
import {
    REFRESH_INTERVAL_SECONDS,
    createBackgroundImageActor,
    createMainLayout,
    fetchWeatherData,
} from './weatherCommon.js';
import { buildForecastLayout, attachForecastScaler } from './weatherForecast.js';
import { buildSimpleLayout, attachSimpleScaler } from './weatherSimple.js';
import { buildStandardLayout, attachStandardScaler } from './weatherStandard.js';

/** Layout size threshold grid column constants */
const FORECAST_MIN_GRID_WIDTH = 6;
const SIMPLE_MIN_GRID_WIDTH = 4;

/** Creates a weather widget instance supporting forecast, simple, and standard layouts. */
export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    widgetNode.isDestroyed = false;

    const bgImageActor = createBackgroundImageActor(widgetNode, widgetData);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode, widgetData);
    const layoutVariant = widgetData.layout || (
        widgetData.width >= FORECAST_MIN_GRID_WIDTH
            ? 'forecast'
            : (widgetData.width === SIMPLE_MIN_GRID_WIDTH ? 'simple' : 'standard')
    );

    let uiElements;
    if (layoutVariant === 'forecast') {
        uiElements = buildForecastLayout(layout, widgetData, extensionPath);
        attachForecastScaler(widgetNode, uiElements);
    } else if (layoutVariant === 'simple') {
        uiElements = buildSimpleLayout(layout);
        attachSimpleScaler(widgetNode, uiElements);
    } else {
        uiElements = buildStandardLayout(layout, widgetData, extensionPath);
        attachStandardScaler(widgetNode, uiElements);
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
        if (widgetNode.isDestroyed) return;
        fetchWeatherData(context);
    };

    triggerWeatherFetch();

    const state = { timerId: null };
    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (widgetNode.isDestroyed) return GLib.SOURCE_REMOVE;
        triggerWeatherFetch();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(widgetNode, state);

    widgetNode.connect('destroy', () => {
        widgetNode.isDestroyed = true;
        if (widgetNode.weatherSession) {
            try {
                widgetNode.weatherSession.abort();
            } catch (e) {
                console.error('Error aborting weather session on widget destroy:', e);
            }
            widgetNode.weatherSession = null;
        }
    });

    return widgetNode;
}
