import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor,
    resolveWidgetCornerRadius,
    resolveExplicitFontFamily,
    resolveUse24h,
    resolveTimeZone,
    parseCssColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';

const BASE_FACE_SIZE = 200;
const BASE_TIME_FONT_SIZE = 63;
// A share of the face, not of the widget scale: a narrow screen derives below the 0.5
// scale floor, which would hold the size past what the card can hold. The width it spends
// depends on the family, which is the user's to choose, so it is not tuned to any one font.
const MAX_TIME_FONT_RATIO = 0.27;
const BASE_MERIDIEM_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_CITY_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const MERIDIEM_MARGIN_BOTTOM_PX = 5;
const CITY_MARGIN_TOP_PX = 5;

// The face is square, so the ring is measured against its shorter side and these are
// ratios of it, which keeps one set of numbers valid at any size.
const RING_INSET_RATIO = 0.035;
const RING_CORNER_RATIO = 0.17;
const TICK_COUNT = 60;
// Fractions of the gap between marks, not of the face, which is what keeps air between them.
const TICK_LENGTH_GAP_RATIO = 0.42;
const TICK_LENGTH_BONUS_PX = 5;
const TICK_WIDTH_GAP_RATIO = 0.1;
const MIN_TICK_LENGTH_PX = 2;
const MIN_TICK_WIDTH_PX = 1;
const MIN_TICK_CLEARANCE_PX = 1;
const TICK_IDLE_ALPHA = 0.18;
// The comet is the mark under the current second plus this many behind it.
const TRAIL_LENGTH = 5;
const TRAIL_HEAD_ALPHA = 1;
// Must stay above TICK_IDLE_ALPHA.
const TRAIL_TAIL_ALPHA = 0.3;
const SECONDS_INTERVAL_MS = 1000;
// A fraction of the gap a rounded corner opens up. Closing it completely would square
// the corners off.
const CORNER_PULL_RATIO = 0.6;
const CARD_CORNER_CLEARANCE = 1 - Math.SQRT1_2;

const QUARTER_TURN = Math.PI / 2;

function timeLabelStyle({ fontCss, textColor, timeFontSize }) {
    return `${fontCss}color: ${textColor}; font-weight: ${TYPOGRAPHY_WEIGHT.black}; font-size: ${timeFontSize}px;`;
}

function meridiemLabelStyle({ fontCss, textColor, meridiemFontSize }) {
    return `${fontCss}color: ${textColor}; font-size: ${meridiemFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`
        + ` opacity: ${TEXT_OPACITY.secondary}; margin-bottom: ${MERIDIEM_MARGIN_BOTTOM_PX}px;`;
}

function cityLabelStyle({ fontCss, textColor, cityFontSize }) {
    return `${fontCss}color: ${textColor}; font-size: ${cityFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`
        + ` opacity: ${TEXT_OPACITY.metadata}; margin-top: ${CITY_MARGIN_TOP_PX}px;`;
}

// A point on a corner arc, with the unit normal pointing at its centre.
function arcPoint(centerX, centerY, radius, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [centerX + radius * cos, centerY + radius * sin, -cos, -sin];
}

// The face outline as eight pieces, each giving a point and its inward normal at any
// fraction of its own length.
function faceOutline(x, y, width, height, radius) {
    const across = width - 2 * radius;
    const down = height - 2 * radius;
    const arc = QUARTER_TURN * radius;
    return [
        { length: across, at: t => [x + radius + across * t, y, 0, 1] },
        { length: arc, at: t => arcPoint(x + width - radius, y + radius, radius, -QUARTER_TURN + QUARTER_TURN * t) },
        { length: down, at: t => [x + width, y + radius + down * t, -1, 0] },
        { length: arc, at: t => arcPoint(x + width - radius, y + height - radius, radius, QUARTER_TURN * t) },
        { length: across, at: t => [x + width - radius - across * t, y + height, 0, -1] },
        { length: arc, at: t => arcPoint(x + radius, y + height - radius, radius, QUARTER_TURN + QUARTER_TURN * t) },
        { length: down, at: t => [x, y + height - radius - down * t, 1, 0] },
        { length: arc, at: t => arcPoint(x + radius, y + radius, radius, 2 * QUARTER_TURN + QUARTER_TURN * t) },
    ];
}

