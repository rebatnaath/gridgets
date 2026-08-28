import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, drawSparkline, SPARK_SAMPLE_CAPACITY } from '../../shell/widgetUIUtils.js';
import { networkEngine } from '../../utils/systemMonitorEngine.js';
import { createSparklineTile, createTilesRow, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, TILE_GAP_PX, TILE_MARGIN_PX } from './sparkTile.js';

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const SPARK_BASELINE_BYTES = BYTES_PER_KILOBYTE;

export function formatBytesPerSecond(bytesPerSec) {
    if (bytesPerSec < BYTES_PER_KILOBYTE)
        return `${Math.round(bytesPerSec)} B/s`;
    if (bytesPerSec < BYTES_PER_MEGABYTE)
        return `${(bytesPerSec / BYTES_PER_KILOBYTE).toFixed(1)} KB/s`;
    return `${(bytesPerSec / BYTES_PER_MEGABYTE).toFixed(1)} MB/s`;
}

export function createNetworkSpeedNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(config.globalAccentColor || '#3584e4');
    const textRgb = parseCssColor(textColor);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);

    const drawSpeedSparkline = (context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity) => {
        const peak = Math.max(SPARK_BASELINE_BYTES, ...samples);
        drawSparkline(context, surfaceWidth, surfaceHeight, samples, peak,
            lineColor.r, lineColor.g, lineColor.b, lineOpacity);
    };

    const downloadTile = createSparklineTile({
        labelText: 'Download',
        unitText: 'B/s',
        lineColor: accentRgb,
        lineOpacity: 1.0,
        unitOpacity: SECONDARY_OPACITY,
        fontCss,
        textColor,
        scale,
        rowSpacingPx: 4,
        drawSamples: drawSpeedSparkline,
    });

    const uploadTile = createSparklineTile({
        labelText: 'Upload',
        unitText: 'B/s',
        lineColor: textRgb,
        lineOpacity: SECONDARY_OPACITY,
        unitOpacity: SECONDARY_OPACITY,
        fontCss,
        textColor,
        scale,
        rowSpacingPx: 4,
        drawSamples: drawSpeedSparkline,
    });

    container.add_child(createTilesRow(
        [downloadTile.tile, uploadTile.tile],
        Math.max(1, Math.round(TILE_GAP_PX * scale)),
        Math.max(1, Math.round(TILE_MARGIN_PX * scale))));

    const onDataUpdate = (data) => {
        for (const [tile, bytesPerSec] of [[downloadTile, data.downloadSpeed], [uploadTile, data.uploadSpeed]]) {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            tile.valueLabel.set_text(value);
            tile.unitLabel.set_text(unit);
            tile.samples.push(bytesPerSec);
            if (tile.samples.length > SPARK_SAMPLE_CAPACITY)
                tile.samples.shift();
            tile.sparkArea.queue_repaint();
        }
    };

    const releaseEngine = networkEngine.subscribe(onDataUpdate);
    registerWidgetCleanup(container, releaseEngine);

    return container;
}
