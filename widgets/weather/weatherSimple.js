/**
 * ============================================================================
 * WEATHER SIMPLE LAYOUT (4x2 or wide horizontal minimal layouts)
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { configureWrappingLabel } from './weatherCommon.js';
import { attachResponsiveScaler } from '../../utils/widgetUIUtils.js';

/** Reference scaling dimensions */
const BASE_LAYOUT_WIDTH = 240;
const BASE_LAYOUT_HEIGHT = 120;

/** Baseline font sizes */
const BASE_TEMP_FONT_SIZE = 36;
const BASE_CONDITION_FONT_SIZE = 16;
const BASE_DATE_FONT_SIZE = 12;

/** Baseline margin metrics */
const TEMP_MARGIN_RIGHT_PX = 8;
const CONDITION_MARGIN_BOTTOM_PX = 4;

/** Builds minimal simple layout structure and UI elements. */
export function buildSimpleLayout(layout) {
    const uiElements = {};
    const simpleBox = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300; margin-right: ${TEMP_MARGIN_RIGHT_PX}px;`,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
    });

    const rightBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: `font-size: ${BASE_CONDITION_FONT_SIZE}px; font-weight: bold; margin-bottom: ${CONDITION_MARGIN_BOTTOM_PX}px;`,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    configureWrappingLabel(uiElements.conditionLabel);

    uiElements.dateLabel = new St.Label({
        text: '---',
        style: `font-size: ${BASE_DATE_FONT_SIZE}px; opacity: 0.8;`,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    rightBox.add_child(uiElements.conditionLabel);
    rightBox.add_child(uiElements.dateLabel);
    simpleBox.add_child(uiElements.tempLabel);
    simpleBox.add_child(rightBox);
    layout.add_child(simpleBox);

    return uiElements;
}

/** Attaches responsive scaling behavior to simple layout. */
export function attachSimpleScaler(widgetNode, uiElements) {
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, (scale) => {
        if (!uiElements || !uiElements.tempLabel) return;

        const tempSize = Math.max(16, Math.round(BASE_TEMP_FONT_SIZE * scale));
        const condSize = Math.max(10, Math.round(BASE_CONDITION_FONT_SIZE * scale));
        const dateSize = Math.max(8, Math.round(BASE_DATE_FONT_SIZE * scale));

        uiElements.tempLabel.style = `font-size: ${tempSize}px; font-weight: 300; margin-right: ${Math.round(TEMP_MARGIN_RIGHT_PX * scale)}px;`;
        uiElements.conditionLabel.style = `font-size: ${condSize}px; font-weight: bold; margin-bottom: ${Math.round(CONDITION_MARGIN_BOTTOM_PX * scale)}px; text-align: left;`;
        uiElements.dateLabel.style = `font-size: ${dateSize}px; opacity: 0.8; text-align: left;`;
    });
}
