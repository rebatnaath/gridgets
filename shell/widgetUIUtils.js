import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import { watchActorLifecycle, isActorDestroyed } from '../utils/actorLifecycle.js';
import { createScrim } from '../components/scrim/scrim.js';

/** Abbreviated month names shared by calendar and contribution-grid widgets. */
export const MONTH_NAMES_ABBREVIATED = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
import {
    buildBaseWidgetStyle,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveCaptionForegroundColor,
    resolveWidgetCornerRadius,
    resolveExplicitFontFamily,
    parseCssColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../utils/widgetUtils.js';
import {
    TYPOGRAPHY_WEIGHT,
    TEXT_OPACITY,
    clampWidgetScale,
    scaleFontSize,
} from '../utils/typography.js';

const CAPTION_PADDING_PIXELS = 14;
const CAPTION_BOTTOM_PADDING_PIXELS = 12;
const CAPTION_SIDE_PADDING_PIXELS = 10;
// scaleFontSize clamps to 1px by default, which collapsed this inset on small widgets.
const MIN_CAPTION_SIDE_PADDING_PX = 8;
// The caption's size at a 320px-wide widget, scaled from there by its width.
const CAPTION_FONT_SIZE_PX = 14;
const MIN_CAPTION_FONT_SIZE_PX = 7;
const ARC_MARGIN_PIXELS = 4;
const MIN_CIRCULAR_ARC_LINE_WIDTH = 4;
const DEFAULT_LINE_WIDTH_RATIO = 0.1;
const FULL_CIRCLE_RADIANS = Math.PI * 2;
const SECONDS_IN_MINUTE = 60;
const MILLISECONDS_IN_SECOND = 1000;
const TWELVE_HOUR_FORMAT = '%I';
const MINUTE_FORMAT = '%M';
const AM_PM_FORMAT = '%p';

export function formatTimeParts(dateTime, is24h) {
    if (is24h)
        return { time: dateTime.format('%H:%M'), ampm: '' };

    const displayHour = parseInt(dateTime.format(TWELVE_HOUR_FORMAT), 10).toString();
    return { time: `${displayHour}:${dateTime.format(MINUTE_FORMAT)}`, ampm: dateTime.format(AM_PM_FORMAT) };
}

/**
 * Base actor for widget roots. Cleanup is registered through registerCleanup()
 * and runs from the destroy() override (sources and signals first, then child
 * release via super.destroy()), instead of connecting 'destroy' listeners.
 */
export const WidgetActor = GObject.registerClass(
    class WidgetActor extends St.Widget {
        _init(params = {}) {
            super._init(params);
            this._cleanupCallbacks = null;
        }

        registerCleanup(cleanupFn) {
            if (!this._cleanupCallbacks)
                this._cleanupCallbacks = [];
            this._cleanupCallbacks.push(cleanupFn);
        }

        destroy() {
            if (this._cleanupCallbacks) {
                const callbacks = this._cleanupCallbacks;
                this._cleanupCallbacks = null;
                // Each cleanup is independent: one throwing must not strand the
                // timers and cancellables registered after it, which would keep
                // firing against already-destroyed actors.
                for (const cleanup of callbacks) {
                    try {
                        cleanup();
                    } catch (error) {
                        console.error('Gridgets: widget cleanup failed:', error);
                    }
                }
            }
            super.destroy();
        }
    });

/** Registers teardown work that runs when the widget actor is destroyed. */
export function registerWidgetCleanup(widgetNode, cleanupFn) {
    widgetNode.registerCleanup(cleanupFn);
}

export function createWidgetContainer(config, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const container = new WidgetActor({
        style: `${fontCss}background-color: ${backgroundColor}; color: ${textColor}; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);
    return watchActorLifecycle(container);
}

/**
 * Removes a widget's GLib sources on destroy.
 *
 * `fields` names the state properties holding source ids. It takes them as arguments
 * because a widget with a second timer otherwise has to register a second cleanup, which
 * is the same three lines again in every file that needs one.
 */
export function connectTimerCleanup(container, state, fields = ['timerId', 'deferredUpdateId']) {
    registerWidgetCleanup(container, () => {
        for (const field of fields) {
            if (!state[field])
                continue;
            GLib.Source.remove(state[field]);
            state[field] = null;
        }
    });
}

/** Coalesces bursts of calls (e.g. resize notifications) into a single deferred invocation. */
export function scheduleDeferredUpdate(state, delayMs, updateCallback) {
    if (state.deferredUpdateId) {
        GLib.Source.remove(state.deferredUpdateId);
    }
    state.deferredUpdateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
        state.deferredUpdateId = null;
        updateCallback();
        return GLib.SOURCE_REMOVE;
    });
}

export function startPollingTimer(pollFunction, intervalMs, state) {
    if (state.timerId) {
        GLib.Source.remove(state.timerId);
        state.timerId = null;
    }
    pollFunction();
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
        pollFunction();
        return GLib.SOURCE_CONTINUE;
    });
}

// Aimed past the boundary rather than at it, so an ordinary fire lands on the new minute.
const MINUTE_TIMER_MARGIN_MS = 100;

/**
 * Fires `updateCallback` once per wall-clock minute, aimed just after each boundary.
 *
 * A timer is armed from a wall-clock reading but scheduled on the monotonic clock, so a
 * fire can land before or after the boundary it was aimed at. The callback therefore
 * compares the minute it is about to render against the last one it rendered, and only
 * updates when it actually changed. That is what makes a mis-timed fire harmless: it can
 * neither render a minute that has not started nor skip one that has.
 *
 * The delay is recomputed from the current time on each tick rather than chained at a
 * fixed interval, so a fire that lands early does not accumulate into a permanently
 * late one, and a coarse seconds timer is not used because it rounds its expiry up to
 * the next whole second and can step over a boundary.
 */
export function startMinuteAlignedTimer(state, widgetNode, updateCallback) {
    if (state.timerId) {
        GLib.Source.remove(state.timerId);
        state.timerId = null;
    }

    // Seeded from the clock, not left null, so a first fire that lands inside the minute
    // the caller already painted does not re-render the same time.
    const initial = GLib.DateTime.new_now_local();
    let lastRenderedMinute = `${initial.get_hour()}:${initial.get_minute()}`;

    const arm = () => {
        const now = GLib.DateTime.new_now_local();
        const millisecondsUntilNextMinute = (SECONDS_IN_MINUTE - now.get_seconds()) * MILLISECONDS_IN_SECOND
            - (now.get_microsecond() / MILLISECONDS_IN_SECOND)
            + MINUTE_TIMER_MARGIN_MS;
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            Math.max(MINUTE_TIMER_MARGIN_MS, Math.ceil(millisecondsUntilNextMinute)), () => {
                if (isActorDestroyed(widgetNode)) {
                    state.timerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                const current = GLib.DateTime.new_now_local();
                const minute = `${current.get_hour()}:${current.get_minute()}`;
                if (minute !== lastRenderedMinute) {
                    lastRenderedMinute = minute;
                    updateCallback();
                }
                arm();
                return GLib.SOURCE_REMOVE;
            });
    };

    arm();
}

export function createCaptionOverlay(config, caption) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveCaptionForegroundColor(config);

    // Not a layout, which would give the scrim its own row, and not an St.Bin, which
    // holds one child and would drop the scrim when the label is added.
    const contentBox = watchActorLifecycle(new St.Widget({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        // Children are never allocated without one.
        layout_manager: new Clutter.BinLayout(),
    }));

    const captionFontSize = scale =>
        scaleFontSize(CAPTION_FONT_SIZE_PX, scale, MIN_CAPTION_FONT_SIZE_PX);

    // Added before the label so the text paints on top of it.
    const scrim = createScrim({
        enabled: config.globalCaptionScrim === true,
        borderRadius: resolveWidgetCornerRadius(config),
    });
    if (scrim)
        contentBox.add_child(scrim);

    const titleLabel = new St.Label({
        text: caption,
        // y_expand is required: ClutterBinLayout centres a child that does not expand and
        // ignores its y_align.
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.END,
    });
    titleLabel.clutter_text.line_wrap = true;
    titleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    contentBox.add_child(titleLabel);

    const updateScale = scale => {
        const fontSize = captionFontSize(scale);
        // On the label, not contentBox, whose layout would inset the scrim as well. The
        // sides scale with a floor; the top and bottom stay fixed.
        const sidePadding = scaleFontSize(CAPTION_SIDE_PADDING_PIXELS, scale, MIN_CAPTION_SIDE_PADDING_PX);
        titleLabel.style = `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`
            + `padding: ${CAPTION_PADDING_PIXELS}px ${sidePadding}px ${CAPTION_BOTTOM_PADDING_PIXELS}px ${sidePadding}px;`
            + `font-size: ${fontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; text-align: left;`;
    };

    updateScale(1);
    contentBox.updateCaptionScale = updateScale;
    // Set by a slideshow on each slide, rather than by rebuilding the overlay.
    contentBox.setCaptionText = text => {
        titleLabel.text = text;
    };
    return contentBox;
}

export function drawCircularArc(context, width, height, progress, colorHex, lineWidthRatio = DEFAULT_LINE_WIDTH_RATIO, trackColorHex = null, marginPixels = ARC_MARGIN_PIXELS) {
    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);

    const centerX = width / 2;
    const centerY = height / 2;
    const lineWidth = Math.max(MIN_CIRCULAR_ARC_LINE_WIDTH, Math.min(width, height) * lineWidthRatio);
    const radius = Math.min(centerX, centerY) - lineWidth - marginPixels;
    if (radius <= 0)
        return;

    // The track uses the card surface color so it stays
    // visible on both light and dark widget backgrounds.
    let trackColor = { r: 1, g: 1, b: 1 };
    if (trackColorHex) {
        trackColor = parseCssColor(trackColorHex);
    } else {
        trackColor = parseCssColor(colorHex) || trackColor;
    }
    context.setSourceRGBA(trackColor.r, trackColor.g, trackColor.b, trackColor.a ?? 1.0);
    context.setLineWidth(lineWidth);
    context.arc(centerX, centerY, radius, 0, FULL_CIRCLE_RADIANS);
    context.stroke();

    if (progress > 0) {
        // Same fallback as the track: a colour the parser rejects must not throw out of a
        // draw handler, which would leave the arc unpainted with no diagnostic.
        const arcColor = parseCssColor(colorHex) || trackColor;
        const { r, g, b } = arcColor;

        context.setSourceRGBA(r, g, b, 1.0);
        context.setLineWidth(lineWidth);
        context.setLineCap(CAIRO_LINE_CAP_ROUND);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + FULL_CIRCLE_RADIANS * Math.min(Math.max(progress, 0), 1);
        context.arc(centerX, centerY, radius, startAngle, endAngle);
        context.stroke();
    }
}

const FEEDBACK_HOVER_SCALE = 1.06;
const FEEDBACK_PRESS_SCALE = 0.93;
const FEEDBACK_HOVER_DURATION_MS = 120;
const FEEDBACK_PRESS_DURATION_MS = 70;

const SPARK_LINE_WIDTH_PX = 1;
const SPARK_FILL_ALPHA_RATIO = 0.12;
export const SPARK_SAMPLE_CAPACITY = 40;

/** Draws a thin history sparkline; samples are normalized against maxValue. */
export function drawSparkline(context, width, height, samples, maxValue, r, g, b, lineAlpha) {
    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);

    if (!samples || samples.length < 2 || width <= 0 || height <= 0)
        return;

    const span = Math.max(maxValue, 1e-9);
    const stepX = width / (SPARK_SAMPLE_CAPACITY - 1);
    const offsetX = width - ((samples.length - 1) * stepX);
    const pointAt = (index) => [
        offsetX + (index * stepX),
        height - 1 - ((samples[index] / span) * (height - 2)),
    ];

    context.newPath();
    for (let i = 0; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        if (i === 0)
            context.moveTo(x, y);
        else
            context.lineTo(x, y);
    }
    context.setSourceRGBA(r, g, b, lineAlpha);
    context.setLineWidth(SPARK_LINE_WIDTH_PX);
    context.stroke();

    const [firstX, firstY] = pointAt(0);
    const [lastX] = pointAt(samples.length - 1);
    context.newPath();
    context.moveTo(firstX, firstY);
    for (let i = 1; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        context.lineTo(x, y);
    }
    context.lineTo(lastX, height);
    context.lineTo(firstX, height);
    context.closePath();
    context.setSourceRGBA(r, g, b, SPARK_FILL_ALPHA_RATIO * lineAlpha);
    context.fill();
}

/** Adds subtle hover-grow and press-dip feedback to an interactive actor. */
export function attachButtonFeedback(button) {
    button.set_pivot_point(0.5, 0.5);

    const easeTo = (targetScale, durationMs) => {
        button.ease({
            'scale-x': targetScale,
            'scale-y': targetScale,
            duration: durationMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    };

    button.connect('notify::hover', () => {
        easeTo(button.hover ? FEEDBACK_HOVER_SCALE : 1, FEEDBACK_HOVER_DURATION_MS);
    });

    button.connect('button-press-event', () => {
        easeTo(FEEDBACK_PRESS_SCALE, FEEDBACK_PRESS_DURATION_MS);
        return Clutter.EVENT_PROPAGATE;
    });

    button.connect('button-release-event', () => {
        easeTo(button.hover ? FEEDBACK_HOVER_SCALE : 1, FEEDBACK_PRESS_DURATION_MS);
        return Clutter.EVENT_PROPAGATE;
    });
}

/**
 * Traces a rounded rectangle into the current cairo path. Pair with ctx.clip() to round
 * something a stylesheet cannot round - a drawing area has no background, so its contents
 * are clipped by cairo rather than by border-radius. The radius is clamped to half the
 * shorter side, since arcs larger than that overlap and turn into a lozenge.
 */
export function traceRoundedRect(ctx, x, y, width, height, radius) {
    const limit = Math.min(width, height) / 2;
    const corner = Math.max(0, Math.min(radius, limit));
    ctx.newSubPath();
    ctx.arc(x + corner, y + corner, corner, Math.PI, 1.5 * Math.PI);
    ctx.arc(x + width - corner, y + corner, corner, 1.5 * Math.PI, 2 * Math.PI);
    ctx.arc(x + width - corner, y + height - corner, corner, 2 * Math.PI, 2.5 * Math.PI);
    ctx.arc(x + corner, y + height - corner, corner, 2.5 * Math.PI, 3 * Math.PI);
    ctx.closePath();
}

export function attachResponsiveScaler(widgetNode, refWidth, refHeight, updateCallback) {
    const update = () => {
        // Per resizeSettle.js: held still until the drag ends, and the final size
        // arrives as another notify.
        if (widgetNode.isResizing)
            return;
        // During teardown or before the first allocation Clutter can report a
        // non-finite size. Feeding that to a layout callback produces NaN
        // geometry and an INT32_MIN allocation, so bail out instead.
        const currentWidth = widgetNode.width || refWidth;
        const currentHeight = widgetNode.height || refHeight;
        if (!Number.isFinite(currentWidth) || !Number.isFinite(currentHeight))
            return;
        if (currentWidth <= 0 || currentHeight <= 0)
            return;

        const rawScale = Math.min(currentWidth / refWidth, currentHeight / refHeight);
        if (!Number.isFinite(rawScale) || rawScale <= 0)
            return;

        const scale = clampWidgetScale(rawScale);
        updateCallback(scale, currentWidth, currentHeight);
    };

    const widthId = widgetNode.connect('notify::width', update);
    const heightId = widgetNode.connect('notify::height', update);

    // The first pass is deferred to an idle so the widget has been allocated by then.
    // The source is held and torn down through registerCleanup rather than left to fire
    // once against a destroyed actor.
    let firstPassSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        firstPassSourceId = 0;
        if (!isActorDestroyed(widgetNode))
            update();
        return GLib.SOURCE_REMOVE;
    });

    registerWidgetCleanup(widgetNode, () => {
        if (firstPassSourceId) {
            GLib.Source.remove(firstPassSourceId);
            firstPassSourceId = 0;
        }
        widgetNode.disconnect(widthId);
        widgetNode.disconnect(heightId);
    });

    return update;
}
