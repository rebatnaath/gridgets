import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './controls.js';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
} from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;

const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;

export function buildSmallLayout(config, state) {
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

    const gradientOverlay = new St.Widget({
        style: 'background-gradient-direction: vertical; background-gradient-start: rgba(0,0,0,0); background-gradient-end: rgba(0,0,0,0.75);',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    state.container.add_child(gradientOverlay);

    state.titleLabel = null;
    state.artistLabel = null;
    state.albumLabel = null;

    const controlsBox = buildControlsColumn(config, state);
    if (controlsBox) state.container.add_child(controlsBox);

    const cornerRadius = config.appliedBorderRadius || 0;

    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale, w, h) => {
        const textColor = resolveWidgetForegroundColor(config);
        const fontFamily = resolveExplicitFontFamily(config);

        updateControlButtonScaling(state, scale, fontFamily, textColor);

        const containerMargin = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));

        if (state.controlsColumn) {
            state.controlsColumn.style = `margin: ${containerMargin}px;`;
        }

        gradientOverlay.style = `background-gradient-direction: vertical; `
            + `background-gradient-start: rgba(0,0,0,0); `
            + `background-gradient-end: rgba(0,0,0,0.75); `
            + `border-radius: ${cornerRadius}px;`;
    });
}

