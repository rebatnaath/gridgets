import GLib from 'gi://GLib';
import { connectTimerCleanup, createWidgetContainer } from '../../utils/widgetUIUtils.js';
import {
    REFRESH_INTERVAL_SECONDS,
    createBackgroundImageActor,
    createMainLayout,
    fetchWeatherData,
} from './weatherCommon.js';
import { buildForecastLayout, attachForecastScaler } from './weatherForecast.js';
import { buildSimpleLayout, attachSimpleScaler } from './weatherSimple.js';
import { buildStandardLayout, attachStandardScaler } from './weatherStandard.js';

const FORECAST_MIN_GRID_WIDTH = 6;
const SIMPLE_MIN_GRID_WIDTH = 4;
export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

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
        uiElements = buildSimpleLayout(layout, widgetData, extensionPath);
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
        if (widgetNode.weatherSession) {
            widgetNode.weatherSession.abort();
            widgetNode.weatherSession = null;
        }
    });

    return widgetNode;
}
