import St from 'gi://St';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import { buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { connectTimerCleanup } from '../../utils/widgetUIUtils.js';
import { ASPECT_RATIO_TOLERANCE, GIF_FRAME_INTERVAL_MS, applyCornerMask, attachCaptionOverlay } from './mediaCommon.js';

export function createAnimatedImageNode(widgetData, width, height, xPosition, yPosition, animateGif = true) {
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const borderWidth = widgetData.appliedBorderWidth || 0;
    const baseStyle = buildBaseWidgetStyle(widgetData);

    const widgetNode = new St.Widget({
        style: `background-color: transparent; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
    });

    widgetNode.set_clip_to_allocation(true);
    const state = {
        timerId: null,
    };

    try {
        const animation = GdkPixbuf.PixbufAnimation.new_from_file(widgetData.imagePath);
        if (animation.is_static_image()) {
            widgetNode.style = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; ${baseStyle}`;
            return widgetNode;
        }

        const iter = animation.get_iter(null);
        const imageActor = new St.Widget();
        widgetNode.add_child(imageActor);

        const updateImage = (pixbuf) => {
            if (widgetNode.isDestroyed || !pixbuf) return;
            let renderPixbuf = pixbuf;
            const bw = borderWidth;
            const containerWidth = widgetNode.width;
            const containerHeight = widgetNode.height;
            const innerWidth = Math.max(0, containerWidth - bw * 2);
            const innerHeight = Math.max(0, containerHeight - bw * 2);

            if (innerWidth > 0 && innerHeight > 0) {
                const imageWidth = pixbuf.get_width();
                const imageHeight = pixbuf.get_height();
                const imageAspect = imageWidth / imageHeight;
                const containerAspect = innerWidth / innerHeight;

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

                imageActor.set_size(innerWidth, innerHeight);
                imageActor.set_position(bw, bw);
            }

            if (!renderPixbuf.get_has_alpha()) {
                renderPixbuf = renderPixbuf.add_alpha(false, 0, 0, 0);
            }

            const format = Cogl.PixelFormat.RGBA_8888;
            const pixels = renderPixbuf.get_pixels();

            let textureRadius = 0;
            if (innerWidth > 0) {
                const scaleX = renderPixbuf.get_width() / innerWidth;
                textureRadius = Math.max(0, Math.round((borderRadius - bw) * scaleX));
            }

            if (textureRadius > 0) {
                applyCornerMask(pixels, renderPixbuf.get_width(), renderPixbuf.get_height(), textureRadius, renderPixbuf.get_rowstride());
            }

            const frameImage = new St.ImageContent({
                preferred_width: renderPixbuf.get_width(),
                preferred_height: renderPixbuf.get_height(),
            });
            const bytes = pixels instanceof GLib.Bytes ? pixels : new GLib.Bytes(pixels);

            try {
                const coglContext = global.stage.context.get_backend().get_cogl_context();
                frameImage.set_bytes(coglContext, bytes, format, renderPixbuf.get_width(), renderPixbuf.get_height(), renderPixbuf.get_rowstride());
            } catch (e) {
                try {
                    frameImage.set_bytes(bytes, format, renderPixbuf.get_width(), renderPixbuf.get_height(), renderPixbuf.get_rowstride());
                } catch (e2) {
                    console.error(`Failed to set GIF frame data: ${e2.message}`);
                    return;
                }
            }

            imageActor.set_content(frameImage);
        };

        updateImage(iter.get_pixbuf());

        if (animateGif) {
            const scheduleNextFrame = (delayMs) => {
                const validDelay = Math.max(10, Math.floor(delayMs && delayMs > 0 ? delayMs : GIF_FRAME_INTERVAL_MS));
                state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validDelay, () => {
                    state.timerId = null;
                    if (widgetNode.isDestroyed) return GLib.SOURCE_REMOVE;

                    try {
                        if (iter.advance(null)) {
                            updateImage(iter.get_pixbuf());
                        }
                        const rawDelay = iter.get_delay_time();
                        const nextDelay = (rawDelay && rawDelay > 0) ? Math.floor(rawDelay) : GIF_FRAME_INTERVAL_MS;
                        scheduleNextFrame(nextDelay);
                    } catch (err) {
                        console.error(`GIF loop error: ${err.message}`);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            };

            const initialDelay = iter.get_delay_time();
            const validInitialDelay = (initialDelay && initialDelay > 0) ? Math.floor(initialDelay) : GIF_FRAME_INTERVAL_MS;
            scheduleNextFrame(validInitialDelay);
        }

        widgetNode.connect('notify::width', () => {
            if (!widgetNode.isDestroyed) updateImage(iter.get_pixbuf());
        });
        widgetNode.connect('notify::height', () => {
            if (!widgetNode.isDestroyed) updateImage(iter.get_pixbuf());
        });

        connectTimerCleanup(widgetNode, state);

    } catch (e) {
        console.error('Failed to load GIF animation:', e);
        widgetNode.style = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; ${baseStyle}`;
    }

    attachCaptionOverlay(widgetNode, widgetData, width, height, true);
    return widgetNode;
}

export function createAnimatedGifNode(widgetData, width, height, xPosition, yPosition, animateGif = true) {
    return createAnimatedImageNode(widgetData, width, height, xPosition, yPosition, animateGif);
}
