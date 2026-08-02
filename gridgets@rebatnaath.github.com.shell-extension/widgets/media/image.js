import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { attachCaptionOverlay } from './mediaCommon.js';

/** Fallback color for color block widget */
const DEFAULT_COLOR_BLOCK_FALLBACK = 'rgba(0, 255, 0, 0.4)';

/** Creates a static image widget node. */
export function createStaticImageNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const widgetStyle = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; ${baseStyle}`;

    const widgetNode = new St.Widget({
        style: widgetStyle,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });

    widgetNode.set_clip_to_allocation(true);
    attachCaptionOverlay(widgetNode, widgetData, width, height);

    return widgetNode;
}

/** Creates a solid color block widget node. */
export function createColorBlockNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const fillColor = widgetData.color || DEFAULT_COLOR_BLOCK_FALLBACK;
    const widgetStyle = `background-color: ${fillColor}; ${baseStyle}`;

    const widgetNode = new St.Widget({
        style: widgetStyle,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
    });

    widgetNode.set_clip_to_allocation(true);
    return widgetNode;
}
