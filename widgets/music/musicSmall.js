import { createScrim } from '../../components/scrim/scrim.js';
import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { LIGHT_TEXT_ON_DARK_COVER } from './cover.js';
import { resolveExplicitFontFamily, resolveWidgetSurfaces, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;

const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;

export function buildSmallLayout(config, state) {
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

// resolveWidgetCornerRadius, not `appliedBorderRadius || 0`: an absent override
    // means the shared default, and || 0 squared this panel off against a rounded
    // container. The radius has to match the container's to line the corners up.
    const cornerRadius = resolveWidgetCornerRadius(config);
    const gradientOverlay = createScrim({ enabled: true, borderRadius: cornerRadius });
    state.container.add_child(gradientOverlay);

    state.titleLabel = null;
    state.artistLabel = null;
    state.albumLabel = null;

    const controlsBox = buildControlsColumn(config, state);
    if (controlsBox) state.container.add_child(controlsBox);

    // The controls sit on the always-dark scrim, so they take the light contrast
    // colour; the themed foreground would be unreadable here on a light theme.
    const textColor = LIGHT_TEXT_ON_DARK_COVER;
    const fontFamily = resolveExplicitFontFamily(config);
    const { highlight } = resolveWidgetSurfaces(config);

    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, scale => {
        updateControlButtonScaling(state, scale, fontFamily, textColor, highlight);

        const containerMargin = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));

        if (state.controlsColumn) {
            state.controlsColumn.style = `margin: ${containerMargin}px;`;
        }
    });
}

