import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_MARGIN_PX,
    checkOverlap,
    calculateResizedDimensions,
    calculateGridDimensions,
    getWidgets,
    saveWidgets,
    deleteCacheFile
} from '../utils/widgetUtils.js';
import { getWidgetsForMonitor, getPanelHeight, getEffectiveMonitorIndex } from './helpers.js';
import { registerWidgetCleanup } from '../shell/widgetUIUtils.js';
import { openWidgetContextMenu } from './contextMenu.js';
import {
    BUTTON_PRIMARY,
    BUTTON_SECONDARY,
    DRAG_MOTION_THRESHOLD_PX,
} from './constants.js';

function endDrag(state, grid, node, widgetData) {
    if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
    if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }
    if (state.isDragging) {
        state.isDragging = false;

        const widgets = getWidgets(grid.settings);
        const targetWidget = widgets.find(w => w.id === widgetData.id);

        if (targetWidget) {
            const monitorSetting = grid.settings.get_string('global-monitor') || 'primary';
            const monitors = Main.layoutManager.monitors || [];

            const widgetStageX = grid.x + node.x;
            const widgetStageY = grid.y + node.y;
            const widgetCenterX = widgetStageX + (node.width / 2);
            const widgetCenterY = widgetStageY + (node.height / 2);

            let targetMonitorIndex = null;
            let targetMonitor = null;

            if (monitorSetting === 'each' && monitors.length > 1) {
                for (let i = 0; i < monitors.length; i++) {
                    const mon = monitors[i];
                    if (widgetCenterX >= mon.x && widgetCenterX < mon.x + mon.width &&
                        widgetCenterY >= mon.y && widgetCenterY < mon.y + mon.height) {
                        targetMonitorIndex = i;
                        targetMonitor = mon;
                        break;
                    }
                }
            }

            if (targetMonitorIndex !== null && targetMonitor) {
                const primaryMon = Main.layoutManager.primaryMonitor;
                const isPrimary = primaryMon ? (targetMonitor === primaryMon) : (targetMonitorIndex === 0);
                const topOffset = isPrimary ? getPanelHeight() : 0;

                const localX = widgetStageX - targetMonitor.x;
                const localY = widgetStageY - (targetMonitor.y + topOffset);

                const targetMonWidgets = getWidgetsForMonitor(widgets, targetMonitorIndex, true);
                const otherWidgetsOnTargetMon = targetMonWidgets.filter(widget => widget.id !== widgetData.id);

                const gridCols = COLUMNS_COUNT;

                const { cellTotalWidth, cellTotalHeight, gridRows } = calculateGridDimensions(targetMonitor.width, targetMonitor.height - topOffset, gridCols);

                const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((localX - GRID_MARGIN_PX) / cellTotalWidth)));
                const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((localY - GRID_MARGIN_PX) / cellTotalHeight)));

                if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgetsOnTargetMon)) {
                    targetWidget.x = targetCol;
                    targetWidget.y = targetRow;
                    targetWidget.monitor = isPrimary ? 'primary' : String(targetMonitorIndex);
                    // applyLocalWidgetLayout seeds diff guard, so drop node
                    // explicitly and let destination grid recreate it.
                    const movedNode = grid.widgetNodes.get(targetWidget.id);
                    if (movedNode) {
                        movedNode.destroy();
                        grid.widgetNodes.delete(targetWidget.id);
                        grid._nodeConfigs.delete(targetWidget.id);
                    }
                    grid.applyLocalWidgetLayout(widgets);
                } else {
                    grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, state.origGridX, state.origGridY);
                }
            } else {
                const activeWidgets = getWidgetsForMonitor(widgets, grid.targetMonitorIndex, true);
                const gridCols = grid.gridCols || COLUMNS_COUNT;
                const gridRows = grid.gridRows || ROWS_COUNT;
                const otherWidgets = activeWidgets.filter(widget => widget.id !== widgetData.id);

                const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((node.x - GRID_MARGIN_PX) / grid.cellTotalWidth)));
                const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((node.y - GRID_MARGIN_PX) / grid.cellTotalHeight)));

                if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgets)) {
                    targetWidget.x = targetCol;
                    targetWidget.y = targetRow;
                    grid.applyLocalWidgetLayout(widgets);
                    grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, targetCol, targetRow);
                } else {
                    grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, state.origGridX, state.origGridY);
                }
            }
        }
        grid.constructor.toggleAllGridOverlays(false);
    }
}

/** The single in-flight drag, if any; lets a new press cancel a drag whose release event was consumed by a grab. */
let activeDrag = null;

