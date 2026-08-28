import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, parseCssColor } from '../../utils/widgetUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { extractDominantColor, ensureLocalArtwork } from './artwork.js';

const COVER_TEXT_LUMINANCE_THRESHOLD = 0.55;
const LIGHT_TEXT_ON_DARK_COVER = 'rgba(255, 255, 255, 0.92)';
const DARK_TEXT_ON_LIGHT_COVER = 'rgba(30, 30, 30, 0.92)';

/** Checks whether the dominant cover color is currently tinting the layout, which calls for flat styling. */
export function isCoverTintActive(state) {
    return state.config.coverBackground === true && Boolean(state.albumColor);
}

export function resolveMusicPanelColors(config, state) {
    const baseTextColor = resolveWidgetForegroundColor(config);
    const isCoverTinted = config.coverBackground === true && state.albumColor;
    if (!isCoverTinted)
        return { panelColor: resolveWidgetBackgroundColor(config), textColor: baseTextColor };

    const { r, g, b } = parseCssColor(state.albumColor);
    const luminance = (r * 0.299) + (g * 0.587) + (b * 0.114);
    const textColor = luminance > COVER_TEXT_LUMINANCE_THRESHOLD
        ? DARK_TEXT_ON_LIGHT_COVER
        : LIGHT_TEXT_ON_DARK_COVER;
    return { panelColor: state.albumColor, textColor };
}

export function setAlbumColor(state, color) {
    if (state.albumColor === color) return;
    state.albumColor = color;
    if (state.refreshBackground) state.refreshBackground();
}

// Single source of truth for artwork layer CSS -- all style writes must go through here.
export function resolveArtworkLayerStyle(state) {
    const borderRadius = state.config.appliedBorderRadius !== undefined ? `${state.config.appliedBorderRadius}px` : '0px';
    const backgroundColor = resolveWidgetBackgroundColor(state.config);
    const artworkCss = state.artworkCss || '';
    return `${artworkCss}background-color: ${backgroundColor}; border-radius: ${borderRadius};`;
}

export function applyArtworkToBackground(backgroundLayer, artUrl, config, state) {
    const styleSignature = `${config.appliedBorderRadius !== undefined ? config.appliedBorderRadius : '0px'}|${resolveWidgetBackgroundColor(config)}|${artUrl || ''}`;

    const applyStyle = (localPath) => {
        if (!state.container || isActorDestroyed(state.container)) return;
        if (localPath && localPath === state.lastAppliedArtPath && styleSignature === state.lastAppliedArtStyleSignature) return;

        state.lastAppliedArtPath = localPath;
        state.lastAppliedArtStyleSignature = styleSignature;

        if (!localPath) {
            state.artworkCss = null;
            backgroundLayer.style = resolveArtworkLayerStyle(state);
            setAlbumColor(state, null);
            return;
        }
        const imageUrl = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
        state.artworkCss = `background-image: url("${imageUrl}"); background-size: cover; `;
        backgroundLayer.style = resolveArtworkLayerStyle(state);

        extractDominantColor(localPath).then(color => {
            if (isActorDestroyed(state.container) || state.lastAppliedArtPath !== localPath) return;
            setAlbumColor(state, color);
        });
    };

    if (!artUrl) {
        applyStyle(null);
        return;
    }

    ensureLocalArtwork(artUrl, state, applyStyle);
}
