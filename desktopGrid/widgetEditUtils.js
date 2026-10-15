import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import {
    calculateResizedDimensions,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    COLUMNS_COUNT,
} from '../utils/widgetUtils.js';
import { settleAfterResize } from '../utils/resizeSettle.js';
import { BUTTON_PRIMARY } from './constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';
import { registerWidgetCleanup } from '../shell/widgetUIUtils.js';

const OVERLAY_SIZE_PX = 28;
const OVERLAY_RADIUS_PX = 6;
/** Inset between the resize handle and the widget's bottom-right corner. */
const RESIZE_HANDLE_MARGIN_PX = 4;
const RESIZE_ICON_SIZE_PX = 16;

// Held outside the handle, because reading a property off an already disposed actor
// raises in GJS, and destroy() has to be callable on one.
const RESIZE_HANDLE_TEARDOWNS = new WeakMap();

/**
 * The handle is a plain button, so tying teardown to its destruction means overriding
 * destroy(): every path that kills it goes through the class vfunc, whether the call is
 * `handle.destroy()` from here or the handle going down with the grid that parents it.
 *
 * It is idempotent because a handle really is destroyed twice: the toggle-off branch and
 * endResize() destroy it explicitly, and the widget's own cleanup does it again when the
 * node goes. The repeat call has to stop before super.destroy().
 */
const ResizeHandle = GObject.registerClass(
    class ResizeHandle extends St.Button {
        destroy() {
            const teardown = RESIZE_HANDLE_TEARDOWNS.get(this);
            if (!teardown)
                return;
            RESIZE_HANDLE_TEARDOWNS.delete(this);
            teardown();
            super.destroy();
        }
    });