function pointAlongOutline(segments, distance) {
    let remaining = distance;
    for (const segment of segments) {
        // A square face can collapse a straight run to zero length, and it still has to
        // be stepped over rather than divided by.
        if (remaining <= segment.length)
            return segment.at(segment.length > 0 ? remaining / segment.length : 0);
        remaining -= segment.length;
    }
    return segments[segments.length - 1].at(1);
}

function cometAlpha(second, index) {
    const age = second - index;
    if (age < 0 || age >= TRAIL_LENGTH)
        return TICK_IDLE_ALPHA;
    return TRAIL_HEAD_ALPHA - (TRAIL_HEAD_ALPHA - TRAIL_TAIL_ALPHA) * (age / (TRAIL_LENGTH - 1));
}

function drawTickFace(context, width, height, cardRadius, second, colorRgb) {
    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);

    const side = Math.min(width, height);
    if (side <= 0)
        return;

    const inset = side * RING_INSET_RATIO;
    // An inset rounded rect only stays inside the card's rounded corner while its own
    // radius is no tighter than the card's minus the inset, and the card radius is a fixed
    // pixel value this one does not scale with.
    const radius = Math.max(side * RING_CORNER_RATIO, cardRadius - inset);
    const boxWidth = width - 2 * inset;
    const boxHeight = height - 2 * inset;
    const outline = faceOutline(inset, inset, boxWidth, boxHeight, radius);
    const perimeter = outline.reduce((total, segment) => total + segment.length, 0);
    if (perimeter <= 0)
        return;

    const gap = perimeter / TICK_COUNT;
    const tickWidth = Math.max(MIN_TICK_WIDTH_PX, gap * TICK_WIDTH_GAP_RATIO);
    const air = Math.max(0, gap - tickWidth - MIN_TICK_CLEARANCE_PX);
    const length = Math.max(MIN_TICK_LENGTH_PX,
        Math.min(gap * TICK_LENGTH_GAP_RATIO + TICK_LENGTH_BONUS_PX, air));
    // The arc-length walk starts at the top-left tangent, so offsetting it by half the top
    // edge puts the first mark at twelve o'clock, where the comet starts and wraps.
    const startOffset = boxWidth / 2 - radius;
    const { r, g, b } = colorRgb;

    context.setLineCap(CAIRO_LINE_CAP_ROUND);
    context.setLineWidth(tickWidth);
    const clearance = cardRadius * CARD_CORNER_CLEARANCE;
    for (let index = 0; index < TICK_COUNT; index++) {
        const distance = (startOffset + perimeter * index / TICK_COUNT) % perimeter;
        const [x, y, normalX, normalY] = pointAlongOutline(outline, distance);
        // A corner arc bows away from the edge, so the ring drifts out as it rounds each
        // corner; pulling the mark back in by a fraction of that evens it against the edge.
        const edgeDistance = Math.min(x, y, width - x, height - y);
        const excess = Math.max(0, edgeDistance - inset);
        const pull = Math.min(CORNER_PULL_RATIO * excess, Math.max(0, edgeDistance - clearance));
        const baseX = x - normalX * pull;
        const baseY = y - normalY * pull;
        context.setSourceRGBA(r, g, b, cometAlpha(second, index));
        context.moveTo(baseX, baseY);
        context.lineTo(baseX + normalX * length, baseY + normalY * length);
        context.stroke();
    }
}

function buildFaceLabels({ is24h, fontCss, textColor, timeFontSize, meridiemFontSize, cityFontSize, locationName }) {
    // Centred above the digits: a label an order of magnitude smaller reads as an error
    // beside them, and the eyebrow keeps the composition symmetrical the way the ring is.
    let meridiemLabel = null;
    if (!is24h) {
        meridiemLabel = new St.Label({
            text: 'AM',
            style: meridiemLabelStyle({ fontCss, textColor, meridiemFontSize }),
            x_align: Clutter.ActorAlign.CENTER,
        });
    }

    const timeLabel = new St.Label({
        text: '00:00',
        style: timeLabelStyle({ fontCss, textColor, timeFontSize }),
        x_align: Clutter.ActorAlign.CENTER,
    });

    let cityLabel = null;
    if (locationName) {
        cityLabel = new St.Label({
            text: locationName,
            style: cityLabelStyle({ fontCss, textColor, cityFontSize }),
            x_align: Clutter.ActorAlign.CENTER,
        });
    }

    return { meridiemLabel, timeLabel, cityLabel, is24h };
}