function cancelInterruptedDrag() {
    if (!activeDrag) return;
    const { state, grid, node, widgetData } = activeDrag;
    activeDrag = null;
    endDrag(state, grid, node, widgetData);
}

export function attachDragHandlers(grid, node, widgetData) {
    let pressX = 0;
    let pressY = 0;
    const state = { isDragging: false, dragMotionId: 0, dragReleaseId: 0, startX: 0, startY: 0, origGridX: 0, origGridY: 0 };

    const finishDrag = () => {
        if (activeDrag && activeDrag.state === state) activeDrag = null;
        endDrag(state, grid, node, widgetData);
    };

    node.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_SECONDARY) {
            openWidgetContextMenu(grid, event, node, widgetData);
            return Clutter.EVENT_STOP;
        }

        if (event.get_button() === BUTTON_PRIMARY) {
            cancelInterruptedDrag();

            [pressX, pressY] = event.get_coords();
            state.startX = node.x;
            state.startY = node.y;
            state.origGridX = widgetData.x;
            state.origGridY = widgetData.y;

            if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
            if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }

            state.dragMotionId = global.stage.connect('motion-event', (_stage, ev) => {
                const evState = ev.get_state();
                if (!(evState & Clutter.ModifierType.BUTTON1_MASK)) {
                    finishDrag();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [curX, curY] = ev.get_coords();
                const dx = curX - pressX;
                const dy = curY - pressY;

                if (!state.isDragging && (Math.abs(dx) > DRAG_MOTION_THRESHOLD_PX || Math.abs(dy) > DRAG_MOTION_THRESHOLD_PX)) {
                    state.isDragging = true;
                    grid.constructor.toggleAllGridOverlays(true);
                }

                if (state.isDragging) {
                    node.set_position(state.startX + dx, state.startY + dy);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            state.dragReleaseId = global.stage.connect('button-release-event', (_stage, ev) => {
                if (ev.get_button() === BUTTON_PRIMARY) {
                    finishDrag();
                }
                return Clutter.EVENT_PROPAGATE;
            });

            activeDrag = { state, grid, node, widgetData };
        }
        return Clutter.EVENT_PROPAGATE;
    });

    registerWidgetCleanup(node, () => {
        if (activeDrag && activeDrag.state === state) activeDrag = null;
        cancelInterruptedDragForState(state);
    });
}

function cancelInterruptedDragForState(state) {
    if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
    if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }
}

export function onWidgetResized(grid, widgetId, newCols, newRows, newX) {
    const allWidgets = getWidgets(grid.settings);
    const monitorMode = grid.settings.get_string('global-monitor') || 'primary';
    const isEachMode = (monitorMode === 'each');
    const activeWidgets = getWidgetsForMonitor(allWidgets, getEffectiveMonitorIndex(grid.targetMonitorIndex, grid.settings), isEachMode);
    const widget = activeWidgets.find(activeWidget => activeWidget.id === widgetId);
    if (!widget) return;

    const otherWidgets = activeWidgets.filter(activeWidget => activeWidget.id !== widgetId);
    const gridCols = grid.gridCols || COLUMNS_COUNT;
    const gridRows = grid.gridRows || ROWS_COUNT;
    const { validCols, validRows, validX } = calculateResizedDimensions(widget, newCols, newRows, newX, otherWidgets, gridCols, gridRows);

    if (!checkOverlap(validX, widget.y, validCols, validRows, otherWidgets)) {
        const targetWidget = allWidgets.find(existingWidget => existingWidget.id === widgetId);
        if (targetWidget) {
            targetWidget.width = validCols;
            targetWidget.height = validRows;
            targetWidget.x = validX;
            grid.applyLocalWidgetLayout(allWidgets);
            grid._repositionNode(widgetId, validCols, validRows, validX, widget.y);
        }
    }
}

export function onWidgetDeleted(grid, widgetId) {
    const widgets = getWidgets(grid.settings);
    const targetWidget = widgets.find(widget => widget.id === widgetId);
    if (targetWidget) {
        if (targetWidget.type === 'notes') {
            deleteCacheFile('notes', widgetId);
        } else if (targetWidget.type === 'clipboard') {
            deleteCacheFile('clipboard', widgetId);
        } else if (targetWidget.type === 'todo') {
            deleteCacheFile('todos', widgetId);
        } else if (targetWidget.type === 'github') {
            deleteCacheFile('github', widgetId);
        }
    }
    const remainingWidgets = widgets.filter(widget => widget.id !== widgetId);
    saveWidgets(grid.settings, remainingWidgets);
}