export function toggleWidgetResizeHandle(
    widgetNode,
    widgetData,
    cellTotalWidth,
    cellTotalHeight,
    onResizeEnd,
    allWidgets = [],
    maxCols = COLUMNS_COUNT,
    maxRows = Number.POSITIVE_INFINITY
) {
    if (widgetNode.actionOverlay) {
        // Destroying the handle runs its teardown, which clears actionOverlay.
        widgetNode.actionOverlay.destroy();
        return;
    }

    const overlay = new ResizeHandle({
        style: `
            border-radius: ${OVERLAY_RADIUS_PX}px;
            background-color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(0, 0, 0, 0.2);
            box-shadow: 0px 2px 4px 0px rgba(0, 0, 0, 0.3);
            padding: 0px;
        `,
        reactive: true,
        can_focus: true,
        child: new St.Icon({
            icon_name: 'view-fullscreen-symbolic',
            icon_size: RESIZE_ICON_SIZE_PX,
            style: 'color: rgba(0, 0, 0, 0.7);',
        }),
    });
    overlay.set_size(OVERLAY_SIZE_PX, OVERLAY_SIZE_PX);

    // Attach to grid canvas (not widget) for consistent absolute positioning.
    const placementHost = widgetNode.get_parent() || widgetNode;

    const updateHandlePlacement = () => {
        const originX = placementHost === widgetNode ? 0 : widgetNode.x;
        const originY = placementHost === widgetNode ? 0 : widgetNode.y;
        overlay.set_position(
            Math.max(0, originX + widgetNode.width - OVERLAY_SIZE_PX - RESIZE_HANDLE_MARGIN_PX),
            Math.max(0, originY + widgetNode.height - OVERLAY_SIZE_PX - RESIZE_HANDLE_MARGIN_PX)
        );
        if (overlay.get_parent())
            overlay.get_parent().set_child_above_sibling(overlay, null);
    };

    let sizeNotifyId = 0;
    let positionNotifyId = 0;

    const detachPlacementListeners = () => {
        if (isActorDestroyed(widgetNode)) return;
        if (sizeNotifyId) { widgetNode.disconnect(sizeNotifyId); sizeNotifyId = 0; }
        if (positionNotifyId) { widgetNode.disconnect(positionNotifyId); positionNotifyId = 0; }
    };

    sizeNotifyId = widgetNode.connect('notify::size', updateHandlePlacement);
    positionNotifyId = widgetNode.connect('notify::position', updateHandlePlacement);

    let isResizing = false;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeMotionId = 0;
    let resizeReleaseId = 0;

    const cleanupResizeHandlers = () => {
        if (resizeMotionId) { global.stage.disconnect(resizeMotionId); resizeMotionId = 0; }
        if (resizeReleaseId) { global.stage.disconnect(resizeReleaseId); resizeReleaseId = 0; }
    };

    // A grid rebuild can destroy the handle at any moment, mid-resize included. Everything
    // it started has to be undone here or the overlay stays painted on every monitor.
    // Safe to run more than once.
    const teardownResizeHandle = () => {
        if (widgetNode.actionOverlay === overlay)
            widgetNode.actionOverlay = null;
        if (isResizing) {
            isResizing = false;
            widgetNode.isResizing = false;
            widgetNode.gridOverlayCallback(false);
        }
        cleanupResizeHandlers();
        detachPlacementListeners();
    };

    RESIZE_HANDLE_TEARDOWNS.set(overlay, teardownResizeHandle);

    registerWidgetCleanup(widgetNode, () => overlay.destroy());

    const minWidth = cellTotalWidth;
    const minHeight = cellTotalHeight;

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        // Cleared before the final set_size below, so a restyle settles on the snapped
        // size rather than the last dragged one.
        widgetNode.isResizing = false;
        widgetNode.gridOverlayCallback(false);
        cleanupResizeHandlers();

        const safeWidth = Math.max(1, widgetNode.width);
        const safeHeight = Math.max(1, widgetNode.height);

        const proposedGridX = Math.round((widgetNode.x - GRID_MARGIN_PX) / cellTotalWidth);
        const proposedCols = Math.max(1, Math.round((safeWidth + GRID_GAP_PX) / cellTotalWidth));
        const proposedRows = Math.max(1, Math.round((safeHeight + GRID_GAP_PX) / cellTotalHeight));

        const { validCols, validRows, validX } = calculateResizedDimensions(
            widgetData, proposedCols, proposedRows, proposedGridX, allWidgets, maxCols, maxRows
        );

        onResizeEnd(validCols, validRows, validX);

        // Everything held still during the drag settles here, after the resize is applied:
        // the size is cell-quantised, so this is the only point it matches the snapped one.
        settleAfterResize(widgetNode);

        overlay.destroy();
    };

    overlay.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            cleanupResizeHandlers();
            isResizing = true;
            widgetNode.isResizing = true;
            widgetNode.gridOverlayCallback(true);
            const [stageX, stageY] = event.get_coords();
            resizeStartX = stageX;
            resizeStartY = stageY;
            resizeStartWidth = widgetNode.width;
            resizeStartHeight = widgetNode.height;

            resizeMotionId = global.stage.connect('motion-event', (_stage, ev) => {
                const state = ev.get_state();
                if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                    endResize();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [x, y] = ev.get_coords();
                const dx = x - resizeStartX;
                const dy = y - resizeStartY;

                // The size follows the pointer exactly and rounds to the grid on release, so
                // nothing here may quantise it: a cap derived from a cell count is itself a
                // cell multiple, and meeting one snaps the widget onto the grid mid-drag.
                // The stage is the bottom edge because maxRows leaves the last row hanging
                // past the work area on a screen too short for a whole number of cells.
                const placementHost = widgetNode.get_parent() || widgetNode;
                const gridRight = GRID_MARGIN_PX + (maxCols * cellTotalWidth);
                const gridBottom = global.stage.height - GRID_MARGIN_PX;
                const originX = placementHost === widgetNode ? 0 : widgetNode.x;
                const originY = placementHost === widgetNode ? 0 : widgetNode.y;

                const newWidth = Math.max(minWidth, Math.min(resizeStartWidth + dx, gridRight - originX));
                const newHeight = Math.max(minHeight, Math.min(resizeStartHeight + dy, gridBottom - originY));

                widgetNode.set_size(newWidth, newHeight);
                return Clutter.EVENT_STOP;
            });

            resizeReleaseId = global.stage.connect('button-release-event', (_stage, ev) => {
                if (ev.get_button() === BUTTON_PRIMARY) {
                    endResize();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
        return Clutter.EVENT_STOP;
    });

    widgetNode.actionOverlay = overlay;
    placementHost.add_child(overlay);
    updateHandlePlacement();
}
