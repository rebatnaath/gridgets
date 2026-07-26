/**
 * ============================================================================
 * MEDIA WIDGET COMMON UTILITIES
 * 
 * Shared utilities for Image, GIF, and Slideshow widgets.
 * ============================================================================
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { createCaptionOverlay } from '../../utils/widgetUIUtils.js';

/** Supported image extensions */
export const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'];

/** Aspect ratio comparison tolerance */
export const ASPECT_RATIO_TOLERANCE = 0.01;

/** Default animation frame interval for GIF playback */
export const GIF_FRAME_INTERVAL_MS = 20;

/** Pixel buffer channel metric constants */
const RGBA_CHANNELS_COUNT = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const PIXEL_CENTER_OFFSET = 0.5;

/** Checks if a filename has a supported image extension. */
export function isSupportedImage(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/** Enumerates all supported image files in a folder. */
export function listImagesInFolder(folderPath) {
    try {
        if (!folderPath) return [];
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
    } catch (e) {
        console.error('Error listing images in slideshow folder:', e);
        return [];
    }
}

/** Resolves caption visibility based on widget override or global GSettings. */
function isCaptionVisible(widgetData) {
    if (widgetData.showText !== undefined) return widgetData.showText;
    if (widgetData.showCaption !== undefined) return widgetData.showCaption;
    const isSlideshow = widgetData.type === 'slideshow';
    return isSlideshow ? (widgetData.globalSlideshowShowCaption !== false) : (widgetData.globalImageShowCaption !== false);
}

/** Attaches a caption overlay to a media widget container node. */
export function attachCaptionOverlay(widgetNode, widgetData, width, height, isWrappedContainer = false) {
    const caption = widgetData.caption || '';
    if (!isCaptionVisible(widgetData) || caption.length === 0) return;

    const overlay = createCaptionOverlay(widgetData, caption);

    if (isWrappedContainer) {
        const textOverlay = new St.Widget({
            width: width,
            height: height,
            layout_manager: new Clutter.BinLayout(),
        });
        textOverlay.add_child(overlay);
        widgetNode.add_child(textOverlay);

        widgetNode.connect('notify::width', () => textOverlay.set_width(widgetNode.width));
        widgetNode.connect('notify::height', () => textOverlay.set_height(widgetNode.height));
    } else {
        widgetNode.add_child(overlay);
    }
}

/** Helper to mask a single corner quadrant of an RGBA pixel buffer. */
function maskCornerQuadrant(pixels, radius, rowstride, startX, startY, originX, originY, radiusSquared) {
    for (let y = startY; y < startY + radius; y++) {
        for (let x = startX; x < startX + radius; x++) {
            const deltaX = x - originX;
            const deltaY = y - originY;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * RGBA_CHANNELS_COUNT + ALPHA_CHANNEL_OFFSET] = 0;
            }
        }
    }
}

/** Applies a rounded corner alpha mask to RGBA pixel buffer data. */
export function applyCornerMask(pixels, width, height, radius, rowstride) {
    if (radius <= 0) return;
    const radiusSquared = radius * radius;

    // Top-left
    maskCornerQuadrant(pixels, radius, rowstride, 0, 0, radius - PIXEL_CENTER_OFFSET, radius - PIXEL_CENTER_OFFSET, radiusSquared);
    // Top-right
    maskCornerQuadrant(pixels, radius, rowstride, width - radius, 0, width - radius - PIXEL_CENTER_OFFSET, radius - PIXEL_CENTER_OFFSET, radiusSquared);
    // Bottom-left
    maskCornerQuadrant(pixels, radius, rowstride, 0, height - radius, radius - PIXEL_CENTER_OFFSET, height - radius - PIXEL_CENTER_OFFSET, radiusSquared);
    // Bottom-right
    maskCornerQuadrant(pixels, radius, rowstride, width - radius, height - radius, width - radius - PIXEL_CENTER_OFFSET, height - radius - PIXEL_CENTER_OFFSET, radiusSquared);
}
