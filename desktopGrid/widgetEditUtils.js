import St from 'gi://St';
import Clutter from 'gi://Clutter';
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

    const overlay = new St.Button({
        style: `
            border-radius: ${OVERLAY_RADIUS_PX}px;
            background-color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(0, 0, 0, 0.2);
            box-shadow: 0px 2px 4px rgba(0,0,0,0.3);
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

    // The handle lives on the grid, so a grid rebuild can destroy it at any moment,
    // including mid-resize. Everything the handle started has to be undone here or
    // the grid overlay stays painted on every monitor and the context menu keeps
    // offering to hide a handle that no longer exists. Safe to run more than once.
    const teardownResizeHandle = () => {
        if (widgetNode.actionOverlay === overlay)
            widgetNode.actionOverlay = null;
        if (isResizing) {
            isResizing = false;
            widgetNode.isResizing = false;
            if (widgetNode.gridOverlayCallback) widgetNode.gridOverlayCallback(false);
        }
        cleanupResizeHandlers();
        detachPlacementListeners();
    };

    registerWidgetCleanup(widgetNode, () => {
        teardownResizeHandle();
        overlay.destroy();
    });

    overlay.connect('destroy', teardownResizeHandle);

    const minWidth = cellTotalWidth;
    const minHeight = cellTotalHeight;

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        // Cleared before the final set_size below, so anything that restyles itself on
        // a size change settles once on the snapped size rather than on the last
        // dragged one.
        widgetNode.isResizing = false;
        if (widgetNode.gridOverlayCallback) widgetNode.gridOverlayCallback(false);
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

        // Anything that held still during the drag settles here on the final size.
        // Done after the resize is applied, and unconditionally: the size is
        // cell-quantised already, so this is the only point it is known to match the
        // snapped result.
        settleAfterResize(widgetNode);

        overlay.destroy();
    };

    overlay.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            cleanupResizeHandlers();
            isResizing = true;
            widgetNode.isResizing = true;
            if (widgetNode.gridOverlayCallback) widgetNode.gridOverlayCallback(true);
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

                // A free-flow widget follows the pointer exactly and rounds to the grid
                // only on release, so nothing here may quantise the size: a cap derived
                // from a cell count is itself a cell multiple, and it drags the widget
                // onto the grid mid-drag while it is still growing. Shrinking moves away
                // from a cap and never meets one, so only growing would show it.
                //
                // Only a real edge stops the drag. The stage is used for the bottom rather
                // than maxRows, because a screen too short for a whole number of cells
                // leaves the last row hanging past the work area.
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
