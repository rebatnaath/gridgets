import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { attachResponsiveScaler } from '../../utils/widgetUIUtils.js';
import { resolveWidgetFontFamily, resolveWidgetForegroundColor } from '../../utils/widgetUtils.js';

/** Reference scaling dimensions */
const BASE_LAYOUT_WIDTH = 240;
const BASE_LAYOUT_HEIGHT = 160;

/** Baseline font sizes */
const BASE_TEMP_FONT_SIZE = 48;
const BASE_CITY_FONT_SIZE = 16;
const TEMP_MARGIN_BOTTOM_PX = 4;

/** Builds minimal simple layout structure with centered temperature and city labels. */
export function buildSimpleLayout(layout, widgetData = null) {
    const uiElements = {};
    const fontFamily = resolveWidgetFontFamily(widgetData);
    const textColor = resolveWidgetForegroundColor(widgetData);

    const simpleBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: bold; margin-bottom: ${TEMP_MARGIN_BOTTOM_PX}px;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    uiElements.cityLabel = new St.Label({
        text: (widgetData && widgetData.location) || 'Loading...',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${BASE_CITY_FONT_SIZE}px; font-weight: 500; opacity: 0.9;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    simpleBox.add_child(uiElements.tempLabel);
    simpleBox.add_child(uiElements.cityLabel);
    layout.add_child(simpleBox);

    return uiElements;
}

/** Attaches responsive scaling behavior to simple layout. */
export function attachSimpleScaler(widgetNode, uiElements) {
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, (scale) => {
        if (!uiElements || !uiElements.tempLabel || !uiElements.cityLabel) return;

        const tempSize = Math.max(20, Math.round(BASE_TEMP_FONT_SIZE * scale));
        const citySize = Math.max(10, Math.round(BASE_CITY_FONT_SIZE * scale));
        const marginBottom = Math.max(2, Math.round(TEMP_MARGIN_BOTTOM_PX * scale));

        uiElements.tempLabel.style = `font-size: ${tempSize}px; font-weight: bold; margin-bottom: ${marginBottom}px; text-align: center; color: inherit;`;
        uiElements.cityLabel.style = `font-size: ${citySize}px; font-weight: 500; opacity: 0.9; text-align: center; color: inherit;`;
    });
}
