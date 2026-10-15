/**
 * The canvases the grid paints under its widgets: the persistent grid lines, and the edit
 * overlay shown while a widget is being dragged or resized. Also holds the registry of live
 * grids, since the overlay is raised and lowered across all of them at once.
 */
import St from 'gi://St';
import {
    GRID_GAP_PX,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER
} from '../utils/widgetUtils.js';
import { traceRoundedRect } from '../shell/widgetUIUtils.js';

const GRID_CELL_CORNER_RADIUS_PX = 2;

// Module scope, so it is declared once.
const ACTIVE_GRIDS = new Set();

export function registerGrid(grid) {
    ACTIVE_GRIDS.add(grid);
}

export function unregisterGrid(grid) {
    ACTIVE_GRIDS.delete(grid);
}

export function toggleAllGridOverlays(show) {
    ACTIVE_GRIDS.forEach(grid => grid._toggleGridOverlay(show));
}

export function createGridOverlay(gridCols, gridRows, cellTotalWidth, gridMargin, red, green, blue, alpha) {
    const cellSize = cellTotalWidth - GRID_GAP_PX;
    const overlayWidth = gridCols * cellTotalWidth + GRID_GAP_PX;
    const overlayHeight = gridRows * cellTotalWidth + GRID_GAP_PX;

    const canvas = new St.DrawingArea({
        x: gridMargin - GRID_GAP_PX,
        y: gridMargin - GRID_GAP_PX,
        width: overlayWidth,
        height: overlayHeight,
    });

    canvas.connect('repaint', area => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();

        ctx.setOperator(CAIRO_OPERATOR_OVER);
        ctx.setSourceRGBA(red, green, blue, alpha);
        ctx.rectangle(0, 0, w, h);
        ctx.fill();

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const cellX = GRID_GAP_PX + (c * cellTotalWidth);
                const cellY = GRID_GAP_PX + (r * cellTotalWidth);
                traceRoundedRect(ctx, cellX, cellY, cellSize, cellSize, GRID_CELL_CORNER_RADIUS_PX);
                ctx.fill();
            }
        }

        ctx.$dispose();
    });

    canvas.queue_repaint();
    return canvas;
}
