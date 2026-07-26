/**
 * ============================================================================
 * MUSIC SMALL LAYOUT
 * 
 * Single-panel compact player layout.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './musicCommon.js';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../utils/widgetUIUtils.js';

/** Base container layout metrics */
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;

/** Default layout metrics */
const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;

/** Builds small single-panel music player UI layout. */
export function buildSmallLayout(config, state) {
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;

    state.container.add_child(backgroundLayer);

    if (config.darkenCover === true) {
        const cornerRadius = config.appliedBorderRadius || 0;
        const darkOverlay = new St.Widget({
            style: `background-color: rgba(0, 0, 0, 0.35); border-radius: ${cornerRadius}px;`,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        state.container.add_child(darkOverlay);
    }

    const controlsBox = buildControlsColumn(config, state);
    state.container.add_child(controlsBox);

    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale) => {
        if (!state.controlsColumn) return;

        const textColor = resolveWidgetForegroundColor(config);
        const fontFamily = resolveWidgetFontFamily(config);

        updateControlButtonScaling(state, scale, fontFamily, textColor);

        const containerMargin = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));
        if (state.controlsColumn) {
            state.controlsColumn.style = `margin: ${containerMargin}px;`;
        }
    });
}
