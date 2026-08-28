import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';
import { createCaptionOverlay } from '../../shell/widgetUIUtils.js';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'];

export const ASPECT_RATIO_TOLERANCE = 0.01;

export const GIF_FRAME_INTERVAL_MS = 20;

/** First GNOME Shell release where St.ImageContent.set_bytes() takes a CoglContext. */
const SET_BYTES_COGL_CONTEXT_SHELL_VERSION = 48;

const RGBA_CHANNELS_COUNT = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const PIXEL_CENTER_OFFSET = 0.5;

export function isSupportedImage(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Applies raw RGBA pixels to an St.ImageContent. set_bytes() gained a
 * leading CoglContext parameter in GNOME Shell 48; the extension supports
 * 45+, so both signatures are handled here in one place.
 */
export function setImageContentBytes(imageContent, bytes, pixelFormat, width, height, rowStride) {
    if (Number(PACKAGE_VERSION.split('.')[0]) >= SET_BYTES_COGL_CONTEXT_SHELL_VERSION) {
        const coglContext = global.stage.context.get_backend().get_cogl_context();
        imageContent.set_bytes(coglContext, bytes, pixelFormat, width, height, rowStride);
    } else {
        imageContent.set_bytes(bytes, pixelFormat, width, height, rowStride);
    }
}

// Enumerates supported image files in a folder asynchronously.
export async function listImagesInFolder(folderPath) {
    if (!folderPath) return [];
    const dir = Gio.File.new_for_path(folderPath);

    let enumerator;
    try {
        enumerator = await new Promise((resolve, reject) => {
            dir.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
                (_source, result) => {
                    try {
                        resolve(dir.enumerate_children_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    } catch (e) {
        console.error('Error listing images in slideshow folder:', e);
        return [];
    }

    const images = [];
    const PAGE_SIZE = 64;
    try {
        while (true) {
            const infos = await new Promise((resolve, reject) => {
                enumerator.next_files_async(PAGE_SIZE, GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                    try {
                        resolve(enumerator.next_files_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            if (!infos || infos.length === 0) break;
            for (const fileInfo of infos) {
                if (fileInfo.get_file_type() === Gio.FileType.REGULAR && isSupportedImage(fileInfo.get_name()))
                    images.push(dir.get_child(fileInfo.get_name()).get_path());
            }
        }
    } catch (e) {
        console.error('Error listing images in slideshow folder:', e);
    }

    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, null);
    images.sort();
    return images;
}

function isCaptionVisible(widgetData) {
    if (widgetData.showCaption !== undefined)
        return widgetData.showCaption;

    const isSlideshow = widgetData.type === 'slideshow';
    return isSlideshow
        ? (widgetData.globalSlideshowShowCaption !== false)
        : (widgetData.globalImageShowCaption !== false);
}

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

function maskCornerQuadrant(pixels, radius, rowstride, startX, startY, originX, originY, radiusSquared, width, height) {
    for (let y = startY; y < startY + radius; y++) {
        if (y < 0 || y >= height) continue;
        for (let x = startX; x < startX + radius; x++) {
            if (x < 0 || x >= width) continue;
            const deltaX = x - originX;
            const deltaY = y - originY;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * RGBA_CHANNELS_COUNT + ALPHA_CHANNEL_OFFSET] = 0;
            }
        }
    }
}

export function applyCornerMask(pixels, width, height, radius, rowstride) {
    if (radius <= 0) return;
    const clampedRadius = Math.min(radius, Math.floor(Math.min(width, height) / 2));
    const radiusSquared = clampedRadius * clampedRadius;

    // Top-left
    maskCornerQuadrant(pixels, clampedRadius, rowstride, 0, 0,
        clampedRadius - PIXEL_CENTER_OFFSET, clampedRadius - PIXEL_CENTER_OFFSET, radiusSquared, width, height);
    // Top-right
    maskCornerQuadrant(pixels, clampedRadius, rowstride, width - clampedRadius, 0,
        width - clampedRadius - PIXEL_CENTER_OFFSET, clampedRadius - PIXEL_CENTER_OFFSET, radiusSquared, width, height);
    // Bottom-left
    maskCornerQuadrant(pixels, clampedRadius, rowstride, 0, height - clampedRadius,
        clampedRadius - PIXEL_CENTER_OFFSET, height - clampedRadius - PIXEL_CENTER_OFFSET, radiusSquared, width, height);
    // Bottom-right
    maskCornerQuadrant(pixels, clampedRadius, rowstride, width - clampedRadius, height - clampedRadius,
        width - clampedRadius - PIXEL_CENTER_OFFSET, height - clampedRadius - PIXEL_CENTER_OFFSET, radiusSquared, width, height);
}
