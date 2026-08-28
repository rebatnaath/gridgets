import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, drawSparkline, SPARK_SAMPLE_CAPACITY } from '../../shell/widgetUIUtils.js';
import { cpuRamEngine } from '../../utils/systemMonitorEngine.js';
import { createSparklineTile, createTilesRow, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, TILE_GAP_PX, TILE_MARGIN_PX } from './sparkTile.js';

const PERCENTAGE_MAX = 100;

export function createCpuRamNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(config.globalAccentColor || '#3584e4');
    const textRgb = parseCssColor(textColor);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);

    const drawPercentSparkline = (context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity) => {
        drawSparkline(context, surfaceWidth, surfaceHeight, samples, PERCENTAGE_MAX,
            lineColor.r, lineColor.g, lineColor.b, lineOpacity);
    };

    const cpuTile = createSparklineTile({
        labelText: 'CPU',
        unitText: '%',
        lineColor: accentRgb,
        lineOpacity: 1.0,
        unitOpacity: SECONDARY_OPACITY,
        fontCss,
        textColor,
        scale,
        drawSamples: drawPercentSparkline,
    });

    const memTile = createSparklineTile({
        labelText: 'Memory',
        unitText: '%',
        lineColor: textRgb,
        lineOpacity: SECONDARY_OPACITY,
        unitOpacity: SECONDARY_OPACITY,
        fontCss,
        textColor,
        scale,
        drawSamples: drawPercentSparkline,
    });

    container.add_child(createTilesRow(
        [cpuTile.tile, memTile.tile],
        Math.max(1, Math.round(TILE_GAP_PX * scale)),
        Math.max(1, Math.round(TILE_MARGIN_PX * scale))));

    const onDataUpdate = (data) => {
        const cpuPct = Math.round(data.cpuProgress * PERCENTAGE_MAX);
        const memPct = Math.round(data.ramProgress * PERCENTAGE_MAX);

        cpuTile.valueLabel.set_text(String(cpuPct));
        memTile.valueLabel.set_text(String(memPct));

        for (const [tile, nextValue] of [[cpuTile, cpuPct], [memTile, memPct]]) {
            tile.samples.push(nextValue);
            if (tile.samples.length > SPARK_SAMPLE_CAPACITY)
                tile.samples.shift();
            tile.sparkArea.queue_repaint();
        }
    };

    const releaseEngine = cpuRamEngine.subscribe(onDataUpdate);
    registerWidgetCleanup(container, releaseEngine);

    return container;
}
