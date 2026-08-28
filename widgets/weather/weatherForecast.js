import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { FALLBACK_LOCATION, HOURLY_FORECAST_COUNT, createFallbackIcon, configureWrappingLabel, buildFontCss } from './weatherCommon.js';
import { SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_LAYOUT_WIDTH = 360;
const BASE_LAYOUT_HEIGHT = 180;

const BASE_CITY_FONT_SIZE = 20;
const BASE_TEMP_FONT_SIZE = 48;
const BASE_ICON_SIZE = 40;
const BASE_CONDITION_FONT_SIZE = 16;
const BASE_HIGHLOW_FONT_SIZE = 12;
const BASE_HOURLY_TEXT_SIZE = 12;
const BASE_HOURLY_ICON_SIZE = 24;

const CITY_MARGIN_BOTTOM_PX = 4;
const DIVIDER_MARGIN_VERTICAL_PX = 8;
const HOURLY_ITEM_MARGIN_BOTTOM_PX = 3;

export function buildForecastLayout(layout, widgetData, extensionPath) {
    const uiElements = { hourlyActors: [] };
    const fontCss = buildFontCss(widgetData);

    const topLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, y_expand: true });
    const leftLayout = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
    uiElements.cityLabel = new St.Label({
        text: widgetData.location || FALLBACK_LOCATION,
        style: `${fontCss}font-weight: 400; font-size: ${BASE_CITY_FONT_SIZE}px; margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px;`
    });
    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300;`
    });
    leftLayout.add_child(uiElements.cityLabel);
    leftLayout.add_child(uiElements.tempLabel);
    topLayout.add_child(leftLayout);

    const rightLayout = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.END });
    const iconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.END, x_expand: true });
    uiElements.conditionIcon = new St.Icon({
        gicon: createFallbackIcon(extensionPath),
        icon_size: BASE_ICON_SIZE,
        style: `margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px;`
    });
    iconWrapper.add_child(uiElements.conditionIcon);

    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: `${fontCss}font-size: ${BASE_CONDITION_FONT_SIZE}px; font-weight: 400; text-align: right;`
    });
    configureWrappingLabel(uiElements.conditionLabel, Pango.Alignment.RIGHT);
    uiElements.highLowLabel = new St.Label({
        text: 'H:--° L:--°',
        style: `${fontCss}font-size: ${BASE_HIGHLOW_FONT_SIZE}px; opacity: ${SECONDARY_OPACITY}; text-align: right;`,
        x_align: Clutter.ActorAlign.END
    });
    uiElements.highLowLabel.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

    rightLayout.add_child(iconWrapper);
    rightLayout.add_child(uiElements.conditionLabel);
    rightLayout.add_child(uiElements.highLowLabel);
    topLayout.add_child(rightLayout);

    layout.add_child(topLayout);
    const divider = new St.Widget({
        style: `background-color: currentColor; opacity: 0.2; height: 1px; margin-top: ${DIVIDER_MARGIN_VERTICAL_PX}px; margin-bottom: ${DIVIDER_MARGIN_VERTICAL_PX}px;`
    });
    layout.add_child(divider);

    const hourlyContainer = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        const hourBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        const timeLbl = new St.Label({
            text: '--',
            style: `${fontCss}font-size: ${BASE_HOURLY_TEXT_SIZE}px; font-weight: 400; margin-bottom: ${HOURLY_ITEM_MARGIN_BOTTOM_PX}px; text-align: center;`
        });
        timeLbl.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

        const icon = new St.Icon({
            gicon: createFallbackIcon(extensionPath),
            icon_size: BASE_HOURLY_ICON_SIZE,
            style: `margin-bottom: ${HOURLY_ITEM_MARGIN_BOTTOM_PX}px;`
        });
        const hourlyIconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.CENTER, x_expand: true });
        hourlyIconWrapper.add_child(icon);

        const tempLbl = new St.Label({
            text: '--°',
            style: `${fontCss}font-size: ${BASE_HOURLY_TEXT_SIZE}px; font-weight: 400; text-align: center;`
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
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, (scale) => {
        if (!uiElements || !uiElements.cityLabel) return;

        const citySize = Math.max(1, Math.round(BASE_CITY_FONT_SIZE * scale));
        const tempSize = Math.max(1, Math.round(BASE_TEMP_FONT_SIZE * scale));
        const iconSize = Math.max(1, Math.round(BASE_ICON_SIZE * scale));
        const condSize = Math.max(1, Math.round(BASE_CONDITION_FONT_SIZE * scale));
        const highLowSize = Math.max(1, Math.round(BASE_HIGHLOW_FONT_SIZE * scale));

        const hourlyTextSize = Math.max(1, Math.round(BASE_HOURLY_TEXT_SIZE * scale));
        const hourlyIconSize = Math.max(1, Math.round(BASE_HOURLY_ICON_SIZE * scale));

        uiElements.cityLabel.style = `${fontCss}font-weight: 400; font-size: ${citySize}px; margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px; color: inherit;`;
        uiElements.tempLabel.style = `${fontCss}font-size: ${tempSize}px; font-weight: 300; color: inherit;`;
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionIcon.style = `margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px;`;
        uiElements.conditionLabel.style = `${fontCss}font-size: ${condSize}px; font-weight: 400; text-align: right; color: inherit;`;
        uiElements.highLowLabel.style = `${fontCss}font-size: ${highLowSize}px; opacity: ${SECONDARY_OPACITY}; text-align: right; color: inherit;`;

        if (uiElements.hourlyActors) {
            uiElements.hourlyActors.forEach(actor => {
                if (actor.timeLbl) actor.timeLbl.style = `${fontCss}font-size: ${hourlyTextSize}px; font-weight: 400; margin-bottom: ${HOURLY_ITEM_MARGIN_BOTTOM_PX}px; text-align: center; color: inherit;`;
                if (actor.icon) {
                    actor.icon.icon_size = hourlyIconSize;
                    actor.icon.style = `margin-bottom: ${HOURLY_ITEM_MARGIN_BOTTOM_PX}px;`;
                }
                if (actor.tempLbl) actor.tempLbl.style = `${fontCss}font-size: ${hourlyTextSize}px; font-weight: 400; text-align: center; color: inherit;`;
            });
        }
    });
}
