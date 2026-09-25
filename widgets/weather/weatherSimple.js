import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { buildFontCss, WEATHER_LOADING_TEXT, scaleWeatherValue, buildWeatherTextStyle, WEATHER_SUBTLE_OPACITY } from './weatherCommon.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, MIN_FONT_SIZE } from '../../utils/typography.js';

const BASE_LAYOUT_WIDTH = 240;
const BASE_LAYOUT_HEIGHT = 160;

const BASE_TEMP_FONT_SIZE = TYPOGRAPHY_SIZE.displayXL;
const BASE_CITY_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const TEMP_MARGIN_BOTTOM_PX = 4;

export function buildSimpleLayout(layout, widgetData = null) {
    const uiElements = {};
    const fontCss = buildFontCss(widgetData);

    const simpleBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: ${TYPOGRAPHY_WEIGHT.extrabold}; margin-bottom: ${TEMP_MARGIN_BOTTOM_PX}px;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.cityLabel = new St.Label({
        text: (widgetData && widgetData.location) || WEATHER_LOADING_TEXT,
        style: `${fontCss}font-size: ${BASE_CITY_FONT_SIZE}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; opacity: ${WEATHER_SUBTLE_OPACITY};`,
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

        const tempSize = scaleWeatherValue(BASE_TEMP_FONT_SIZE, scale, MIN_FONT_SIZE.primary);
        const citySize = scaleWeatherValue(BASE_CITY_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle);
        const marginBottom = scaleWeatherValue(TEMP_MARGIN_BOTTOM_PX, scale);

        uiElements.tempLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: tempSize,
            fontWeight: TYPOGRAPHY_WEIGHT.extrabold,
            margin: `margin-bottom: ${marginBottom}px;`,
            textAlign: 'center',
        });
        uiElements.cityLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: citySize,
            fontWeight: TYPOGRAPHY_WEIGHT.bold,
            opacity: WEATHER_SUBTLE_OPACITY,
            textAlign: 'center',
        });
    });
}
