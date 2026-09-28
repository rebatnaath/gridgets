import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createCaptionOverlay, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { addSettleAfterResize } from '../../utils/resizeSettle.js';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'];

export const ASPECT_RATIO_TOLERANCE = 0.01;

export const GIF_FRAME_INTERVAL_MS = 20;

const FILE_ENUM_BATCH_SIZE = 64;

// Wider than the shared widget range, which stops responding well before a picture
// widget reaches the size it is often dragged to.
const MIN_CAPTION_SCALE = 0.35;
const MAX_CAPTION_SCALE = 3.5;

/** Shared by the static widget and the animated one's fallback, so a change to one cannot miss the other. */
export function backgroundImageStyle(imagePath, baseStyle) {
    return `background-image: url("file://${imagePath}"); background-size: cover; ${baseStyle}`;
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The picture's own date, as a caption.
 *
 * The file's modified time, not EXIF: a photo copied out of a camera album usually
 * keeps the time it was written rather than when it was taken. Returns '' when the file
 * cannot be read, since a missing date is not a failure worth reporting.
 */
export function imageDateCaption(imagePath) {
    if (!imagePath)
        return '';
    try {
        const info = Gio.File.new_for_path(imagePath).query_info(
            Gio.FILE_ATTRIBUTE_TIME_MODIFIED, Gio.FileQueryInfoFlags.NONE, null);
        const modifiedSeconds = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED);
        if (modifiedSeconds === 0)
            return '';
        const date = GLib.DateTime.new_from_unix_local(modifiedSeconds);
        if (!date)
            return '';
        return `${date.get_day_of_month()} ${MONTH_NAMES_SHORT[date.get_month() - 1]}, ${date.get_year()}`;
    } catch {
        return '';
    }
}

function isSupportedImageFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension));
}

export async function listImagesInFolder(folderPath) {
    if (!folderPath) return [];
    const dir = Gio.File.new_for_path(folderPath);

    // Gio's async calls all follow the same shape: a callback that either throws on
    // finish or yields a value. Wrapping that once here keeps the loop below readable.
    const promisify = (start, finish) => new Promise((resolve, reject) => {
        start((_source, result) => {
            try {
                resolve(finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });

    let enumerator;
    try {
        enumerator = await promisify(
            callback => dir.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, callback),
            result => dir.enumerate_children_finish(result));
    } catch (error) {
        console.error('Error listing images in slideshow folder:', error);
        return [];
    }

    const images = [];
    try {
        while (true) {
            const infos = await promisify(
                callback => enumerator.next_files_async(
                    FILE_ENUM_BATCH_SIZE, GLib.PRIORITY_DEFAULT, null, callback),
                result => enumerator.next_files_finish(result));
            if (!infos || infos.length === 0) break;
            for (const fileInfo of infos) {
                if (fileInfo.get_file_type() === Gio.FileType.REGULAR && isSupportedImageFile(fileInfo.get_name()))
                    images.push(dir.get_child(fileInfo.get_name()).get_path());
            }
        }
    } catch (error) {
        console.error('Error listing images in slideshow folder:', error);
    }

    enumerator.close_async(GLib.PRIORITY_DEFAULT, null, null);
    images.sort();
    return images;
}

function isCaptionVisible(widgetData) {
    const isSlideshow = widgetData.type === 'slideshow';
    const globalVisible = isSlideshow
        ? (widgetData.globalSlideshowShowCaption !== false)
        : (widgetData.globalImageShowCaption !== false);

    if (widgetData.captionFollowGlobal === true)
        return globalVisible;
    if (widgetData.showCaption !== undefined)
        return widgetData.showCaption;
    return globalVisible;
}

/**
 * The caption to show, or '' for none.
 *
 * `override` exists for a slideshow whose first picture has no readable date but whose
 * later ones do: without it no overlay is built, and those later dates have nowhere to go.
 */
function resolveCaptionText(widgetData, imagePath, override) {
    // Visibility first, so an override cannot bring back a caption that is switched off.
    if (!isCaptionVisible(widgetData))
        return '';
    if (override !== undefined && override !== null)
        return override;
    if (widgetData.useDateCaption === true)
        return imageDateCaption(imagePath);
    return widgetData.caption || '';
}

/** Attaches the caption overlay, or returns null when there is no caption to show. */
export function attachCaptionOverlay(widgetNode, widgetData, width, height, isWrappedContainer = false, imagePath = null, captionOverride = null) {
    const caption = resolveCaptionText(widgetData, imagePath, captionOverride);
    if (caption.length === 0) return null;

    const overlay = createCaptionOverlay(widgetData, caption);
    // Derived from the widget's width rather than stored, so it survives a reload. A
    // reference of the size the widget was created at is 1 at rest, which dropped a
    // caption back to its base size on every load.
    const CAPTION_REFERENCE_WIDTH_PX = 320;
    const updateCaptionScale = () => {
        if (isActorDestroyed(overlay)) return;
        // Held still during a resize drag, which calls set_size on every motion event.
        if (widgetNode.isResizing) return;
        // Width only: the height would tie the font to the widget's aspect ratio.
        const currentWidth = widgetNode.width || width;
        const ratio = currentWidth / CAPTION_REFERENCE_WIDTH_PX;
        // Math.max(NaN, min) is still NaN, and St drops a "font-size: NaNpx".
        if (!Number.isFinite(ratio)) return;
        overlay.updateCaptionScale(Math.min(Math.max(ratio, MIN_CAPTION_SCALE), MAX_CAPTION_SCALE));
    };

    let textOverlay = null;
    if (isWrappedContainer) {
        textOverlay = new St.Widget({
            width: width,
            height: height,
            layout_manager: new Clutter.BinLayout(),
        });
        textOverlay.add_child(overlay);
        widgetNode.add_child(textOverlay);

        // The wrapper and the text inside it move together, so both wait for the drag.
        const widthSignalId = widgetNode.connect('notify::width', () => {
            if (widgetNode.isResizing) return;
            textOverlay.set_width(widgetNode.width);
            updateCaptionScale();
        });
        const heightSignalId = widgetNode.connect('notify::height', () => {
            if (widgetNode.isResizing) return;
            textOverlay.set_height(widgetNode.height);
            updateCaptionScale();
        });
        registerWidgetCleanup(widgetNode, () => {
            widgetNode.disconnect(widthSignalId);
            widgetNode.disconnect(heightSignalId);
        });
    } else {
        widgetNode.add_child(overlay);
        const widthSignalId = widgetNode.connect('notify::width', updateCaptionScale);
        const heightSignalId = widgetNode.connect('notify::height', updateCaptionScale);
        registerWidgetCleanup(widgetNode, () => {
            widgetNode.disconnect(widthSignalId);
            widgetNode.disconnect(heightSignalId);
        });
    }

    // Sizes are cell-quantised during a drag, so releasing on a boundary sets the size
    // to the value it already had and notify::width never fires, leaving the caption on
    // its pre-drag scale.
    addSettleAfterResize(widgetNode, () => {
        if (textOverlay) {
            if (isActorDestroyed(textOverlay)) return;
            textOverlay.set_size(widgetNode.width, widgetNode.height);
        }
        updateCaptionScale();
    });

    return {
        setCaption(text) {
            if (isActorDestroyed(overlay)) return;
            overlay.setCaptionText(text);
        },
    };
}