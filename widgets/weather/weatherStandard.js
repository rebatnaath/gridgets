import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { createFallbackIcon, buildFontCss, LOCATION_UNAVAILABLE_TEXT, HIGH_LOW_LOADING_TEXT, WEATHER_LOADING_TEXT, scaleWeatherValue, buildWeatherTextStyle, initialScaleFor, WEATHER_METADATA_OPACITY } from './weatherCommon.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, MIN_FONT_SIZE } from '../../utils/typography.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_LAYOUT_SIZE = 180;

const BASE_CITY_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const BASE_TEMP_FONT_SIZE = TYPOGRAPHY_SIZE.displayXL;
const BASE_ICON_SIZE = TYPOGRAPHY_SIZE.iconLg;
const BASE_CONDITION_FONT_SIZE = TYPOGRAPHY_SIZE.body;
const BASE_HIGHLOW_FONT_SIZE = TYPOGRAPHY_SIZE.compact;

const CITY_MARGIN_BOTTOM_PX = 4;
const TEMP_MARGIN_BOTTOM_PX = 12;
const CONDITION_ICON_MARGIN_RIGHT_PX = 6;
const HIGHLOW_MARGIN_TOP_PX = 4;


export function buildStandardLayout(layout, widgetData) {
    const uiElements = {};
    // Every style is written by applyLayout, which builds its own fontCss.
    uiElements.cityLabel = new St.Label({
        text: widgetData.location || LOCATION_UNAVAILABLE_TEXT,
    });
    uiElements.tempLabel = new St.Label({ text: '--°' });
    layout.add_child(uiElements.cityLabel);
    layout.add_child(uiElements.tempLabel);

    const flexSpacer = new St.Widget({ y_expand: true });
    layout.add_child(flexSpacer);

    const conditionLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    uiElements.conditionIcon = new St.Icon({
        icon_name: createFallbackIcon(),
        icon_size: BASE_ICON_SIZE,
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.conditionLabel = new St.Label({
        text: WEATHER_LOADING_TEXT,
        y_align: Clutter.ActorAlign.CENTER,
    });
    conditionLayout.add_child(uiElements.conditionIcon);
    conditionLayout.add_child(uiElements.conditionLabel);
    layout.add_child(conditionLayout);

    uiElements.highLowLabel = new St.Label({ text: HIGH_LOW_LOADING_TEXT });
    layout.add_child(uiElements.highLowLabel);

    return uiElements;
}

export function attachStandardScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);
    const applyLayout = (scale) => {
        if (!uiElements || !uiElements.cityLabel) return;

        const citySize = scaleWeatherValue(BASE_CITY_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle);
        const tempSize = scaleWeatherValue(BASE_TEMP_FONT_SIZE, scale, MIN_FONT_SIZE.primary);
        const iconSize = scaleWeatherValue(BASE_ICON_SIZE, scale);
        const conditionSize = scaleWeatherValue(BASE_CONDITION_FONT_SIZE, scale, MIN_FONT_SIZE.body);
        const highLowSize = scaleWeatherValue(BASE_HIGHLOW_FONT_SIZE, scale, MIN_FONT_SIZE.metadata);
        const cityMargin = scaleWeatherValue(CITY_MARGIN_BOTTOM_PX, scale);
        const tempMargin = scaleWeatherValue(TEMP_MARGIN_BOTTOM_PX, scale);
        const conditionMargin = scaleWeatherValue(CONDITION_ICON_MARGIN_RIGHT_PX, scale);
        const highLowMargin = scaleWeatherValue(HIGHLOW_MARGIN_TOP_PX, scale);

        uiElements.cityLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: citySize,
            fontWeight: TYPOGRAPHY_WEIGHT.semibold,
            margin: `margin-bottom: ${cityMargin}px;`,
        });
        uiElements.tempLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: tempSize,
            fontWeight: TYPOGRAPHY_WEIGHT.extrabold,
            margin: `margin-bottom: ${tempMargin}px;`,
        });
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionIcon.style = `margin-right: ${conditionMargin}px;`;
        uiElements.conditionLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: conditionSize,
            fontWeight: TYPOGRAPHY_WEIGHT.medium,
        });
        uiElements.highLowLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: highLowSize,
            fontWeight: TYPOGRAPHY_WEIGHT.regular,
            opacity: WEATHER_METADATA_OPACITY,
            margin: `margin-top: ${highLowMargin}px;`,
        });
    };

    // Before the scaler is attached, whose first pass is deferred to an idle: the labels
    // are built at the unscaled BASE_* sizes and would otherwise paint one frame at 1.0.
    applyLayout(initialScaleFor(widgetNode, BASE_LAYOUT_SIZE, BASE_LAYOUT_SIZE));
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_SIZE, BASE_LAYOUT_SIZE, applyLayout);
}
