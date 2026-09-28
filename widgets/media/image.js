import Clutter from 'gi://Clutter';
import { buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { WidgetActor } from '../../shell/widgetUIUtils.js';
import { attachCaptionOverlay, backgroundImageStyle } from './mediaCommon.js';

export function createStaticImageNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const widgetStyle = backgroundImageStyle(widgetData.imagePath, baseStyle);

    const widgetNode = new WidgetActor({
        style: widgetStyle,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });

    widgetNode.set_clip_to_allocation(true);
    attachCaptionOverlay(widgetNode, widgetData, width, height, false, widgetData.imagePath);

    return widgetNode;
}
