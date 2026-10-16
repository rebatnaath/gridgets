/**
 * Where a widget sits on the grid, and what is stored about it.
 *
 * Everything here is either pure arithmetic or a direct read/write of the saved layout, so
 * a drag, a size preset and a rebuild cannot disagree about a widget's footprint. Node
 * construction lives in widgetSync.js.
 */
import {
    COLUMNS_COUNT,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    checkOverlap,
    findEmptySpot,
    getWidgets,
    saveWidgets,
    serializeWidgets,
    calculateGridDimensions,
} from '../utils/widgetUtils.js';
import { getWidgetsForMonitor, getEffectiveMonitorIndex } from './helpers.js';
import { isDesktopIconVisible } from '../desktopIcons/desktopIcons.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

/** Pixel rect of a cols×rows footprint whose top-left cell is at (cellX, cellY). */
export function gridGeometry(cols, rows, cellX, cellY, cellSize, cellTotalWidth, cellTotalHeight) {
    return {
        width: (cols * cellSize) + ((cols - 1) * GRID_GAP_PX),
        height: (rows * cellSize) + ((rows - 1) * GRID_GAP_PX),
        x: GRID_MARGIN_PX + (cellX * cellTotalWidth),
        y: GRID_MARGIN_PX + (cellY * cellTotalHeight),
    };
}

/**
 * Clamps a footprint into the grid and, if it lands on something already placed, moves it
 * to the first free spot. Returns false when nothing was free, which is the grid being
 * full: the widget keeps the position it already had, because writing the overlap down
 * would persist it into the saved layout.
 */
export function placeInFreeSpot(widgetData, placedWidgets, gridCols, gridRows) {
    // A widget saved before it had a footprint is two cells square, which is also what
    // addWidget() defaults to.
    const cols = Math.max(1, Math.min(widgetData.width || 2, gridCols));
    const rows = Math.max(1, Math.min(widgetData.height || 2, gridRows));
    let x = Math.max(0, Math.min(widgetData.x || 0, gridCols - cols));
    let y = Math.max(0, Math.min(widgetData.y || 0, gridRows - rows));

    if (checkOverlap(x, y, cols, rows, placedWidgets)) {
        const freeSpot = findEmptySpot(placedWidgets, cols, rows, gridCols, gridRows);
        if (freeSpot) {
            x = freeSpot.x;
            y = freeSpot.y;
        } else {
            widgetData.width = cols;
            widgetData.height = rows;
            return false;
        }
    }

    widgetData.width = cols;
    widgetData.height = rows;
    widgetData.x = x;
    widgetData.y = y;
    return true;
}

export function resolveGridLayout(grid) {
    const { cellSize, cellTotalWidth, cellTotalHeight, gridRows } =
        calculateGridDimensions(grid.width, grid.height, COLUMNS_COUNT);
    return { gridCols: COLUMNS_COUNT, gridRows, cellSize, cellTotalWidth, cellTotalHeight };
}

export function applyGridLayout(grid, layout) {
    grid.cellTotalWidth = layout.cellTotalWidth;
    grid.cellTotalHeight = layout.cellTotalHeight;
    grid._layout = layout;
    grid.gridMargin = GRID_MARGIN_PX;
    grid.gridCols = layout.gridCols;
    grid.gridRows = layout.gridRows;

    grid._syncGridLines();
}

export function layoutWidgetsOnGrid(activeWidgets, gridCols, gridRows, isAlreadyPlaced = () => false) {
    let modified = false;
    const placedWidgets = [];

    // Placement is greedy and never displaces, so whatever is already on the grid is
    // placed first and a newcomer cannot take a cell one of them is sitting in.
    const sortedWidgets = activeWidgets.slice().sort((a, b) => {
        const settledA = isAlreadyPlaced(a) ? 0 : 1;
        const settledB = isAlreadyPlaced(b) ? 0 : 1;
        if (settledA !== settledB)
            return settledA - settledB;
        const posA = ((a.y || 0) * gridCols) + (a.x || 0);
        const posB = ((b.y || 0) * gridCols) + (b.x || 0);
        return posA - posB;
    });

    const unplaced = [];

    sortedWidgets.forEach(widgetData => {
        const before = `${widgetData.x},${widgetData.y},${widgetData.width},${widgetData.height}`;
        const placed = placeInFreeSpot(widgetData, placedWidgets, gridCols, gridRows);
        if (before !== `${widgetData.x},${widgetData.y},${widgetData.width},${widgetData.height}`)
            modified = true;
        if (!placed)
            unplaced.push(widgetData);
        placedWidgets.push(widgetData);
    });

    return { sortedWidgets, modified, unplaced };
}

export function resolveActiveWidgets(grid) {
    const monitorMode = grid.settings.get_string('global-monitor') || 'primary';
    const isEachMode = (monitorMode === 'each');

    const widgets = getWidgets(grid.settings);
    // Hidden icons are filtered out of what is drawn but stay in what is saved:
    // `widgets` is the whole layout and the next write is the whole layout, so
    // dropping them here would delete them and lose their positions.
    const rendered = widgets.filter(widget => isDesktopIconVisible(widget, grid.settings));
    const activeWidgets = getWidgetsForMonitor(rendered, getEffectiveMonitorIndex(grid.targetMonitorIndex, grid.settings), isEachMode);
    return { widgets, activeWidgets };
}

/**
 * Everything sharing a monitor with this widget, minus itself. Drop, resize and preset
 * validation all route through here so they cannot disagree with the layout pass. Pass
 * effectiveMonitorIndex to validate against another monitor during a cross-monitor drop.
 */
export function getOtherWidgets(grid, widgets, widgetId, effectiveMonitorIndex = null) {
    const monitorMode = grid.settings.get_string('global-monitor') || 'primary';
    const isEachMode = (monitorMode === 'each');
    const monitorIndex = effectiveMonitorIndex !== null
        ? effectiveMonitorIndex
        : getEffectiveMonitorIndex(grid.targetMonitorIndex, grid.settings);
    return getWidgetsForMonitor(widgets, monitorIndex, isEachMode)
        .filter(widget => widget.id !== widgetId);
}

export function repositionNode(grid, widgetId, newCols, newRows, newX, newY) {
    const node = grid.widgetNodes.get(widgetId);
    if (!node || isActorDestroyed(node)) return;

    const { width, height, x, y } = gridGeometry(
        newCols, newRows, newX, newY, grid.cellTotalWidth - GRID_GAP_PX,
        grid.cellTotalWidth, grid.cellTotalHeight);
    node.set_size(width, height);
    node.set_position(x, y);
}

/** Safe on an id that is not there. */
export function detachNode(grid, widgetId) {
    const node = grid.widgetNodes.get(widgetId);
    if (node)
        node.destroy();
    grid.widgetNodes.delete(widgetId);
    grid._nodeConfigs.delete(widgetId);
}

/**
 * Saves widget configs and pre-seeds the echo guard, so the settings change this write
 * causes is not mistaken for one that arrived from outside.
 */
export function saveLocalWidgets(grid, widgets) {
    grid._lastAppliedWidgetsJson = serializeWidgets(widgets);
    saveWidgets(grid.settings, widgets);
    // The nodes keep the geometry their next drag starts from.
    grid.widgetNodes.forEach((node, widgetId) => {
        const latest = widgets.find(widget => widget.id === widgetId);
        if (latest && node.widgetData) {
            node.widgetData.x = latest.x;
            node.widgetData.y = latest.y;
            node.widgetData.width = latest.width;
            node.widgetData.height = latest.height;
            node.widgetData.monitor = latest.monitor;
        }
    });
}
