import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import {
    resolveWidgetForegroundColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { buildFontCss } from './weatherCommon.js';

const BASE_LAYOUT_WIDTH = 240;
const BASE_LAYOUT_HEIGHT = 160;

const BASE_TEMP_FONT_SIZE = 48;
const BASE_CITY_FONT_SIZE = 16;
const TEMP_MARGIN_BOTTOM_PX = 4;

export function buildSimpleLayout(layout, widgetData = null) {
    const uiElements = {};
    const fontCss = buildFontCss(widgetData);
    const textColor = resolveWidgetForegroundColor(widgetData);

    const simpleBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}color: ${textColor}; font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300; margin-bottom: ${TEMP_MARGIN_BOTTOM_PX}px;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.cityLabel = new St.Label({
        text: (widgetData && widgetData.location) || 'Loading...',
        style: `${fontCss}color: ${textColor}; font-size: ${BASE_CITY_FONT_SIZE}px; opacity: ${SECONDARY_OPACITY};`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    simpleBox.add_child(uiElements.tempLabel);
    simpleBox.add_child(uiElements.cityLabel);
    layout.add_child(simpleBox);

    return uiElements;
}

export function attachSimpleScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, (scale) => {
        if (!uiElements || !uiElements.tempLabel || !uiElements.cityLabel) return;

        const tempSize = Math.max(1, Math.round(BASE_TEMP_FONT_SIZE * scale));
        const citySize = Math.max(1, Math.round(BASE_CITY_FONT_SIZE * scale));
        const marginBottom = Math.max(1, Math.round(TEMP_MARGIN_BOTTOM_PX * scale));

        uiElements.tempLabel.style = `${fontCss}font-size: ${tempSize}px; font-weight: 300; margin-bottom: ${marginBottom}px; text-align: center; color: inherit;`;
        uiElements.cityLabel.style = `${fontCss}font-size: ${citySize}px; opacity: ${SECONDARY_OPACITY}; text-align: center; color: inherit;`;
    });
}
