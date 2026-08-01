import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createAnimatedGifNode } from './gif.js';
import { listImagesInFolder, attachCaptionOverlay } from './mediaCommon.js';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetFontFamily, buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { connectTimerCleanup } from '../../utils/widgetUIUtils.js';

const DEFAULT_SLIDE_INTERVAL_SECONDS = 10;
const MILLISECONDS_PER_SECOND = 1000;
const CROSSFADE_DURATION_MS = 800;
const CLUTTER_OPACITY_OPAQUE = 255;
const CLUTTER_OPACITY_TRANSPARENT = 0;
function createImageLayer(imagePath, borderRadius, width, height, animateGif) {
    if (imagePath.toLowerCase().endsWith('.gif')) {
        const gifWidget = createAnimatedGifNode({
            imagePath: imagePath,
            appliedBorderRadius: borderRadius,
            appliedBorderWidth: 0,
            appliedBorderColor: 'transparent'
        }, width, height, 0, 0, animateGif);

        gifWidget.x_expand = true;
        gifWidget.y_expand = true;
        gifWidget.x_align = Clutter.ActorAlign.FILL;
        gifWidget.y_align = Clutter.ActorAlign.FILL;
        gifWidget.opacity = CLUTTER_OPACITY_OPAQUE;
        return gifWidget;
    }

    return new St.Widget({
        style: `
            background-image: url("file://${imagePath}");
            background-size: cover;
            border-radius: ${borderRadius}px;
        `,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        opacity: CLUTTER_OPACITY_OPAQUE,
    });
}

export function createSlideshowNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const slideInterval = (widgetData.intervalSeconds || widgetData.slideIntervalSeconds || DEFAULT_SLIDE_INTERVAL_SECONDS) * MILLISECONDS_PER_SECOND;
    const folderPath = widgetData.slideshowFolder || '';
    const backgroundColor = resolveWidgetBackgroundColor(widgetData);

    const container = new St.Widget({
        style: `background-color: ${backgroundColor}; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);

    const state = {
        timerId: null,
    };

    const images = listImagesInFolder(folderPath);

    if (images.length === 0) {
        const fontFamily = resolveWidgetFontFamily(widgetData);
        const textColor = resolveWidgetForegroundColor(widgetData);
        const emptyLabel = new St.Label({
            text: 'No images found in folder',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 14px; opacity: 0.6;`,
        });
        container.add_child(emptyLabel);
        return container;
    }

    const imageContainer = new St.Widget({
        x_expand: true,
        y_expand: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.add_child(imageContainer);

    const shouldAnimateGif = widgetData.animateGif !== undefined ? widgetData.animateGif : (widgetData.globalAnimateGif !== false);

    let currentIndex = 0;
    let currentLayer = createImageLayer(images[0], borderRadius, width, height, shouldAnimateGif);
    imageContainer.add_child(currentLayer);

    const advanceSlide = () => {
        if (container.isDestroyed || images.length <= 1) return;

        currentIndex = (currentIndex + 1) % images.length;
        const nextImage = images[currentIndex];

        const incomingLayer = createImageLayer(nextImage, borderRadius, width, height, shouldAnimateGif);
        incomingLayer.set_opacity(CLUTTER_OPACITY_TRANSPARENT);
        imageContainer.add_child(incomingLayer);

        const outgoingLayer = currentLayer;
        currentLayer = incomingLayer;

        incomingLayer.ease({
            opacity: CLUTTER_OPACITY_OPAQUE,
            duration: CROSSFADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });

        outgoingLayer.ease({
            opacity: CLUTTER_OPACITY_TRANSPARENT,
            duration: CROSSFADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (outgoingLayer && !outgoingLayer.isDestroyed)
                    outgoingLayer.destroy();
            }
        });
    };

    const validInterval = Math.max(1000, Math.floor(slideInterval));
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validInterval, () => {
        if (container.isDestroyed) return GLib.SOURCE_REMOVE;
        advanceSlide();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);
    attachCaptionOverlay(container, widgetData, width, height);

    return container;
}
