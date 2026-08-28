import St from 'gi://St';
import {
    GRID_GAP_PX,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER
} from '../utils/widgetUtils.js';

export function drawRoundedRect(ctx, x, y, w, h, r) {
    const deg = Math.PI / 180;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -90 * deg, 0 * deg);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0 * deg, 90 * deg);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, 90 * deg, 180 * deg);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, 180 * deg, -90 * deg);
    ctx.closePath();
}

export function createGridOverlay(gridCols, gridRows, cellTotalWidth, gridMargin, red, green, blue, alpha) {
    const step = cellTotalWidth;
    const cellSize = step - GRID_GAP_PX;
    const overlayWidth = gridCols * step + GRID_GAP_PX;
    const overlayHeight = gridRows * step + GRID_GAP_PX;
    const cornerRadius = Math.min(GRID_GAP_PX, cellSize / 2);

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
                const cellX = GRID_GAP_PX + c * step;
                const cellY = GRID_GAP_PX + r * step;
                drawRoundedRect(ctx, cellX, cellY, cellSize, cellSize, cornerRadius);
                ctx.fill();
            }
        }

        ctx.$dispose();
    });

    canvas.queue_repaint();
    return canvas;
}
