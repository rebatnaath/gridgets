/**
 * ============================================================================
 * WIDGET EDIT UTILITIES
 * 
 * This file contains the logic for handling the edit modes of widgets
 * (resize and delete). It toggles the edit overlays, handles drag-to-resize
 * events, calculates new dimensions, and triggers the necessary callbacks
 * when resizing or deleting actions occur.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { calculateResizedDimensions } from './widgetUtils.js';

export const EDIT_MODE_NONE = 0;
export const EDIT_MODE_RESIZE = 1;
export const EDIT_MODE_DELETE = 2;
export const TOTAL_EDIT_MODES = 3;
export const RESIZE_HANDLE_OFFSET = 32;

/**
 * Toggles a widget's edit mode between normal, resize, and delete/close,
 * rendering the appropriate overlay handle.
 *
 * @param {Clutter.Actor} widgetNode     - widget's main actor
 * @param {Object} widgetData            - widget configuration
 * @param {number} cellTotalWidth        - Grid column width + gap
 * @param {number} cellTotalHeight       - Grid row height + gap
 * @param {string} extensionPath         - Path to the extension folder
 * @param {function} onResizeEnd         - Callback triggered when resizing ends
 * @param {function} onDelete            - Callback triggered when close/delete is clicked
 */
export function toggleWidgetEditMode(widgetNode, widgetData, cellTotalWidth, cellTotalHeight, extensionPath, onResizeEnd, onDelete) {
    if (widgetNode.editMode === undefined)
        widgetNode.editMode = EDIT_MODE_NONE;

    widgetNode.editMode = (widgetNode.editMode + 1) % TOTAL_EDIT_MODES;

    // Weather widgets use server-determined sizes, so skip resize mode
    if ((widgetData.type === 'weather') && widgetNode.editMode === EDIT_MODE_RESIZE)
        widgetNode.editMode = EDIT_MODE_DELETE;

    if (widgetNode.actionOverlay) {
        widgetNode.actionOverlay.destroy();
        widgetNode.actionOverlay = null;
    }

    if (widgetNode.editMode === EDIT_MODE_NONE)
        return;

    const iconName = widgetNode.editMode === EDIT_MODE_RESIZE ? 'resize.svg' : 'close.svg';
    const iconPath = `${extensionPath}/assets/${iconName}`;

    const overlay = new St.Widget({
        style: `
            background-image: url("file://${iconPath}"); 
            background-size: cover; 
            width: 24px; 
            height: 24px; 
            border-radius: 12px;
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
        if (resizeMotionId) { global.stage.disconnect(resizeMotionId); resizeMotionId = 0; }
        if (resizeReleaseId) { global.stage.disconnect(resizeReleaseId); resizeReleaseId = 0; }

        const proposedGridX = Math.round(widgetNode.x / cellTotalWidth);
        const proposedCols = Math.max(1, Math.round(widgetNode.width / cellTotalWidth));
        const proposedRows = Math.max(1, Math.round(widgetNode.height / cellTotalHeight));

        const { validCols, validRows, validX } = calculateResizedDimensions(
            widgetData, proposedCols, proposedRows, proposedGridX
        );

        onResizeEnd(validCols, validRows, validX);
    };

    overlay.connect('button-press-event', (actor, event) => {
        const isResizeAction = widgetNode.editMode === EDIT_MODE_RESIZE && event.get_button() === 1;
        if (isResizeAction) {
            if (resizeMotionId) { global.stage.disconnect(resizeMotionId); resizeMotionId = 0; }
            if (resizeReleaseId) { global.stage.disconnect(resizeReleaseId); resizeReleaseId = 0; }
            isResizing = true;
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

                const newWidth = Math.max(cellTotalWidth, resizeStartWidth + dx);
                const newHeight = Math.max(cellTotalHeight, resizeStartHeight + dy);

                widgetNode.set_size(newWidth, newHeight);
                overlay.set_position(newWidth - RESIZE_HANDLE_OFFSET, newHeight - RESIZE_HANDLE_OFFSET);
                return Clutter.EVENT_STOP;
            });

            resizeReleaseId = global.stage.connect('button-release-event', (stage, ev) => {
                if (ev.get_button() === 1) {
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

    overlay.connect('button-release-event', (actor, event) => {
        if (widgetNode.editMode === EDIT_MODE_DELETE && event.get_button() === 1)
            onDelete(widgetData.id);
        return Clutter.EVENT_STOP;
    });

    widgetNode.actionOverlay = overlay;
    widgetNode.add_child(overlay);
}
