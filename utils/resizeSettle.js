// Work that has been put off until a resize drag has ended.
//
// A drag calls set_size on every motion event, and a widget that restyles or redraws
// in response does that work dozens of times a second. On a growing widget that is
// progressively more expensive, so the work looks worse the further the drag goes and
// reads as judder. A static image is cheap enough to survive it; an animated one has
// to re-rasterise a frame each time and cannot.
//
// Widgets therefore hold still while widgetNode.isResizing is set, and queue whatever
// they still owe here. The grid calls settleAfterResize once the drag ends and the
// widget has been snapped to the grid.
//
// The queue lives on the node rather than in a module-level map so it is collected
// with the widget and cannot outlive it.

/** Queues `callback` to run when the widget's current resize drag ends. */
export function addSettleAfterResize(widgetNode, callback) {
    if (!widgetNode.settleAfterResizeCallbacks)
        widgetNode.settleAfterResizeCallbacks = [];
    widgetNode.settleAfterResizeCallbacks.push(callback);
}

/**
 * Runs everything queued for this widget. Called by the grid once a drag has ended and
 * the final size is applied.
 *
 * A callback that throws must not stop the rest, or one broken widget would leave the
 * others showing a size from mid-drag.
 */
export function settleAfterResize(widgetNode) {
    const callbacks = widgetNode.settleAfterResizeCallbacks;
    if (!callbacks)
        return;
    for (const callback of callbacks) {
        try {
            callback();
        } catch (error) {
            console.error('Gridgets: settling after resize failed:', error);
        }
    }
}
