import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {
    HOURLY_FORECAST_COUNT,
    createFallbackIcon,
    buildFontCss,
    LOCATION_UNAVAILABLE_TEXT,
    HIGH_LOW_LOADING_TEXT,
    WEATHER_LOADING_TEXT,
    buildWeatherTextStyle,
    initialScaleFor,
    WEATHER_METADATA_OPACITY,
} from './weatherCommon.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, createWidgetMetrics, GRAPHICS_OPACITY } from '../../utils/typography.js';

const CLUTTER_OPACITY_OPAQUE = 255;
const BASE_LAYOUT_WIDTH = 360;
const BASE_LAYOUT_HEIGHT = 180;

const BASE_CITY_FONT_SIZE = TYPOGRAPHY_SIZE.title;
const BASE_TEMP_FONT_SIZE = TYPOGRAPHY_SIZE.displayXL;
const BASE_ICON_SIZE = 40;
const BASE_CONDITION_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const BASE_HIGHLOW_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_HOURLY_TEXT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_HOURLY_ICON_SIZE = TYPOGRAPHY_SIZE.iconLg;

const CITY_MARGIN_BOTTOM_PX = 4;
const DIVIDER_MARGIN_VERTICAL_PX = 8;
const HOURLY_ITEM_MARGIN_BOTTOM_PX = 3;

export function buildForecastLayout(layout, widgetData) {
    const uiElements = { hourlyActors: [] };
    const fontCss = buildFontCss(widgetData);

    const topLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, y_expand: true });
    const leftLayout = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
    uiElements.cityLabel = new St.Label({
        text: widgetData.location || LOCATION_UNAVAILABLE_TEXT,
    });
    uiElements.tempLabel = new St.Label({
        text: '--°',
    });
    leftLayout.add_child(uiElements.cityLabel);
    leftLayout.add_child(uiElements.tempLabel);
    topLayout.add_child(leftLayout);

    const rightLayout = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.END });
    const iconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.END, x_expand: true });
    uiElements.conditionIcon = new St.Icon({
        icon_name: createFallbackIcon(),
    });
    iconWrapper.add_child(uiElements.conditionIcon);

    uiElements.conditionLabel = new St.Label({
        text: WEATHER_LOADING_TEXT,
    });
    uiElements.highLowLabel = new St.Label({
        text: HIGH_LOW_LOADING_TEXT,
        x_align: Clutter.ActorAlign.END
    });
    uiElements.highLowLabel.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

    rightLayout.add_child(iconWrapper);
    rightLayout.add_child(uiElements.conditionLabel);
    rightLayout.add_child(uiElements.highLowLabel);
    topLayout.add_child(rightLayout);

    layout.add_child(topLayout);
    uiElements.divider = new St.Widget({
        style: `background-color: currentColor; height: 1px; margin-top: ${DIVIDER_MARGIN_VERTICAL_PX}px; margin-bottom: ${DIVIDER_MARGIN_VERTICAL_PX}px;`
    });
    layout.add_child(uiElements.divider);

    const hourlyContainer = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        const hourBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        const timeLbl = new St.Label({
            text: '--',
        });
        timeLbl.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

        const icon = new St.Icon({
            icon_name: createFallbackIcon(),
        });
        const hourlyIconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.CENTER, x_expand: true });
        hourlyIconWrapper.add_child(icon);

        const tempLbl = new St.Label({
            text: '--°',
        });
        tempLbl.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

        hourBox.add_child(timeLbl);
        hourBox.add_child(hourlyIconWrapper);
        hourBox.add_child(tempLbl);
        hourlyContainer.add_child(hourBox);
        uiElements.hourlyActors.push({ timeLbl, icon, tempLbl });
    }
    layout.add_child(hourlyContainer);

    return uiElements;
}

export function attachForecastScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);
    const applyLayout = (scale) => {
        if (!uiElements || !uiElements.cityLabel) return;

        const { px } = createWidgetMetrics(scale);
        const citySize = px(BASE_CITY_FONT_SIZE);
        const tempSize = px(BASE_TEMP_FONT_SIZE);
        const iconSize = px(BASE_ICON_SIZE);
        const conditionSize = px(BASE_CONDITION_FONT_SIZE);
        const highLowSize = px(BASE_HIGHLOW_FONT_SIZE);
        const hourlyTextSize = px(BASE_HOURLY_TEXT_SIZE);
        const hourlyIconSize = px(BASE_HOURLY_ICON_SIZE);
        const cityMargin = px(CITY_MARGIN_BOTTOM_PX);
        const dividerMargin = px(DIVIDER_MARGIN_VERTICAL_PX);
        const hourlyMargin = px(HOURLY_ITEM_MARGIN_BOTTOM_PX);

        uiElements.cityLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: citySize,
            fontWeight: TYPOGRAPHY_WEIGHT.semibold,
            margin: `margin-bottom: ${cityMargin}px;`,
        });
        uiElements.tempLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: tempSize,
            fontWeight: TYPOGRAPHY_WEIGHT.extrabold,
        });
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionIcon.style = `margin-bottom: ${cityMargin}px;`;
        uiElements.conditionLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: conditionSize,
            fontWeight: TYPOGRAPHY_WEIGHT.medium,
            textAlign: 'right',
        });
        uiElements.highLowLabel.style = buildWeatherTextStyle(fontCss, {
            fontSize: highLowSize,
            fontWeight: TYPOGRAPHY_WEIGHT.regular,
            textAlign: 'right',
        });
        uiElements.highLowLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * WEATHER_METADATA_OPACITY);
        uiElements.divider.style = `background-color: currentColor; height: 1px; margin-top: ${dividerMargin}px; margin-bottom: ${dividerMargin}px;`;
        uiElements.divider.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * GRAPHICS_OPACITY.divider);

        uiElements.hourlyActors.forEach(actor => {
            actor.timeLbl.style = buildWeatherTextStyle(fontCss, {
                fontSize: hourlyTextSize,
                fontWeight: TYPOGRAPHY_WEIGHT.regular,
                margin: `margin-bottom: ${hourlyMargin}px;`,
                textAlign: 'center',
            });
            actor.icon.icon_size = hourlyIconSize;
            actor.icon.style = `margin-bottom: ${hourlyMargin}px;`;
            actor.tempLbl.style = buildWeatherTextStyle(fontCss, {
                fontSize: hourlyTextSize,
                fontWeight: TYPOGRAPHY_WEIGHT.medium,
                textAlign: 'center',
            });
        });
    };

    // Before the scaler is attached, whose first pass is deferred to an idle: the labels
    // are built at the unscaled BASE_* sizes and would otherwise paint one frame at 1.0.
    applyLayout(initialScaleFor(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT));
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, applyLayout);
}
