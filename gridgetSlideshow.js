/**
 * ============================================================================
 * IMAGE SLIDESHOW WIDGET
 * 
 * This module cycles through a directory of images at a user-defined interval.
 * It manages transitions, directory reading, and handles invalid image formats.
 * ============================================================================
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createAnimatedGifNode } from './gridgetGif.js';
import { resolveWidgetBackgroundColor, buildBaseWidgetStyle } from './widgetUtils.js';
import { createCaptionOverlay, connectTimerCleanup } from './widgetUIUtils.js';

const DEFAULT_SLIDE_INTERVAL_SECONDS = 10;
const CROSSFADE_DURATION_MS = 800;
const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'];

function isSupportedImage(filename) {
    const lower = filename.toLowerCase();
    return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function listImagesInFolder(folderPath) {
    const dir = Gio.File.new_for_path(folderPath);
    if (!dir.query_exists(null)) return [];

    const enumerator = dir.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE, null
    );

    const images = [];
    let fileInfo;
    while ((fileInfo = enumerator.next_file(null)) !== null) {
        if (fileInfo.get_file_type() === Gio.FileType.REGULAR && isSupportedImage(fileInfo.get_name())) {
            images.push(dir.get_child(fileInfo.get_name()).get_path());
        }
    }

    images.sort();
    return images;
}

function createImageLayer(imagePath, borderRadius, width, height, animateGif) {
    if (imagePath.toLowerCase().endsWith('.gif')) {
        const gifWidget = createAnimatedGifNode({ 
            imagePath: imagePath, 
            appliedBorderRadius: borderRadius,
            appliedBorderWidth: 0,
            appliedBorderColor: 'transparent'
        }, width, height, 0, 0, animateGif);
        
        // Ensure the returned widget behaves identically in layout
        gifWidget.x_expand = true;
        gifWidget.y_expand = true;
        gifWidget.x_align = Clutter.ActorAlign.FILL;
        gifWidget.y_align = Clutter.ActorAlign.FILL;
        gifWidget.opacity = 255;
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
        opacity: 255,
    });
}

export function createSlideshowNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const slideInterval = (widgetData.slideIntervalSeconds || DEFAULT_SLIDE_INTERVAL_SECONDS) * 1000;
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

    const images = listImagesInFolder(folderPath);

    if (images.length === 0) {
        const emptyLabel = new St.Label({
            text: 'No images found',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: 'color: white; font-size: 14px; opacity: 0.6;',
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

    // Single current layer to start
    let currentIndex = 0;
    let currentLayer = createImageLayer(images[0], borderRadius, width, height, widgetData.animateGif !== false);
    imageContainer.add_child(currentLayer);

    const advanceSlide = () => {
        if (images.length <= 1) return;

        currentIndex = (currentIndex + 1) % images.length;
        const nextImage = images[currentIndex];

        const incomingLayer = createImageLayer(nextImage, borderRadius, width, height, widgetData.animateGif !== false);
        incomingLayer.set_opacity(0);
        imageContainer.add_child(incomingLayer);
        
        const outgoingLayer = currentLayer;
        currentLayer = incomingLayer;

        incomingLayer.ease({
            opacity: 255,
            duration: CROSSFADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });

        outgoingLayer.ease({
            opacity: 0,
            duration: CROSSFADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                try {
                    if (outgoingLayer) {
                        outgoingLayer.destroy();
                    }
                } catch (e) {
                    // Ignore if already finalized
                }
            }
        });
    };

    const state = { timerId: null };

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, slideInterval, () => {
        advanceSlide();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);

    const showText = widgetData.appliedShowText !== false;
    const caption = widgetData.caption || '';
    if (showText && caption.length > 0) {
        container.add_child(createCaptionOverlay(widgetData, caption));
    }

    return container;
}

