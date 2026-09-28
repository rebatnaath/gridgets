import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import { buildBaseWidgetStyle, resolveWidgetCornerRadius, CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER } from '../../utils/widgetUtils.js';
import { WidgetActor, connectTimerCleanup, registerWidgetCleanup, scheduleDeferredUpdate, traceRoundedRect } from '../../shell/widgetUIUtils.js';
import { ASPECT_RATIO_TOLERANCE, GIF_FRAME_INTERVAL_MS, attachCaptionOverlay, backgroundImageStyle } from './mediaCommon.js';
import { addSettleAfterResize } from '../../utils/resizeSettle.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';

const RESIZE_REPAINT_THROTTLE_MS = 16;

const MAX_CONSECUTIVE_FRAME_FAILURES = 10;

/**
 * A drawing area that paints the current frame, clipped to the widget's corner radius.
 *
 * This is the only place in the shell process that needs Gdk, and it is here rather than
 * in shell/widgetUIUtils.js on purpose. Everything else that shows a picture hands a file
 * to a stylesheet (`background-image`), which needs nothing from Gdk; an animation cannot,
 * because a file per frame at GIF_FRAME_INTERVAL_MS is not viable. Gdk is still on the
 * "do not import in GNOME Shell" list, so this is a deliberate exception for animation
 * only - see .ideas-and-sketchpad/skills/gnome-guidelines/review-guidelines.md.
 *
 * The rounding is a cairo clip rather than a mask baked into the pixels. The mask had to
 * know the display size to scale the radius, but the first frame is painted before Clutter
 * has allocated the widget, so that size was 0, the radius came out 0 and the picture was
 * left square; and it mutated the iterator's own pixbuf in place, so every later frame was
 * masked again on top of the last. Clipping here is computed from the size actually being
 * painted, and the frames are only ever read.
 */
function createFramePainter(cornerRadius) {
    const area = new St.DrawingArea({
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    let pixbuf = null;

    area.connect('repaint', () => {
        if (isActorDestroyed(area)) return;
        const ctx = area.get_context();
        const [boxWidth, boxHeight] = area.get_surface_size();
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        if (pixbuf && boxWidth > 0 && boxHeight > 0) {
            ctx.save();
            if (cornerRadius > 0) {
                traceRoundedRect(ctx, 0, 0, boxWidth, boxHeight, cornerRadius);
                ctx.clip();
            }
            const sourceWidth = pixbuf.get_width();
            const sourceHeight = pixbuf.get_height();
            ctx.scale(boxWidth / sourceWidth, boxHeight / sourceHeight);
            Gdk.cairo_set_source_pixbuf(ctx, pixbuf, 0, 0);
            ctx.paint();
            ctx.restore();
        }
        ctx.$dispose();
    });
    watchActorLifecycle(area);

    return {
        actor: area,
        setFrame(nextPixbuf) {
            pixbuf = nextPixbuf;
            area.queue_repaint();
        },
    };
}

export function createAnimatedImageNode(widgetData, width, height, xPosition, yPosition, animateGif = true) {
    // resolveWidgetCornerRadius, not `appliedBorderRadius || 0`: an absent override means
    // the 15px default, and || 0 quietly squared off every animated image. This radius is
    // what rounds the drawn frames, since a drawing area has no stylesheet of its own.
    const borderRadius = resolveWidgetCornerRadius(widgetData);
    const baseStyle = buildBaseWidgetStyle(widgetData);

    const widgetNode = new WidgetActor({
        style: `background-color: transparent; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });

    widgetNode.set_clip_to_allocation(true);
    watchActorLifecycle(widgetNode);
    const state = {
        timerId: null,
    };
    const loadCancellable = new Gio.Cancellable();
    registerWidgetCleanup(widgetNode, () => loadCancellable.cancel());

    const applyStaticFallback = () => {
        widgetNode.style = backgroundImageStyle(widgetData.imagePath, baseStyle);
    };

    const startAnimation = (animation) => {
        if (animation.is_static_image()) {
            applyStaticFallback();
            return;
        }

        const iter = animation.get_iter(null);
        // The frame is cropped to the container's aspect ratio below, so filling the box
        // is what keeps it undistorted.
        const framePainter = createFramePainter(borderRadius);
        const imageActor = framePainter.actor;
        // The caption overlay is added while the load is still in flight, so index 0
        // keeps the frames behind it.
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

            framePainter.setFrame(renderPixbuf);
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

        // A resize drag calls set_size on every motion event, and repainting here would
        // re-crop and re-rasterise a frame through cairo each time. That is the one
        // resize path that cannot be cheap, and it is why the animated widget juddered
        // while a static one did not: a growing widget is more pixels to redraw. Held
        // still during the drag, then applied once to the settled size.
        const repaintForCurrentSize = () => {
            if (isActorDestroyed(widgetNode))
                return;
            scheduleDeferredUpdate(state, RESIZE_REPAINT_THROTTLE_MS, () => updateImage(iter.get_pixbuf()));
        };
        addSettleAfterResize(widgetNode, repaintForCurrentSize);
        widgetNode.connect('notify::width', () => {
            if (!widgetNode.isResizing)
                repaintForCurrentSize();
        });
        widgetNode.connect('notify::height', () => {
            if (!widgetNode.isResizing)
                repaintForCurrentSize();
        });

        connectTimerCleanup(widgetNode, state);
    };

    const imagePath = widgetData.imagePath;
    (async () => {
        const file = Gio.File.new_for_path(imagePath);
        const stream = await new Promise((resolve, reject) => {
            file.read_async(GLib.PRIORITY_DEFAULT, loadCancellable, (_source, result) => {
                try {
                    resolve(file.read_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        });
        const animation = await new Promise((resolve, reject) => {
            GdkPixbuf.PixbufAnimation.new_from_stream_async(stream, loadCancellable, (_source, result) => {
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
        if (isActorDestroyed(widgetNode)) return;
        console.error(`Failed to load GIF animation: ${e.message}`);
        applyStaticFallback();
    });

    attachCaptionOverlay(widgetNode, widgetData, width, height, true, widgetData.imagePath);
    return widgetNode;
}
