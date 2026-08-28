import { createDigitalTimeNode } from './timeDigital.js';
import { createWorldTimeNode } from './timeWorld.js';

export { createDigitalTimeNode } from './timeDigital.js';
export { createWorldTimeNode } from './timeWorld.js';

export function createTimeNode(widgetData, width, height, xPosition, yPosition) {
    if (widgetData.layout === 'world' || widgetData.type === 'worldClock') {
        return createWorldTimeNode(widgetData, width, height, xPosition, yPosition);
    }
    return createDigitalTimeNode(widgetData, width, height, xPosition, yPosition);
}
