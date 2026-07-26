/**
 * ============================================================================
 * WIDGET EDIT UTILITIES
 * 
 * Logic for handling widget resize operations. Toggles the resize handle
 * overlay (resize.svg), handles drag-to-resize events, calculates new grid
 * dimensions, and triggers callbacks when resizing completes.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { calculateResizedDimensions, GRID_GAP_PX, GRID_MARGIN_PX } from './widgetUtils.js';

/** Overlay dimension metrics */
export const RESIZE_HANDLE_OFFSET = 32;
export const OVERLAY_SIZE_PX = 24;
export const OVERLAY_RADIUS_PX = 12;

/** Clutter mouse button constants */
const BUTTON_PRIMARY = 1;

/**
 * Toggles the interactive resize handle overlay (resize.svg) on a widget node.
 * If the resize handle is already visible, calling this destroys/removes it.
 */
export function toggleWidgetResizeHandle(widgetNode, widgetData, cellTotalWidth, cellTotalHeight, extensionPath, onResizeEnd, allWidgets = []) {
    if (widgetNode.actionOverlay) {
        widgetNode.actionOverlay.destroy();
        widgetNode.actionOverlay = null;
        return;
    }

    const iconPath = `${extensionPath}/assets/resize.svg`;

    const overlay = new St.Widget({
        style: `
            background-image: url("file://${iconPath}"); 
            background-size: cover; 
            width: ${OVERLAY_SIZE_PX}px; 
            height: ${OVERLAY_SIZE_PX}px; 
            border-radius: ${OVERLAY_RADIUS_PX}px;
            background-color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(0, 0, 0, 0.2);
            box-shadow: 0px 2px 4px rgba(0,0,0,0.3);
        `,
        reactive: true,
    });

    overlay.set_position(widgetNode.width - RESIZE_HANDLE_OFFSET, widgetNode.height - RESIZE_HANDLE_OFFSET);

    let isResizing = false;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeMotionId = 0;
    let resizeReleaseId = 0;

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        if (widgetNode.gridOverlayCallback) widgetNode.gridOverlayCallback(false);
        if (resizeMotionId) { global.stage.disconnect(resizeMotionId); resizeMotionId = 0; }
        if (resizeReleaseId) { global.stage.disconnect(resizeReleaseId); resizeReleaseId = 0; }

        const proposedGridX = Math.round((widgetNode.x - GRID_MARGIN_PX) / cellTotalWidth);
        const proposedCols = Math.max(1, Math.round((widgetNode.width + GRID_GAP_PX) / cellTotalWidth));
        const proposedRows = Math.max(1, Math.round((widgetNode.height + GRID_GAP_PX) / cellTotalHeight));

        const { validCols, validRows, validX } = calculateResizedDimensions(
            widgetData, proposedCols, proposedRows, proposedGridX, allWidgets
        );

        onResizeEnd(validCols, validRows, validX);
    };

    overlay.connect('button-press-event', (actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            if (resizeMotionId) { global.stage.disconnect(resizeMotionId); resizeMotionId = 0; }
            if (resizeReleaseId) { global.stage.disconnect(resizeReleaseId); resizeReleaseId = 0; }
            isResizing = true;
            if (widgetNode.gridOverlayCallback) widgetNode.gridOverlayCallback(true);
            const [stageX, stageY] = event.get_coords();
            resizeStartX = stageX;
            resizeStartY = stageY;
            resizeStartWidth = widgetNode.width;
            resizeStartHeight = widgetNode.height;

            resizeMotionId = global.stage.connect('motion-event', (stage, ev) => {
                const state = ev.get_state();
                if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                    endResize();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [x, y] = ev.get_coords();
                const dx = x - resizeStartX;
                const dy = y - resizeStartY;

                const rawWidth = Math.max(cellTotalWidth, resizeStartWidth + dx);
                const rawHeight = Math.max(cellTotalHeight, resizeStartHeight + dy);

                const proposedCols = Math.max(1, Math.round((rawWidth + GRID_GAP_PX) / cellTotalWidth));
                const proposedRows = Math.max(1, Math.round((rawHeight + GRID_GAP_PX) / cellTotalHeight));
                const proposedGridX = Math.round((widgetNode.x - GRID_MARGIN_PX) / cellTotalWidth);

                const { validCols, validRows } = calculateResizedDimensions(
                    widgetData, proposedCols, proposedRows, proposedGridX, allWidgets
                );

                const maxAllowedWidth = (validCols * cellTotalWidth) - GRID_GAP_PX;
                const maxAllowedHeight = (validRows * cellTotalHeight) - GRID_GAP_PX;

                const newWidth = Math.min(rawWidth, maxAllowedWidth);
                const newHeight = Math.min(rawHeight, maxAllowedHeight);

                widgetNode.set_size(newWidth, newHeight);
                overlay.set_position(newWidth - RESIZE_HANDLE_OFFSET, newHeight - RESIZE_HANDLE_OFFSET);
                return Clutter.EVENT_STOP;
            });

            resizeReleaseId = global.stage.connect('button-release-event', (stage, ev) => {
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
        if (resizeMotionId) global.stage.disconnect(resizeMotionId);
        if (resizeReleaseId) global.stage.disconnect(resizeReleaseId);
    });

    widgetNode.actionOverlay = overlay;
    widgetNode.add_child(overlay);
}
