import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { cssColorToRgba } from '../../utils/widgetUtils.js';

export const BASE_CONTAINER_WIDTH = 260;
export const BASE_CONTAINER_HEIGHT = 130;
export const TILE_GAP_PX = 10;
export const TILE_MARGIN_PX = 10;

const VALUE_FONT_SIZE_PX = 30;
const LABEL_FONT_SIZE_PX = 10;
const TILE_PADDING_BASE_PX = 13;
const TILE_RADIUS_BASE_PX = 10;
const TILE_BG_ALPHA = 0.06;
const TILE_BORDER_ALPHA = 0.08;
const UNIT_FONT_SIZE_RATIO = 0.45;

// Reusable sparkline tile used by both CPU/RAM and network-speed widgets.
export function createSparklineTile({
    labelText,
    unitText,
    lineColor,
    lineOpacity,
    unitOpacity,
    fontCss,
    textColor,
    scale,
    rowSpacingPx = 3,
    drawSamples,
}) {
    const tilePadding = Math.max(1, Math.round(TILE_PADDING_BASE_PX * scale));
    const tileRadius = Math.max(1, Math.round(TILE_RADIUS_BASE_PX * scale));
    const valueFontSize = Math.max(1, Math.round(VALUE_FONT_SIZE_PX * scale));
    const labelFontSize = Math.max(1, Math.round(LABEL_FONT_SIZE_PX * scale));

    const tile = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${cssColorToRgba(textColor, TILE_BG_ALPHA)};`
            + `border: 1px solid ${cssColorToRgba(textColor, TILE_BORDER_ALPHA)};`
            + `border-radius: ${tileRadius}px;`
            + `padding: ${tilePadding}px;`,
        style_class: 'spacing',
    });

    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        style: `spacing: ${rowSpacingPx}px;`,
    });
    const valueLabel = new St.Label({
        text: '0',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 300;`,
    });
    const unitLabel = new St.Label({
        text: unitText,
        style: `${fontCss}color: ${textColor}; opacity: ${unitOpacity}; `
            + `font-size: ${Math.max(1, Math.round(valueFontSize * UNIT_FONT_SIZE_RATIO))}px; font-weight: 300;`,
    });
    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);

    const nameLabel = new St.Label({
        text: labelText,
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${unitOpacity};`,
    });

    const sparkArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
    });

    tile.add_child(valueRow);
    tile.add_child(nameLabel);
    tile.add_child(sparkArea);

    const samples = [];

    sparkArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawSamples(context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity);
        context.$dispose();
    });

    return { tile, valueLabel, unitLabel, sparkArea, samples };
}

export function createTilesRow(tiles, gapPx, marginPx) {
    const tilesBox = new St.Widget({
        layout_manager: new Clutter.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            spacing: gapPx,
        }),
        x_expand: true,
        y_expand: true,
        style: `margin: ${marginPx}px;`,
    });
    for (const child of tiles)
        tilesBox.add_child(child);
    return tilesBox;
}
