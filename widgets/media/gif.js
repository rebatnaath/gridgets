import St from 'gi://St';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import { buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { WidgetActor, connectTimerCleanup, scheduleDeferredUpdate } from '../../shell/widgetUIUtils.js';
import { ASPECT_RATIO_TOLERANCE, GIF_FRAME_INTERVAL_MS, applyCornerMask, attachCaptionOverlay, setImageContentBytes } from './mediaCommon.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';

const RESIZE_REPAINT_THROTTLE_MS = 16;

const MAX_CONSECUTIVE_FRAME_FAILURES = 10;

export function createAnimatedImageNode(widgetData, width, height, xPosition, yPosition, animateGif = true) {
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const baseStyle = buildBaseWidgetStyle(widgetData);

    const widgetNode = new WidgetActor({
        style: `background-color: transparent; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
    });

    widgetNode.set_clip_to_allocation(true);
    watchActorLifecycle(widgetNode);
    const state = {
        timerId: null,
    };

    const applyStaticFallback = () => {
        widgetNode.style = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; ${baseStyle}`;
    };

    const startAnimation = (animation) => {
        if (animation.is_static_image()) {
            applyStaticFallback();
            return;
        }

        const iter = animation.get_iter(null);
        const imageActor = new St.Widget();
        // The caption overlay is attached before the async load finishes;
        // keep frames below it so the caption is never covered.
        widgetNode.insert_child_at_index(imageActor, 0);

        const updateImage = (pixbuf) => {
            if (isActorDestroyed(widgetNode) || !pixbuf) return;
            let renderPixbuf = pixbuf;
            const containerWidth = widgetNode.width;
            const containerHeight = widgetNode.height;

            if (containerWidth > 0 && containerHeight > 0) {
                const imageWidth = pixbuf.get_width();
                const imageHeight = pixbuf.get_height();
                const imageAspect = imageWidth / imageHeight;
                const containerAspect = containerWidth / containerHeight;

                if (Math.abs(imageAspect - containerAspect) > ASPECT_RATIO_TOLERANCE) {
                    let cropWidth, cropHeight, cropX, cropY;
                    if (imageAspect > containerAspect) {
                        cropHeight = imageHeight;
                        cropWidth = Math.floor(cropHeight * containerAspect);
                        cropX = Math.floor((imageWidth - cropWidth) / 2);
                        cropY = 0;
                    } else {
                        cropWidth = imageWidth;
                        cropHeight = Math.floor(cropWidth / containerAspect);
                        cropX = 0;
                        cropY = Math.floor((imageHeight - cropHeight) / 2);
                    }

                    if (cropWidth > 0 && cropHeight > 0 && cropX >= 0 && cropY >= 0) {
                        renderPixbuf = pixbuf.new_subpixbuf(cropX, cropY, cropWidth, cropHeight);
                    }
                }

                imageActor.set_size(containerWidth, containerHeight);
                imageActor.set_position(0, 0);
            }

            if (!renderPixbuf.get_has_alpha()) {
                renderPixbuf = renderPixbuf.add_alpha(false, 0, 0, 0);
            }

            const format = Cogl.PixelFormat.RGBA_8888;
            const pixels = renderPixbuf.get_pixels();

            let textureRadius = 0;
            if (containerWidth > 0) {
                const scaleX = renderPixbuf.get_width() / containerWidth;
                textureRadius = Math.max(0, Math.round(borderRadius * scaleX));
            }

            if (textureRadius > 0) {
                applyCornerMask(pixels, renderPixbuf.get_width(), renderPixbuf.get_height(), textureRadius, renderPixbuf.get_rowstride());
            }

            const frameImage = new St.ImageContent({
                preferred_width: renderPixbuf.get_width(),
                preferred_height: renderPixbuf.get_height(),
            });
            const bytes = pixels instanceof GLib.Bytes ? pixels : new GLib.Bytes(pixels);

            setImageContentBytes(frameImage, bytes, format, renderPixbuf.get_width(), renderPixbuf.get_height(), renderPixbuf.get_rowstride());

            imageActor.set_content(frameImage);
        };

        updateImage(iter.get_pixbuf());

        if (animateGif) {
            let consecutiveFailures = 0;
            let lastErrorMessage = '';
            const scheduleNextFrame = (delayMs) => {
                const validDelay = Math.max(10, Math.floor(delayMs && delayMs > 0 ? delayMs : GIF_FRAME_INTERVAL_MS));
                state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validDelay, () => {
                    state.timerId = null;
                    if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;

                    let nextDelay = GIF_FRAME_INTERVAL_MS;
                    try {
                        if (iter.advance(null))
                            updateImage(iter.get_pixbuf());
                        consecutiveFailures = 0;
                        const rawDelay = iter.get_delay_time();
                        if (rawDelay && rawDelay > 0) nextDelay = Math.floor(rawDelay);
                    } catch (err) {
                        consecutiveFailures += 1;
                        lastErrorMessage = err.message;
                        if (consecutiveFailures >= MAX_CONSECUTIVE_FRAME_FAILURES) {
                            console.error(`GIF animation stopped after ${consecutiveFailures} consecutive frame failures; last error: ${lastErrorMessage}`);
                            return GLib.SOURCE_REMOVE;
                        }
                    }
                    scheduleNextFrame(nextDelay);
                    return GLib.SOURCE_REMOVE;
                });
            };

            const initialDelay = iter.get_delay_time();
            const validInitialDelay = (initialDelay && initialDelay > 0) ? Math.floor(initialDelay) : GIF_FRAME_INTERVAL_MS;
            scheduleNextFrame(validInitialDelay);
        }

        widgetNode.connect('notify::width', () => {
            if (!isActorDestroyed(widgetNode))
                scheduleDeferredUpdate(state, RESIZE_REPAINT_THROTTLE_MS, () => updateImage(iter.get_pixbuf()));
        });
        widgetNode.connect('notify::height', () => {
            if (!isActorDestroyed(widgetNode))
                scheduleDeferredUpdate(state, RESIZE_REPAINT_THROTTLE_MS, () => updateImage(iter.get_pixbuf()));
        });

        connectTimerCleanup(widgetNode, state);
    };

    const imagePath = widgetData.imagePath;
    (async () => {
        const file = Gio.File.new_for_path(imagePath);
        const stream = await new Promise((resolve, reject) => {
            file.read_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                try {
                    resolve(file.read_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        });
        const animation = await new Promise((resolve, reject) => {
            GdkPixbuf.PixbufAnimation.new_from_stream_async(stream, null, (_source, result) => {
                try {
                    resolve(GdkPixbuf.PixbufAnimation.new_from_stream_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        }).catch((error) => {
            stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
            throw error;
        });
        stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
        if (!isActorDestroyed(widgetNode)) startAnimation(animation);
    })().catch((e) => {
        console.error(`Failed to load GIF animation: ${e.message}`);
        if (!isActorDestroyed(widgetNode)) applyStaticFallback();
    });

    attachCaptionOverlay(widgetNode, widgetData, width, height, true);
    return widgetNode;
}

