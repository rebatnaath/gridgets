/**
 * ============================================================================
 * STATIC IMAGE & COLOR BLOCK WIDGET 
 * 
 * This module provides simple rendering for static images and solid color
 * blocks on the desktop grid. It supports captions, custom scaling, and
 * standard corner rounding.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { buildBaseWidgetStyle } from './widgetUtils.js';
import { createCaptionOverlay } from './widgetUIUtils.js';

export function createStaticImageNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const widgetStyle = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; background-position: center; ${baseStyle}`;

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

    const showText = widgetData.appliedShowText !== false;
    const caption = widgetData.caption || '';

    if (showText && caption.length > 0) {
        widgetNode.add_child(createCaptionOverlay(widgetData, caption));
    }

    return widgetNode;
}

export function createColorBlockNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const widgetStyle = `background-color: rgba(0, 255, 0, 0.4); ${baseStyle}`;

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
