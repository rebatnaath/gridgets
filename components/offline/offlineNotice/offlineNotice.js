import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    TYPOGRAPHY_SIZE,
    TYPOGRAPHY_WEIGHT,
    TEXT_OPACITY,
    ICON_OPACITY_SECONDARY,
    MIN_FONT_SIZE,
    scaleFontSize,
} from '../../../utils/typography.js';

export const OFFLINE_NOTICE_MESSAGES = Object.freeze({
    offline: 'Offline',
    empty: 'No content to show',
    stale: 'Showing saved content',
});

/**
 * The one rule every network-backed widget follows when a fetch produces no content:
 * never discard what is already on screen, and say which situation the user is in.
 * `stale` wins over `offline` because visible-but-unrefreshable is not the same problem
 * as no network. `isNetworkAvailable` is true when the network is fine, so a failure
 * while it is up means an empty feed or a refused request, not a dead connection.
 */
export function noticeMessageForFetchFailure(hasContent, isNetworkAvailable) {
    if (hasContent)
        return OFFLINE_NOTICE_MESSAGES.stale;
    return isNetworkAvailable ? OFFLINE_NOTICE_MESSAGES.empty : OFFLINE_NOTICE_MESSAGES.offline;
}

/** A single name, not a chain: Gio.ThemedIcon.new rejects an array in this GJS, and a
 *  plain icon_name already gets the -symbolic fallback from the theme. */
const OFFLINE_ICON_NAME = 'network-wireless-offline-symbolic';

const BASE_TEXT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const BASE_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconLg;
const ICON_TEXT_GAP_PX = 6;

/** A dimmed icon over one line of text, centred in whatever space the caller gives it.
 *  Callers keep the actor hidden until they have nothing to show, and must call
 *  applyScale from their own responsive scaler. */
export function createOfflineNotice({ fontCss = '', textColor = '', scale = 1 } = {}) {
    const icon = new St.Icon({
        icon_name: OFFLINE_ICON_NAME,
        icon_size: scaleFontSize(BASE_ICON_SIZE_PX, scale),
    });

    const label = new St.Label({
        text: OFFLINE_NOTICE_MESSAGES.empty,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const actor = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    actor.add_child(icon);
    actor.add_child(label);

    function applyScale(nextScale) {
        const currentScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
        const gap = scaleFontSize(ICON_TEXT_GAP_PX, currentScale);
        icon.icon_size = scaleFontSize(BASE_ICON_SIZE_PX, currentScale);
        // Opacity goes in the stylesheet, which takes a 0-1 float. ClutterActor.opacity
        // is a 0-255 ubyte and would truncate this to zero.
        icon.style = `color: ${textColor}; opacity: ${ICON_OPACITY_SECONDARY};`;
        label.style = `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`
            + ` font-size: ${scaleFontSize(BASE_TEXT_SIZE_PX, currentScale, MIN_FONT_SIZE.label)}px;`
            + ` font-weight: ${TYPOGRAPHY_WEIGHT.medium}; padding: 0 ${gap}px;`;
    }

    function setMessage(message) {
        label.text = message || OFFLINE_NOTICE_MESSAGES.empty;
    }

    applyScale(scale);
    setMessage(OFFLINE_NOTICE_MESSAGES.empty);

    return { actor, setMessage, applyScale };
}
