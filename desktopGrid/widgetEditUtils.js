import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    calculateResizedDimensions,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    COLUMNS_COUNT,
    ROWS_COUNT
} from '../utils/widgetUtils.js';
import { BUTTON_PRIMARY } from './constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

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
    extensionPath,
    onResizeEnd,
    allWidgets = [],
    maxCols = COLUMNS_COUNT,
    maxRows = ROWS_COUNT
) {
    if (widgetNode.actionOverlay) {
        widgetNode.actionOverlay.destroy();
        widgetNode.actionOverlay = null;
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
    let widgetDestroyId = 0;

    const detachPlacementListeners = () => {
        if (isActorDestroyed(widgetNode)) return;
        if (sizeNotifyId) { widgetNode.disconnect(sizeNotifyId); sizeNotifyId = 0; }
        if (positionNotifyId) { widgetNode.disconnect(positionNotifyId); positionNotifyId = 0; }
        if (widgetDestroyId) { widgetNode.disconnect(widgetDestroyId); widgetDestroyId = 0; }
    };

    sizeNotifyId = widgetNode.connect('notify::size', updateHandlePlacement);
    positionNotifyId = widgetNode.connect('notify::position', updateHandlePlacement);
    // If the widget is destroyed while its handle is visible, take the handle with it.
    widgetDestroyId = widgetNode.connect('destroy', () => {
        sizeNotifyId = 0;
        positionNotifyId = 0;
        widgetDestroyId = 0;
        overlay.destroy();
    });

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

    const minWidth = cellTotalWidth;
    const minHeight = cellTotalHeight;

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
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

        widgetNode.actionOverlay = null;
        overlay.destroy();
    };

    overlay.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            cleanupResizeHandlers();
            isResizing = true;
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

                const rawWidth = Math.max(minWidth, resizeStartWidth + dx);
                const rawHeight = Math.max(minHeight, resizeStartHeight + dy);

                const proposedCols = Math.max(1, Math.round((rawWidth + GRID_GAP_PX) / cellTotalWidth));
                const proposedRows = Math.max(1, Math.round((rawHeight + GRID_GAP_PX) / cellTotalHeight));
                const proposedGridX = Math.round((widgetNode.x - GRID_MARGIN_PX) / cellTotalWidth);

                const { validCols, validRows } = calculateResizedDimensions(
                    widgetData, proposedCols, proposedRows, proposedGridX, allWidgets, maxCols, maxRows
                );

                const maxAllowedWidth = (validCols * cellTotalWidth) - GRID_GAP_PX;
                const maxAllowedHeight = (validRows * cellTotalHeight) - GRID_GAP_PX;

                const newWidth = Math.min(rawWidth, maxAllowedWidth);
                const newHeight = Math.min(rawHeight, maxAllowedHeight);

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

    overlay.connect('destroy', () => {
        cleanupResizeHandlers();
        detachPlacementListeners();
    });

    widgetNode.actionOverlay = overlay;
    placementHost.add_child(overlay);
    updateHandlePlacement();
}
