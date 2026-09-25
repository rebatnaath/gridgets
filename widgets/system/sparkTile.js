import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    resolveChildCornerRadius,
    resolveExplicitFontFamily,
    resolveWidgetForegroundColor,
    resolveWidgetSurfaces,
    resolveAccentColor,
    parseCssColor,
    DEFAULT_CHILD_CORNER_RADIUS_PX,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, SPARK_SAMPLE_CAPACITY } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';

const BASE_CONTAINER_WIDTH = 260;
const BASE_CONTAINER_HEIGHT = 130;
const TILE_GAP_PX = 10;
const TILE_MARGIN_PX = 10;

const VALUE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.displayLG;
const VALUE_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.extrabold;
const LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const LABEL_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.medium;
const UNIT_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const TILE_PADDING_BASE_PX = 13;
const TILE_RADIUS_BASE_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const UNIT_FONT_SIZE_RATIO = 0.45;
const SPARK_LINE_OPACITY = 1.0;

// Reusable sparkline tile used by both CPU/RAM and network-speed widgets.
function createSparklineTile({
    labelText,
    unitText,
    lineColor,
    lineOpacity,
    unitOpacity,
    fontCss,
    textColor,
    cardColor,
    scale,
    rowSpacingPx = 3,
    drawSamples,
}) {
    const tilePadding = Math.max(1, Math.round(TILE_PADDING_BASE_PX * scale));
    const tileRadius = resolveChildCornerRadius(TILE_RADIUS_BASE_PX, scale);
    const valueFontSize = scaleFontSize(VALUE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary);
    const labelFontSize = scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label);

    const tile = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${cardColor};`
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
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: ${VALUE_FONT_WEIGHT};`,
    });
    const unitLabel = new St.Label({
        text: unitText,
        style: `${fontCss}color: ${textColor}; opacity: ${unitOpacity}; `
            + `font-size: ${scaleFontSize(VALUE_FONT_SIZE_PX * UNIT_FONT_SIZE_RATIO, scale, MIN_FONT_SIZE.metadata)}px; font-weight: ${UNIT_FONT_WEIGHT};`,
    });
    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);

    const nameLabel = new St.Label({
        text: labelText,
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; font-weight: ${LABEL_FONT_WEIGHT}; opacity: ${unitOpacity};`,
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

function createTilesRow(tiles, gapPx, marginPx) {
    const tilesBox = new St.Widget({
        layout_manager: new Clutter.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            spacing: gapPx,
        }),
        x_expand: true,
        y_expand: true,
        style: `margin: ${marginPx}px;`,
    });
    for (const tileActor of tiles)
        tilesBox.add_child(tileActor);
    return tilesBox;
}

// Appends a sample, trims to capacity and repaints. Shared by both widgets so
// the retention behaviour cannot drift apart.
export function pushSample(tile, value) {
    tile.samples.push(value);
    if (tile.samples.length > SPARK_SAMPLE_CAPACITY)
        tile.samples.shift();
    tile.sparkArea.queue_repaint();
}

// Builds the shared container plus a row of identically configured tiles.
// CPU/RAM and network-speed differ only in their labels, units and how they
// sample and format values, so all of that stays with the caller.
export function createSparkTileRow({ config, width, height, xPosition, yPosition, tileSpecs, drawSamples }) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(resolveAccentColor(config));
    const { card } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);

    const tiles = tileSpecs.map(spec => createSparklineTile({
        lineColor: accentRgb,
        lineOpacity: SPARK_LINE_OPACITY,
        unitOpacity: TEXT_OPACITY.secondary,
        fontCss,
        textColor,
        cardColor: card,
        scale,
        drawSamples,
        ...spec,
    }));

    container.add_child(createTilesRow(
        tiles.map(tile => tile.tile),
        Math.max(1, Math.round(TILE_GAP_PX * scale)),
        Math.max(1, Math.round(TILE_MARGIN_PX * scale))));

    return { container, tiles };
}
