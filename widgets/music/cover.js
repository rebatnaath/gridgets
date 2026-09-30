import GLib from 'gi://GLib';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, parseCssColor, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { extractDominantColor, ensureLocalArtwork, monitorArtworkFile, clearArtworkMonitor, newestArtworkForTrack } from './artwork.js';
import { clampWidgetScale } from '../../utils/typography.js';

const COVER_TEXT_LUMINANCE_THRESHOLD = 0.55;
// How many times one art URL may resolve to nothing before it is settled. Each attempt
// already waits internally, so this only has to outlast a player that advertises a URL
// well before the cover lands. A new track brings a new URL and a fresh budget.
const ARTWORK_RESOLVE_MAX_MISSES = 20;
export const LIGHT_TEXT_ON_DARK_COVER = 'rgba(255, 255, 255, 0.92)';
const DARK_TEXT_ON_LIGHT_COVER = 'rgba(30, 30, 30, 0.92)';

/**
 * The scale the responsive scaler would compute, for use before it is attached.
 *
 * Its first pass is deferred to an idle, so a layout that only styles itself from the
 * callback paints one frame unscaled. Falls back to the reference size while the actor is
 * still unallocated, which is a scale of 1.
 */
export function initialMusicScale(widgetNode, refWidth, refHeight) {
    const width = widgetNode.width > 0 ? widgetNode.width : refWidth;
    const height = widgetNode.height > 0 ? widgetNode.height : refHeight;
    return clampWidgetScale(Math.min(width / refWidth, height / refHeight));
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

export function resolveArtworkLayerStyle(state) {
    const borderRadius = `${resolveWidgetCornerRadius(state.config)}px`;
    const radius = state.config.isLargeLayout
        ? `${borderRadius} 0 0 ${borderRadius}`
        : borderRadius;
    const backgroundColor = resolveWidgetBackgroundColor(state.config);
    const artworkCss = state.artworkCss || '';
    return `${artworkCss}background-color: ${backgroundColor}; border-radius: ${radius};`;
}

export async function applyArtworkToBackground(backgroundLayer, artUrl, config, state) {
    const styleSignature = `${resolveWidgetCornerRadius(config)}|${resolveWidgetBackgroundColor(config)}|${artUrl || ''}`;

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
        // filename_to_uri, not a file:// prefix: this is a bare path, and a quote or
        // backslash in it would close the url() token and the cover would not paint.
        const imageUrl = localPath.startsWith('file://') ? localPath : GLib.filename_to_uri(localPath, null);
        state.artworkCss = `background-image: url("${imageUrl}"); background-size: cover; `;
        backgroundLayer.style = resolveArtworkLayerStyle(state);

        extractDominantColor(localPath, state).then(color => {
            if (isActorDestroyed(state.container) || state.lastAppliedArtPath !== localPath) return;
            setAlbumColor(state, color);
        });
    };

    // Normal for the first seconds of a track: the player writes the cover before
    // advertising it, so the folder is checked before holding what is on screen.
    if (!artUrl) {
        await newestArtworkForTrack(state, resolvedPath => {
            if (resolvedPath) {
                state.resolvedArtUrl = null;
                applyStyle(resolvedPath);
            }
        });
        return;
    }

    // Runs on every one-second poll, so a URL that already resolved to a file is reused
    // rather than re-resolved.
    if (state.resolvedArtUrl === artUrl && state.resolvedArtPath) {
        applyStyle(state.resolvedArtPath);
        return;
    }
    // A budget-spent miss is left alone rather than retried every second.
    if (state.resolvedArtUrl === artUrl && (state.resolvedArtMisses || 0) >= ARTWORK_RESOLVE_MAX_MISSES) {
        return;
    }
    state.resolvedArtUrl = artUrl;
    state.resolvedArtPath = undefined;

    // The path is advertised before the cover is written, so watch it and resolve the
    // moment the file lands rather than on the next poll.
    monitorArtworkFile(artUrl, state, () => {
        state.resolvedArtUrl = null;
        state.resolvedArtMisses = 0;
        void applyArtworkToBackground(backgroundLayer, artUrl, config, state);
    });

    ensureLocalArtwork(artUrl, state, resolvedPath => {
        // A miss is retried rather than latched: the same URL resolving to nothing means
        // the cover has not been written yet. Counted per URL, and reset on a hit.
        state.resolvedArtMisses = resolvedPath
            ? 0
            : (state.resolvedArtMisses || 0) + 1;
        state.resolvedArtPath = resolvedPath;
        applyStyle(resolvedPath);
    });
}