function applyLabelTypography(elements, typography) {
    if (elements.meridiemLabel)
        elements.meridiemLabel.style = meridiemLabelStyle(typography);
    elements.timeLabel.style = timeLabelStyle(typography);
    if (elements.cityLabel)
        elements.cityLabel.style = cityLabelStyle(typography);
}

function updateFace(elements, is24h, timeZone) {
    const now = GLib.DateTime.new_now(timeZone);
    const { time, ampm } = formatTimeParts(now, is24h);
    elements.timeLabel.set_text(time);
    if (elements.meridiemLabel)
        elements.meridiemLabel.set_text(ampm);
}

export function createDigitalTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);
    const timeZone = resolveTimeZone(widgetData);
    const locationName = widgetData.location?.name || '';
    const tickColor = parseCssColor(textColor) || { r: 1, g: 1, b: 1 };
    const cardRadius = resolveWidgetCornerRadius(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    connectShortClick(widgetNode, () => launchApplication('gnome-clocks'));

    const tickCanvas = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    tickCanvas.connect('repaint', area => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        const second = GLib.DateTime.new_now(timeZone).get_seconds();
        drawTickFace(context, surfaceWidth, surfaceHeight, cardRadius, second, tickColor);
        context.$dispose();
    });
    widgetNode.add_child(tickCanvas);

    const textLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    widgetNode.add_child(textLayout);

    let timeElements = null;

    const applyScale = (scale, face) => {
        const is24h = resolveUse24h(widgetData);
        const typography = {
            fontCss,
            textColor,
            timeFontSize: Math.min(
                scaleFontSize(BASE_TIME_FONT_SIZE, scale, MIN_FONT_SIZE.primary),
                Math.round(face * MAX_TIME_FONT_RATIO)),
            meridiemFontSize: scaleFontSize(BASE_MERIDIEM_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            cityFontSize: scaleFontSize(BASE_CITY_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
        };

        // The actor tree only depends on 12/24h, so restyle in place until that changes.
        if (timeElements && timeElements.is24h === is24h) {
            applyLabelTypography(timeElements, typography);
            tickCanvas.queue_repaint();
            return;
        }

        const previous = timeElements;
        const nextElements = buildFaceLabels({ is24h, locationName, ...typography });
        if (previous) {
            // The meridiem and the city are both conditional, so only the ones that were
            // built are still children of the box.
            for (const label of [previous.meridiemLabel, previous.timeLabel, previous.cityLabel]) {
                if (!label)
                    continue;
                textLayout.remove_child(label);
                label.destroy();
            }
        }
        for (const label of [nextElements.meridiemLabel, nextElements.timeLabel, nextElements.cityLabel]) {
            if (label)
                textLayout.add_child(label);
        }
        timeElements = nextElements;
        updateFace(timeElements, is24h, timeZone);
        tickCanvas.queue_repaint();
    };

    const state = {
        timerId: null,
    };

    // The ring advances every second, so it needs its own state: both timer helpers
    // claim state.timerId and each removes whatever the other left there.
    const ringState = {
        timerId: null,
    };
    startPollingTimer(() => tickCanvas.queue_repaint(), SECONDS_INTERVAL_MS, ringState);
    connectTimerCleanup(widgetNode, ringState);

    const updateDisplay = () => updateFace(timeElements, timeElements.is24h, timeZone);

    const faceSize = Math.max(1, Math.min(width, height));
    applyScale(clampWidgetScale(faceSize / BASE_FACE_SIZE), faceSize);
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);
    attachResponsiveScaler(widgetNode, BASE_FACE_SIZE, BASE_FACE_SIZE, (scale, currentWidth, currentHeight) => {
        if (isActorDestroyed(widgetNode)) return;
        applyScale(scale, Math.max(1, Math.min(currentWidth, currentHeight)));
    });

    return widgetNode;
}
