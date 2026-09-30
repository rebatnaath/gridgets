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
import { createWidgetContainer, SPARK_SAMPLE_CAPACITY, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';

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
    const tile = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style_class: 'spacing',
    });

    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        style: `spacing: ${rowSpacingPx}px;`,
    });
    const valueLabel = new St.Label({ text: '0' });
    const unitLabel = new St.Label({ text: unitText });
    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);

    const nameLabel = new St.Label({ text: labelText });

    const sparkArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
    });

    tile.add_child(valueRow);
    tile.add_child(nameLabel);
    tile.add_child(sparkArea);

    // Every dimension derives from the widget's scale, so a resize restyles the tile here.
    const applyScale = (newScale) => {
        const tilePadding = scaleFontSize(TILE_PADDING_BASE_PX, newScale);
        const tileRadius = resolveChildCornerRadius(TILE_RADIUS_BASE_PX, newScale);
        const valueFontSize = scaleFontSize(VALUE_FONT_SIZE_PX, newScale, MIN_FONT_SIZE.primary);
        const unitFontSize = scaleFontSize(VALUE_FONT_SIZE_PX * UNIT_FONT_SIZE_RATIO, newScale, MIN_FONT_SIZE.metadata);
        const labelFontSize = scaleFontSize(LABEL_FONT_SIZE_PX, newScale, MIN_FONT_SIZE.label);

        tile.style = `background-color: ${cardColor};`
            + `border-radius: ${tileRadius}px;`
            + `padding: ${tilePadding}px;`;
        valueLabel.style = `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: ${VALUE_FONT_WEIGHT};`;
        unitLabel.style = `${fontCss}color: ${textColor}; opacity: ${unitOpacity}; `
            + `font-size: ${unitFontSize}px; font-weight: ${UNIT_FONT_WEIGHT};`;
        nameLabel.style = `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; font-weight: ${LABEL_FONT_WEIGHT}; opacity: ${unitOpacity};`;
    };
    applyScale(scale);

    const samples = [];

    sparkArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawSamples(context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity);
        context.$dispose();
    });

    return { tile, valueLabel, unitLabel, sparkArea, samples, applyScale };
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

export function pushSample(tile, value) {
    tile.samples.push(value);
    if (tile.samples.length > SPARK_SAMPLE_CAPACITY)
        tile.samples.shift();
    tile.sparkArea.queue_repaint();
}

// CPU/RAM and network-speed differ only in their labels, units and how they sample
// and format values, so all of that stays with the caller.
export function createSparkTileRow({ config, width, height, xPosition, yPosition, tileSpecs, drawSamples }) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(resolveAccentColor(config));
    const { card } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const scale = clampWidgetScale(Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

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

    const tilesBox = createTilesRow(
        tiles.map(tile => tile.tile),
        scaleFontSize(TILE_GAP_PX, scale),
        scaleFontSize(TILE_MARGIN_PX, scale));
    container.add_child(tilesBox);

    // Without this the padding, corner radius and font sizes stay frozen at construction.
    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (newScale) => {
        for (const tile of tiles)
            tile.applyScale(newScale);
        tilesBox.layout_manager.spacing = scaleFontSize(TILE_GAP_PX, newScale);
        tilesBox.style = `margin: ${scaleFontSize(TILE_MARGIN_PX, newScale)}px;`;
    });

    return { container, tiles };
}
