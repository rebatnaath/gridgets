import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { FALLBACK_LOCATION, createFallbackIcon, configureWrappingLabel, buildFontCss } from './weatherCommon.js';
import { SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_LAYOUT_SIZE = 180;

const BASE_CITY_FONT_SIZE = 16;
const BASE_TEMP_FONT_SIZE = 42;
const BASE_ICON_SIZE = 27;
const BASE_CONDITION_FONT_SIZE = 14;
const BASE_HIGHLOW_FONT_SIZE = 12;

const CITY_MARGIN_BOTTOM_PX = 4;
const TEMP_MARGIN_BOTTOM_PX = 12;
const CONDITION_ICON_MARGIN_RIGHT_PX = 6;
const HIGHLOW_MARGIN_TOP_PX = 4;


export function buildStandardLayout(layout, widgetData, extensionPath) {
    const uiElements = {};
    const fontCss = buildFontCss(widgetData);
    uiElements.cityLabel = new St.Label({
        text: widgetData.location || FALLBACK_LOCATION,
        style: `${fontCss}font-weight: 400; font-size: ${BASE_CITY_FONT_SIZE}px; margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px;`
    });
    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300; margin-bottom: ${TEMP_MARGIN_BOTTOM_PX}px;`
    });
    layout.add_child(uiElements.cityLabel);
    layout.add_child(uiElements.tempLabel);

    const flexSpacer = new St.Widget({ y_expand: true });
    layout.add_child(flexSpacer);

    const conditionLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    uiElements.conditionIcon = new St.Icon({
        gicon: createFallbackIcon(extensionPath),
        icon_size: BASE_ICON_SIZE,
        style: `margin-right: ${CONDITION_ICON_MARGIN_RIGHT_PX}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: `${fontCss}font-size: ${BASE_CONDITION_FONT_SIZE}px; font-weight: 400;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    configureWrappingLabel(uiElements.conditionLabel);
    conditionLayout.add_child(uiElements.conditionIcon);
    conditionLayout.add_child(uiElements.conditionLabel);
    layout.add_child(conditionLayout);

    uiElements.highLowLabel = new St.Label({
        text: 'H:--° L:--°',
        style: `${fontCss}font-size: ${BASE_HIGHLOW_FONT_SIZE}px; opacity: ${SECONDARY_OPACITY}; margin-top: ${HIGHLOW_MARGIN_TOP_PX}px;`
    });
    layout.add_child(uiElements.highLowLabel);

    return uiElements;
}

export function attachStandardScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_SIZE, BASE_LAYOUT_SIZE, (scale) => {
        if (!uiElements || !uiElements.cityLabel) return;

        const citySize = Math.max(1, Math.round(BASE_CITY_FONT_SIZE * scale));
        const tempSize = Math.max(1, Math.round(BASE_TEMP_FONT_SIZE * scale));
        const iconSize = Math.max(1, Math.round(BASE_ICON_SIZE * scale));
        const condSize = Math.max(1, Math.round(BASE_CONDITION_FONT_SIZE * scale));
        const highLowSize = Math.max(1, Math.round(BASE_HIGHLOW_FONT_SIZE * scale));

        uiElements.cityLabel.style = `${fontCss}font-weight: 400; font-size: ${citySize}px; margin-bottom: ${Math.round(CITY_MARGIN_BOTTOM_PX * scale)}px; color: inherit;`;
        uiElements.tempLabel.style = `${fontCss}font-size: ${tempSize}px; font-weight: 300; margin-bottom: ${Math.round(TEMP_MARGIN_BOTTOM_PX * scale)}px; color: inherit;`;
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionIcon.style = `margin-right: ${Math.round(CONDITION_ICON_MARGIN_RIGHT_PX * scale)}px;`;
        uiElements.conditionLabel.style = `${fontCss}font-size: ${condSize}px; font-weight: 400; color: inherit;`;
        uiElements.highLowLabel.style = `${fontCss}font-size: ${highLowSize}px; opacity: ${SECONDARY_OPACITY}; margin-top: ${Math.round(HIGHLOW_MARGIN_TOP_PX * scale)}px; color: inherit;`;
    });
}
