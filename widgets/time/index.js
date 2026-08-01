import { createDigitalTimeNode } from './timeDigital.js';
import { createWorldTimeNode } from './timeWorld.js';

export { createDigitalTimeNode } from './timeDigital.js';
export { createWorldTimeNode } from './timeWorld.js';

/** Routes and constructs a time widget node based on configuration layout. */
export function createTimeNode(widgetData, width, height, xPosition, yPosition, global24h) {
    if (widgetData.layout === 'world' || widgetData.type === 'worldClock') {
        return createWorldTimeNode(widgetData, width, height, xPosition, yPosition, global24h);
    }
    return createDigitalTimeNode(widgetData, width, height, xPosition, yPosition, global24h);
}
