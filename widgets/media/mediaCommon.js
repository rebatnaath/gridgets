import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createCaptionOverlay, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif'];

export const ASPECT_RATIO_TOLERANCE = 0.01;

export const GIF_FRAME_INTERVAL_MS = 20;

const FILE_ENUM_BATCH_SIZE = 64;

function isSupportedImage(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension));
}

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
    try {
        while (true) {
            const infos = await new Promise((resolve, reject) => {
                enumerator.next_files_async(FILE_ENUM_BATCH_SIZE, GLib.PRIORITY_DEFAULT, null, (_source, result) => {
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

export function attachCaptionOverlay(widgetNode, widgetData, width, height, isWrappedContainer = false) {
    const caption = widgetData.caption || '';
    if (!isCaptionVisible(widgetData) || caption.length === 0) return;

    const overlay = createCaptionOverlay(widgetData, caption);
    const updateCaptionScale = () => {
        if (isActorDestroyed(overlay)) return;
        const currentWidth = widgetNode.width || width;
        const currentHeight = widgetNode.height || height;
        overlay.updateCaptionScale(Math.min(currentWidth / width, currentHeight / height));
    };

    if (isWrappedContainer) {
        const textOverlay = new St.Widget({
            width: width,
            height: height,
            layout_manager: new Clutter.BinLayout(),
        });
        textOverlay.add_child(overlay);
        widgetNode.add_child(textOverlay);

        const widthSignalId = widgetNode.connect('notify::width', () => {
            textOverlay.set_width(widgetNode.width);
            updateCaptionScale();
        });
        const heightSignalId = widgetNode.connect('notify::height', () => {
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
}
