import { drawSparkline, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { networkEngine } from '../../utils/systemMonitorEngine.js';
import { createSparkTileRow, pushSample } from './sparkTile.js';

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
    const drawSpeedSparkline = (context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity) => {
        const peak = Math.max(SPARK_BASELINE_BYTES, ...samples);
        drawSparkline(context, surfaceWidth, surfaceHeight, samples, peak,
            lineColor.r, lineColor.g, lineColor.b, lineOpacity);
    };

    const { container, tiles } = createSparkTileRow({
        config,
        width,
        height,
        xPosition,
        yPosition,
        drawSamples: drawSpeedSparkline,
        tileSpecs: [
            { labelText: 'Download', unitText: 'B/s' },
            { labelText: 'Upload', unitText: 'B/s' },
        ],
    });
    const [downloadTile, uploadTile] = tiles;

    const releaseEngine = networkEngine.subscribe(data => {
        const updates = [
            [downloadTile, data.downloadSpeed],
            [uploadTile, data.uploadSpeed],
        ];

        for (const [tile, bytesPerSec] of updates) {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            tile.valueLabel.set_text(value);
            tile.unitLabel.set_text(unit);
            pushSample(tile, bytesPerSec);
        }
    });
    registerWidgetCleanup(container, releaseEngine);

    return container;
}
