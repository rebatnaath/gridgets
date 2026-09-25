import { drawSparkline, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { cpuRamEngine } from '../../utils/systemMonitorEngine.js';
import { createSparkTileRow, pushSample } from './sparkTile.js';

const PERCENTAGE_MAX = 100;

export function createCpuRamNode(config, width, height, xPosition, yPosition) {
    const drawPercentSparkline = (context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity) => {
        drawSparkline(context, surfaceWidth, surfaceHeight, samples, PERCENTAGE_MAX,
            lineColor.r, lineColor.g, lineColor.b, lineOpacity);
    };

    const { container, tiles } = createSparkTileRow({
        config,
        width,
        height,
        xPosition,
        yPosition,
        drawSamples: drawPercentSparkline,
        tileSpecs: [
            { labelText: 'CPU', unitText: '%' },
            { labelText: 'Memory', unitText: '%' },
        ],
    });
    const [cpuTile, memoryTile] = tiles;

    const releaseEngine = cpuRamEngine.subscribe(data => {
        const updates = [
            [cpuTile, data.cpuProgress],
            [memoryTile, data.ramProgress],
        ];

        for (const [tile, progress] of updates) {
            const percentage = Math.round(progress * PERCENTAGE_MAX);
            tile.valueLabel.set_text(String(percentage));
            pushSample(tile, percentage);
        }
    });
    registerWidgetCleanup(container, releaseEngine);

    return container;
}
