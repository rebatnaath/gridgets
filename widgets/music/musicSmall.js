import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { LIGHT_TEXT_ON_DARK_COVER } from './cover.js';
import { resolveExplicitFontFamily, resolveWidgetSurfaces } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;

const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;

const SCRIM_GRADIENT_STYLE = 'background-gradient-direction: vertical; '
    + 'background-gradient-start: rgba(0, 0, 0, 0); '
    + 'background-gradient-end: rgba(0, 0, 0, 0.75);';

const buildScrimStyle = borderRadius => `${SCRIM_GRADIENT_STYLE} border-radius: ${borderRadius}px;`;

export function buildSmallLayout(config, state) {
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

    const cornerRadius = config.appliedBorderRadius || 0;
    const gradientOverlay = new St.Widget({
        style: buildScrimStyle(cornerRadius),
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

    // The controls and timer sit on the scrim, which is always dark, so they
    // take the light contrast colour. The themed foreground would be
    // unreadable here on any light theme.
    const textColor = LIGHT_TEXT_ON_DARK_COVER;
    const fontFamily = resolveExplicitFontFamily(config);
    const { highlight } = resolveWidgetSurfaces(config);

    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, scale => {
        updateControlButtonScaling(state, scale, fontFamily, textColor, highlight);

        const containerMargin = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));

        if (state.controlsColumn) {
            state.controlsColumn.style = `margin: ${containerMargin}px;`;
        }

        gradientOverlay.style = buildScrimStyle(cornerRadius);
    });
}

