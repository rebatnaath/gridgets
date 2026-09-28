import St from 'gi://St';
import Clutter from 'gi://Clutter';

// St parses its own gradient properties, not a CSS linear-gradient(), which it drops
// without an error.
const SCRIM_OPACITY = 0.75;

const SCRIM_STYLE = 'background-gradient-direction: vertical; '
    + 'background-gradient-start: rgba(0, 0, 0, 0); '
    + `background-gradient-end: rgba(0, 0, 0, ${SCRIM_OPACITY});`;

/** Null when `enabled` is not true. `borderRadius` must match the container's, since the
 * scrim spans the full width and set_clip_to_allocation clips to the rectangle. */
export function createScrim({ enabled, borderRadius = null }) {
    if (enabled !== true)
        return null;

    return new St.Widget({
        style: borderRadius === null
            ? SCRIM_STYLE
            : `${SCRIM_STYLE} border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
}
