import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    buildBaseWidgetStyle,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveWidgetFontFamily,
    parseHexColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND
} from './widgetUtils.js';

const CAPTION_PADDING_PIXELS = 12;
const ARC_MARGIN_PIXELS = 4;
const MIN_CIRCULAR_ARC_LINE_WIDTH = 4;
const DEFAULT_LINE_WIDTH_RATIO = 0.1;
const MIN_RESPONSIVE_SCALE = 0.4;
const FULL_CIRCLE_RADIANS = Math.PI * 2;
const SECONDS_IN_MINUTE = 60;
const MILLISECONDS_IN_SECOND = 1000;

export function createWidgetContainer(config, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveWidgetFontFamily(config);

    const container = new St.Widget({
        style: `background-color: ${backgroundColor}; color: ${textColor}; font-family: ${fontFamily}; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);
    return container;
}

export function connectTimerCleanup(container, state) {
    container.connect('destroy', () => {
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
    });
}

export function startPollingTimer(pollFunction, intervalMs, state) {
    pollFunction();
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
        pollFunction();
        return GLib.SOURCE_CONTINUE;
    });
}

export function startMinuteAlignedTimer(state, widgetNode, updateCallback) {
    const now = GLib.DateTime.new_now_local();
    const remainingMilliseconds = (SECONDS_IN_MINUTE - now.get_seconds()) * MILLISECONDS_IN_SECOND
        - (now.get_microsecond() / MILLISECONDS_IN_SECOND);
    const millisecondsUntilNextMinute = Math.max(100, Math.floor(remainingMilliseconds));

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millisecondsUntilNextMinute, () => {
        if (widgetNode.isDestroyed)
            return GLib.SOURCE_REMOVE;

        updateCallback();
        // After the first alignment tick, the widget can stay on a simple 60s cadence.
        state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SECONDS_IN_MINUTE, () => updateCallback());
        return GLib.SOURCE_REMOVE;
    });
}

export function createCaptionOverlay(config, caption) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = config.textColor || config.fgColor || resolveWidgetForegroundColor(config);

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.END,
        style: `padding: ${CAPTION_PADDING_PIXELS}px;`,
    });

    const titleLabel = new St.Label({
        text: caption,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: 14px; text-align: center; text-shadow: 0px 2px 4px rgba(0,0,0,0.8);`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    contentBox.add_child(titleLabel);
    return contentBox;
}

export function drawCircularArc(context, width, height, progress, colorHex, lineWidthRatio = DEFAULT_LINE_WIDTH_RATIO, trackColorHex = null) {
    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);

    const centerX = width / 2;
    const centerY = height / 2;
    const lineWidth = Math.max(MIN_CIRCULAR_ARC_LINE_WIDTH, Math.min(width, height) * lineWidthRatio);
    const radius = Math.min(centerX, centerY) - lineWidth - ARC_MARGIN_PIXELS;

    if (trackColorHex) {
        const { r, g, b } = parseHexColor(trackColorHex);
        context.setSourceRGBA(r, g, b, 0.15);
    } else {
        context.setSourceRGBA(1, 1, 1, 0.1);
    }
    context.setLineWidth(lineWidth);
    context.arc(centerX, centerY, radius, 0, FULL_CIRCLE_RADIANS);
    context.stroke();

    if (progress > 0) {
        const { r, g, b } = parseHexColor(colorHex);

        context.setSourceRGBA(r, g, b, 1.0);
        context.setLineWidth(lineWidth);
        context.setLineCap(CAIRO_LINE_CAP_ROUND);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + FULL_CIRCLE_RADIANS * Math.min(Math.max(progress, 0), 1);
        context.arc(centerX, centerY, radius, startAngle, endAngle);
        context.stroke();
    }
}

export function attachResponsiveScaler(widgetNode, refWidth, refHeight, updateCallback) {
    const update = () => {
        if (!widgetNode || widgetNode.isDestroyed) return;
        const currentWidth = widgetNode.width || refWidth;
        const currentHeight = widgetNode.height || refHeight;
        const scale = Math.max(MIN_RESPONSIVE_SCALE, Math.min(currentWidth / refWidth, currentHeight / refHeight));
        updateCallback(scale, currentWidth, currentHeight);
    };

    widgetNode.connect('notify::width', update);
    widgetNode.connect('notify::height', update);

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (widgetNode && !widgetNode.isDestroyed) {
            update();
        }
        return GLib.SOURCE_REMOVE;
    });

    return update;
}
