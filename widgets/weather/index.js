import GLib from 'gi://GLib';
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

export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const bgImageActor = createBackgroundImageActor(widgetNode);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode);
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);

    let uiElements;
    if (layoutVariant === 'forecast') {
        uiElements = buildForecastLayout(layout, widgetData, extensionPath);
        attachForecastScaler(widgetNode, uiElements, widgetData);
    } else if (layoutVariant === 'simple') {
        uiElements = buildSimpleLayout(layout, widgetData, extensionPath);
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

    return widgetNode;
}
