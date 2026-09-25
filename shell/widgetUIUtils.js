import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import { watchActorLifecycle, isActorDestroyed } from '../utils/actorLifecycle.js';

/** Abbreviated month names shared by calendar and contribution-grid widgets. */
export const MONTH_NAMES_ABBREVIATED = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
import {
    buildBaseWidgetStyle,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../utils/widgetUtils.js';
import {
    TYPOGRAPHY_SIZE,
    TYPOGRAPHY_WEIGHT,
    TEXT_OPACITY,
    MIN_FONT_SIZE,
    clampWidgetScale,
    scaleFontSize,
} from '../utils/typography.js';

const CAPTION_PADDING_PIXELS = 12;
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
                for (const cleanup of callbacks)
                    cleanup();
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
        style_class: 'gridgets-widget',
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

export function connectTimerCleanup(container, state) {
    registerWidgetCleanup(container, () => {
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
        if (state.deferredUpdateId) {
            GLib.Source.remove(state.deferredUpdateId);
            state.deferredUpdateId = null;
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

export function startMinuteAlignedTimer(state, widgetNode, updateCallback) {
    if (state.timerId) {
        GLib.Source.remove(state.timerId);
        state.timerId = null;
    }

    const now = GLib.DateTime.new_now_local();
    const remainingMilliseconds = (SECONDS_IN_MINUTE - now.get_seconds()) * MILLISECONDS_IN_SECOND
        - (now.get_microsecond() / MILLISECONDS_IN_SECOND);
    const millisecondsUntilNextMinute = Math.max(100, Math.floor(remainingMilliseconds));

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millisecondsUntilNextMinute, () => {
        if (isActorDestroyed(widgetNode)) {
            state.timerId = null;
            return GLib.SOURCE_REMOVE;
        }

        updateCallback();
        state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SECONDS_IN_MINUTE, () => {
            if (isActorDestroyed(widgetNode)) {
                state.timerId = null;
                return GLib.SOURCE_REMOVE;
            }
            updateCallback();
            return GLib.SOURCE_CONTINUE;
        });
        return GLib.SOURCE_REMOVE;
    });
}

export function createCaptionOverlay(config, caption) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);

    const contentBox = watchActorLifecycle(new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.END,
    }));

    const titleLabel = new St.Label({
        text: caption,
        x_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.line_wrap = true;
    titleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

    const updateScale = scale => {
        const fontSize = scaleFontSize(TYPOGRAPHY_SIZE.metadata, scale, MIN_FONT_SIZE.metadata);
        const padding = scaleFontSize(CAPTION_PADDING_PIXELS, scale);
        contentBox.style = `padding: ${padding}px;`;
        titleLabel.style = `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`
            + `font-size: ${fontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; text-align: center;`;
    };

    updateScale(1);
    contentBox.updateCaptionScale = updateScale;
    contentBox.add_child(titleLabel);
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
        const { r, g, b } = parseCssColor(colorHex);

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

export function attachResponsiveScaler(widgetNode, refWidth, refHeight, updateCallback) {
    const update = () => {
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
    widgetNode.connect('destroy', () => {
        widgetNode.disconnect(widthId);
        widgetNode.disconnect(heightId);
    });

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!isActorDestroyed(widgetNode)) {
            update();
        }
        return GLib.SOURCE_REMOVE;
    });

    return update;
}
