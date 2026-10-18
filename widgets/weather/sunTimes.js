import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import Soup from 'gi://Soup?version=3.0';
import { loadLastGoodCache, saveLastGoodCache, formatSnapshotAge } from '../../utils/lastGoodCache.js';
import { HTTP_STATUS_OK, createGetMessage } from '../../utils/httpClient.js';
import {
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    parseCssColor,
    resolveExplicitFontFamily,
    resolveWidgetCornerRadius,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    buildBaseWidgetStyle,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    registerWidgetCleanup,
    attachResponsiveScaler,
    startPollingTimer,
    startMinuteAlignedTimer,
    connectTimerCleanup,
} from '../../shell/widgetUIUtils.js';
import { createBackgroundImageActor, getWeatherAssets, resolveConditionCode, wmoToWeatherApiCode, isCancelledError } from './weatherCommon.js';
import { moonIllumination, moonSetMinutes } from '../../utils/moonTimes.js';
import {
    TYPOGRAPHY_SIZE,
    TYPOGRAPHY_WEIGHT,
    TEXT_OPACITY,
    GRAPHICS_OPACITY,
    clampWidgetScale,
    createWidgetMetrics,
} from '../../utils/typography.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const CLUTTER_OPACITY_OPAQUE = 255;
const REF_WIDTH_PX = 280;
const REF_HEIGHT_PX = 210;

const CONTENT_PADDING_X_PX = 14;
const CONTENT_PADDING_TOP_PX = 10;
const CONTENT_SPACING_PX = 3;
const HEADER_SPACING_PX = 8;

const HEADER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const HEADER_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const EVENT_LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const EVENT_TIME_FONT_SIZE_PX = 34;
const EVENT_TIME_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.bold;
const COUNTDOWN_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const MOON_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const MOON_GLYPH_SIZE_PX = 15;
const MOON_ROW_SPACING_PX = 6;

const FOOTER_FONT_SIZE_PX = 10;
const FOOTER_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const FOOTER_PADDING_BOTTOM_PX = 8;
const FOOTER_ICON_SPACING_PX = 4;
const FOOTER_ICON_SIZE_PX = 12;
const BAND_HEIGHT_RATIO = 0.38;

const ARC_MARGIN_X_RATIO = 0.055;
const ARC_LINE_WIDTH_PX = 2.6;
const ARC_TRACK_WIDTH_PX = 2;
const ORB_RADIUS_PX = 5;
const GLOW_RADIUS_FACTOR = 2.8;
const GLOW_INNER_ALPHA = 0.55;
const ARC_SEGMENT_COUNT = 64;
const DASH_ON_PX = 3;
const DASH_OFF_PX = 4;
const BAND_DARKEN_ALPHA = 0.16;
const MOON_SHADOW_ALPHA = 0.32;

const MIN_DAY_LENGTH_MINUTES = 9 * 60;
const MAX_DAY_LENGTH_MINUTES = 15 * 60;
const MIN_ARCH_HEIGHT_FACTOR = 0.5;
const MAX_ARCH_HEIGHT_FACTOR = 0.9;

const MINUTES_PER_DAY = 1440;
const MILLISECONDS_PER_DAY = 86400000;
const SECONDS_PER_HOUR = 3600;

const SUN_CORE_COLOR = '#fff2c0';
const SUN_GLOW_COLOR = '#ffb547';

const DEFAULT_CONDITION_CODE = 1000;

const SUN_TIMES_REFRESH_SECONDS = 6 * SECONDS_PER_HOUR;
const UI_TICK_INTERVAL_MS = 30000;
const SUN_TIMES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SUN_TIMES_REQUEST_TIMEOUT_SECONDS = 30;
const LOCATION_TOLERANCE = 0.0001;
const decoder = new TextDecoder();

function nowMinutesOfDay() {
    const now = GLib.DateTime.new_now_local();
    return now.get_hour() * 60 + now.get_minute();
}

function systemUtcOffsetSeconds() {
    return GLib.DateTime.new_now_local().get_utc_offset() / GLib.USEC_PER_SEC;
}

function nowInLocationMinutes(offsetShiftMinutes) {
    const total = nowMinutesOfDay() + offsetShiftMinutes;
    return ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function formatClock(totalMinutes) {
    const minutes = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(minutes / 60) % 24;
    return `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

function formatCountdown(deltaMinutes) {
    const abs = Math.abs(deltaMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    const time = hours === 0
        ? `${minutes}m`
        : `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    return deltaMinutes > 0 ? `In ${time}` : `${time} ago`;
}

function locationDateParts(offsetShiftMinutes) {
    const shifted = GLib.DateTime.new_now_local().add_seconds(offsetShiftMinutes * 60);
    return { year: shifted.get_year(), month: shifted.get_month(), day: shifted.get_day_of_month() };
}

/** UTC instant of this location's local midnight, for the moon-position scan. */
function locationMidnightEpochMs(offsetShiftMinutes) {
    const { year, month, day } = locationDateParts(offsetShiftMinutes);
    const locationOffsetMinutes = offsetShiftMinutes + systemUtcOffsetSeconds() / 60;
    return Date.UTC(year, month - 1, day) - locationOffsetMinutes * 60000;
}

function setDash(context, onLength, offLength, scale) {
    context.setDash([Math.max(1, onLength * scale), Math.max(1, offLength * scale)], 0);
}

function clearDash(context) {
    context.setDash([], 0);
}

function drawGlowOrb(context, x, y, radius, core, glow) {
    const gradient = new Cairo.RadialGradient(x, y, radius * 0.15, x, y, radius * GLOW_RADIUS_FACTOR);
    gradient.addColorStopRGBA(0, glow.r, glow.g, glow.b, GLOW_INNER_ALPHA);
    gradient.addColorStopRGBA(1, glow.r, glow.g, glow.b, 0);
    context.setSource(gradient);
    context.newSubPath();
    context.arc(x, y, radius * GLOW_RADIUS_FACTOR, 0, 2 * Math.PI);
    context.fill();

    context.setSourceRGBA(core.r, core.g, core.b, 1);
    context.newSubPath();
    context.arc(x, y, radius, 0, 2 * Math.PI);
    context.fill();
}

/**
 * Paints the horizon band and, while the sun is up, its path across the sky.
 *
 * `progress` is the travelled fraction of the day. `showPath` false leaves the band on
 * its own, which is what the widget does once the sun has set.
 */
export function drawSunScene(context, options) {
    const {
        width, height, scale, cornerRadius, bandRatio,
        trackColor, arcColor, progress, archFactor, orbColor,
        showPath = true,
    } = options;

    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);
    if (width <= 0 || height <= 0)
        return;

    const { px } = createWidgetMetrics(scale);
    const bandHeight = Math.max(1, height * bandRatio);
    const baselineY = height - bandHeight;
    const corner = Math.max(0, Math.min(cornerRadius, bandHeight));

    context.newSubPath();
    context.moveTo(0, baselineY);
    context.lineTo(width, baselineY);
    context.arc(width - corner, height - corner, corner, 0, Math.PI / 2);
    context.arc(corner, height - corner, corner, Math.PI / 2, Math.PI);
    context.closePath();
    context.setSourceRGBA(0, 0, 0, BAND_DARKEN_ALPHA);
    context.fill();

    const lineWidth = px(ARC_LINE_WIDTH_PX);
    const trackWidth = px(ARC_TRACK_WIDTH_PX);
    const orbRadius = px(ORB_RADIUS_PX);
    const marginX = width * ARC_MARGIN_X_RATIO;
    const leftX = marginX + lineWidth / 2;
    const rightX = width - marginX - lineWidth / 2;
    const spanX = Math.max(1, rightX - leftX);
    const archRadiusY = Math.max(1, (baselineY - lineWidth) * archFactor);
    // The feet land exactly on the footer's top edge, so the arch rises out of the band.
    const archYAt = t => baselineY - archRadiusY * Math.sin(Math.PI * t);

    context.setLineCap(Cairo.LineCap.ROUND);

    const traceArch = (startT, endT) => {
        context.newSubPath();
        for (let i = 0; i <= ARC_SEGMENT_COUNT; i++) {
            const t = startT + ((endT - startT) * i) / ARC_SEGMENT_COUNT;
            context.lineTo(leftX + t * spanX, archYAt(t));
        }
        context.stroke();
    };

    if (showPath) {
        const clampedProgress = Math.max(0, Math.min(1, progress ?? 0));

        // Remaining path, dashed and faint, so it reads as yet to come.
        context.setSourceRGBA(trackColor.r, trackColor.g, trackColor.b, GRAPHICS_OPACITY.arcTrack);
        context.setLineWidth(trackWidth);
        setDash(context, DASH_ON_PX, DASH_OFF_PX, scale);
        traceArch(clampedProgress, 1);
        clearDash(context);

        context.setSourceRGBA(arcColor.r, arcColor.g, arcColor.b, 1);
        context.setLineWidth(lineWidth);
        traceArch(0, clampedProgress);

        const orbX = leftX + clampedProgress * spanX;
        drawGlowOrb(context, orbX, archYAt(clampedProgress), orbRadius, orbColor.core, orbColor.glow);
    }
}

/** Paints the moon disc with its lit fraction on the correct limb. */
export function drawMoonGlyph(context, size, fraction, waxing, color) {
    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);
    if (size <= 0)
        return;

    const center = size / 2;
    const radius = Math.max(1, size / 2 - 1);

    context.setSourceRGBA(color.r, color.g, color.b, MOON_SHADOW_ALPHA);
    context.newSubPath();
    context.arc(center, center, radius, 0, 2 * Math.PI);
    context.fill();

    const lit = Math.max(0, Math.min(1, fraction));
    const gibbous = lit > 0.5;
    const terminatorRatio = Math.abs(2 * lit - 1);

    context.newSubPath();
    // Lit limb: the right half while waxing, the left while waning.
    if (waxing)
        context.arc(center, center, radius, -Math.PI / 2, Math.PI / 2);
    else
        context.arcNegative(center, center, radius, -Math.PI / 2, Math.PI / 2);
    // Terminator: an ellipse whose width collapses to nothing at new and full.
    context.save();
    context.translate(center, center);
    context.scale(Math.max(0.0001, terminatorRatio), 1);
    if (waxing !== gibbous)
        context.arcNegative(0, 0, radius, Math.PI / 2, -Math.PI / 2);
    else
        context.arc(0, 0, radius, Math.PI / 2, -Math.PI / 2);
    context.restore();
    context.closePath();
    context.setSourceRGBA(color.r, color.g, color.b, 1);
    context.fill();
}

export function createSunTimesNode(config, width, height, xPosition, yPosition, isDynamicColor = true, isDynamicImage = true) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const baseStyle = buildBaseWidgetStyle(config);
    const cornerRadius = resolveWidgetCornerRadius(config);
    const sunCore = parseCssColor(SUN_CORE_COLOR);
    const sunGlow = parseCssColor(SUN_GLOW_COLOR);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    // Start on the widget's own foreground so the placeholder text matches the theme
    // background; applyBackground switches to the gradient's contrast once data lands.
    let textColor = resolveWidgetForegroundColor(config);
    let textRgb = parseCssColor(textColor);

    let scale = clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    let offsetShiftMinutes = 0;
    let snapshotAgeText = '';
    let isDaylight = true;
    let sunriseEvent = null;
    let sunsetEvent = null;
    let dayStartMinutes = null;
    let dayEndMinutes = null;
    let moonFraction = 0;
    let moonWaxing = true;
    let moonsetMinutes = null;
    let conditionCode = DEFAULT_CONDITION_CODE;

    const hasLocation = Number.isFinite(config.latitude) && Number.isFinite(config.longitude);
    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    const clockState = { timerId: null };
    const session = new Soup.Session({ timeout: SUN_TIMES_REQUEST_TIMEOUT_SECONDS });

    const bgImageActor = createBackgroundImageActor(container);
    container.add_child(bgImageActor);

    const column = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true });
    container.add_child(column);

    const topBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
    column.add_child(topBox);

    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `spacing: ${HEADER_SPACING_PX}px;`,
    });
    const cityLabel = new St.Label({ text: config.city || 'Unknown location', x_expand: true });
    const clockLabel = new St.Label({ text: '--:--', x_align: Clutter.ActorAlign.END });
    headerRow.add_child(cityLabel);
    headerRow.add_child(clockLabel);
    topBox.add_child(headerRow);

    const eventLabel = new St.Label({ text: '' });
    topBox.add_child(eventLabel);

    const eventTimeLabel = new St.Label({ text: '--:--' });
    topBox.add_child(eventTimeLabel);

    const countdownLabel = new St.Label({ text: '' });
    topBox.add_child(countdownLabel);

    const moonRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: `spacing: ${MOON_ROW_SPACING_PX}px;`,
    });
    const moonGlyph = new St.DrawingArea({
        width: MOON_GLYPH_SIZE_PX,
        height: MOON_GLYPH_SIZE_PX,
        y_align: Clutter.ActorAlign.CENTER,
    });
    moonGlyph.connect('repaint', drawMoonCanvas);
    const moonLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    moonRow.add_child(moonGlyph);
    moonRow.add_child(moonLabel);
    topBox.add_child(moonRow);

    const arcSection = new St.Widget({ x_expand: true, y_expand: true, layout_manager: new Clutter.BinLayout() });
    column.add_child(arcSection);

    const arcCanvas = new St.DrawingArea({ x_expand: true, y_expand: true });
    arcCanvas.connect('repaint', drawArcCanvas);
    arcSection.add_child(arcCanvas);

    const footerBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true });
    footerBox.add_child(new St.Widget({ y_expand: true }));
    const footerRow = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    const footerSunriseGroup = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: `spacing: ${FOOTER_ICON_SPACING_PX}px;`,
    });
    const footerSunsetGroup = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: `spacing: ${FOOTER_ICON_SPACING_PX}px;`,
    });
    const footerSunriseIcon = new St.Icon({ icon_name: 'daytime-sunrise-symbolic' });
    const footerSunsetIcon = new St.Icon({ icon_name: 'daytime-sunset-symbolic' });
    const footerSunriseLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    const footerSunsetLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    footerSunriseGroup.add_child(footerSunriseIcon);
    footerSunriseGroup.add_child(footerSunriseLabel);
    footerSunsetGroup.add_child(footerSunsetIcon);
    footerSunsetGroup.add_child(footerSunsetLabel);
    footerRow.add_child(footerSunriseGroup);
    footerRow.add_child(new St.Widget({ x_expand: true }));
    footerRow.add_child(footerSunsetGroup);
    footerBox.add_child(footerRow);
    arcSection.add_child(footerBox);

    function archHeightFactor() {
        const span = MAX_DAY_LENGTH_MINUTES - MIN_DAY_LENGTH_MINUTES;
        const t = span > 0 ? (daylightMinutes() - MIN_DAY_LENGTH_MINUTES) / span : 1;
        const clamped = Math.max(0, Math.min(1, t));
        return MIN_ARCH_HEIGHT_FACTOR + clamped * (MAX_ARCH_HEIGHT_FACTOR - MIN_ARCH_HEIGHT_FACTOR);
    }

    function daylightMinutes() {
        if (dayStartMinutes !== null && dayEndMinutes !== null) {
            const length = ((dayEndMinutes - dayStartMinutes) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
            if (length > 0)
                return length;
        }
        return 12 * 60;
    }

    function sunProgress(now) {
        if (dayStartMinutes === null || dayEndMinutes === null || !isDaylight)
            return null;
        const length = ((dayEndMinutes - dayStartMinutes) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
        if (length <= 0)
            return null;
        return ((now - dayStartMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY) / length;
    }

    function drawArcCanvas(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            ctx.$dispose();
            return;
        }
        const now = nowInLocationMinutes(offsetShiftMinutes);
        drawSunScene(ctx, {
            width: canvasWidth,
            height: canvasHeight,
            scale,
            cornerRadius,
            bandRatio: BAND_HEIGHT_RATIO,
            trackColor: textRgb,
            arcColor: textRgb,
            progress: sunProgress(now),
            showPath: isDaylight,
            archFactor: archHeightFactor(),
            orbColor: { core: sunCore, glow: sunGlow },
        });
        ctx.$dispose();
    }

    function drawMoonCanvas(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            ctx.$dispose();
            return;
        }
        drawMoonGlyph(ctx, Math.min(canvasWidth, canvasHeight), moonFraction, moonWaxing, textRgb);
        ctx.$dispose();
    }

    function renderCityWithAge() {
        const name = GLib.markup_escape_text(String(config.city || 'Unknown location'), -1);
        if (!snapshotAgeText) {
            cityLabel.clutter_text.set_markup(name);
            return;
        }
        const age = GLib.markup_escape_text(snapshotAgeText, -1);
        cityLabel.clutter_text.set_markup(`${name} <span alpha="${Math.round(TEXT_OPACITY.metadata * 100)}%">· ${age}</span>`);
    }

    function eventDelta(event, now) {
        if (!event)
            return null;
        const eventDayIndex = Math.floor(Date.UTC(
            Number(event.dateStr.slice(0, 4)),
            Number(event.dateStr.slice(5, 7)) - 1,
            Number(event.dateStr.slice(8, 10))) / MILLISECONDS_PER_DAY);
        const parts = locationDateParts(offsetShiftMinutes);
        const todayDayIndex = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MILLISECONDS_PER_DAY);
        return (eventDayIndex - todayDayIndex) * MINUTES_PER_DAY + event.minutes - now;
    }

    function renderDynamic() {
        const now = nowInLocationMinutes(offsetShiftMinutes);
        renderCityWithAge();
        clockLabel.text = formatClock(now);

        const event = isDaylight ? sunsetEvent : sunriseEvent;
        eventLabel.text = isDaylight ? 'SUNSET' : 'SUNRISE';
        if (event) {
            eventTimeLabel.text = formatClock(event.minutes);
            const delta = eventDelta(event, now);
            countdownLabel.text = delta === null ? '' : formatCountdown(delta);
        } else {
            eventTimeLabel.text = '--:--';
            countdownLabel.text = hasLocation ? '' : 'Set location';
        }

        // "sets" while the moon is still up, "set" once it has dipped below the horizon.
        const moonsetVerb = moonsetMinutes !== null && now >= moonsetMinutes ? 'set' : 'sets';
        moonLabel.text = `Moon ${Math.round(moonFraction * 100)}%`
            + (moonsetMinutes === null ? '' : ` · ${moonsetVerb} ${formatClock(moonsetMinutes)}`);

        if (container.mapped) {
            arcCanvas.queue_repaint();
            moonGlyph.queue_repaint();
        }
    }

    function applyBackground(isDay) {
        const extensionPath = config.extensionPath || '';
        const assets = isDynamicColor || isDynamicImage
            ? getWeatherAssets(extensionPath, resolveConditionCode(conditionCode), isDay, '3x3')
            : null;

        if (isDynamicColor) {
            const bgStart = assets.bgStart;
            const bgEnd = assets.bgEnd || bgStart;
            textColor = isDarkBackgroundColor(bgEnd) ? '#ffffff' : '#000000';
            container.style = `background-gradient-direction: vertical;`
                + ` background-gradient-start: ${bgStart};`
                + ` background-gradient-end: ${bgEnd};`
                + ` color: ${textColor}; ${fontCss} ${baseStyle}`;
        } else {
            textColor = resolveWidgetForegroundColor(config);
            container.style = `background-color: ${resolveWidgetBackgroundColor(config)};`
                + ` color: ${textColor}; ${fontCss} ${baseStyle}`;
        }
        textRgb = parseCssColor(textColor);

        if (isDynamicImage && assets.bgImagePath) {
            bgImageActor.style = `background-image: url("${assets.bgImagePath}");`
                + ` background-size: cover; background-position: center;`
                + ` border-radius: ${cornerRadius}px;`;
            bgImageActor.show();
        } else {
            bgImageActor.hide();
        }
        applyLayout(scale);
    }

    function applyLayout(nextScale) {
        scale = nextScale;
        const { px } = createWidgetMetrics(scale);

        topBox.style = `padding: ${px(CONTENT_PADDING_TOP_PX)}px ${px(CONTENT_PADDING_X_PX)}px 0 ${px(CONTENT_PADDING_X_PX)}px;`
            + ` spacing: ${px(CONTENT_SPACING_PX)}px;`;

        const headerStyle = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(HEADER_FONT_SIZE_PX)}px;`
            + ` font-weight: ${HEADER_FONT_WEIGHT};`;
        cityLabel.style = headerStyle;
        clockLabel.style = headerStyle;
        clockLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.subtle);

        eventLabel.style = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(EVENT_LABEL_FONT_SIZE_PX)}px;`
            + ` font-weight: ${HEADER_FONT_WEIGHT}; letter-spacing: 1px;`;
        eventLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary);

        eventTimeLabel.style = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(EVENT_TIME_FONT_SIZE_PX)}px;`
            + ` font-weight: ${EVENT_TIME_FONT_WEIGHT};`;

        countdownLabel.style = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(COUNTDOWN_FONT_SIZE_PX)}px;`
            + ` font-weight: ${TYPOGRAPHY_WEIGHT.medium};`;
        countdownLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary);

        moonLabel.style = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(MOON_FONT_SIZE_PX)}px;`
            + ` font-weight: ${TYPOGRAPHY_WEIGHT.medium};`;
        moonLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.subtle);
        const glyphSize = px(MOON_GLYPH_SIZE_PX);
        moonGlyph.set_width(glyphSize);
        moonGlyph.set_height(glyphSize);

        footerRow.style = `padding: 0 ${px(CONTENT_PADDING_X_PX)}px ${px(FOOTER_PADDING_BOTTOM_PX)}px;`;
        const footerStyle = `${fontCss}color: ${textColor};`
            + ` font-size: ${px(FOOTER_FONT_SIZE_PX)}px;`
            + ` font-weight: ${FOOTER_FONT_WEIGHT};`;
        footerSunriseLabel.style = footerStyle;
        footerSunsetLabel.style = footerStyle;

        const footerIconSize = px(FOOTER_ICON_SIZE_PX);
        footerSunriseIcon.icon_size = footerIconSize;
        footerSunsetIcon.icon_size = footerIconSize;
        footerSunriseIcon.style = `color: ${textColor};`;
        footerSunsetIcon.style = `color: ${textColor};`;
        footerSunriseGroup.style = `spacing: ${px(FOOTER_ICON_SPACING_PX)}px;`;
        footerSunsetGroup.style = `spacing: ${px(FOOTER_ICON_SPACING_PX)}px;`;

        renderDynamic();
    }

    applyLayout(scale);

    if (hasLocation && config.id) {
        loadLastGoodCache('sun-schedule', config.id, (payload, savedAtMs) => {
            if (isActorDestroyed(container) || !payload)
                return;
            if (Math.abs(payload.lat - config.latitude) > LOCATION_TOLERANCE
                || Math.abs(payload.lon - config.longitude) > LOCATION_TOLERANCE)
                return;
            restoreSchedule(payload);
            snapshotAgeText = formatSnapshotAge(savedAtMs);
            applyBackground(isDaylight);
        }, SUN_TIMES_CACHE_MAX_AGE_MS);
    }

    function restoreSchedule(payload) {
        offsetShiftMinutes = payload.offsetShiftMinutes || 0;
        isDaylight = payload.isDaylight !== false;
        sunriseEvent = payload.sunriseEvent || null;
        sunsetEvent = payload.sunsetEvent || null;
        dayStartMinutes = Number.isFinite(payload.dayStartMinutes) ? payload.dayStartMinutes : null;
        dayEndMinutes = Number.isFinite(payload.dayEndMinutes) ? payload.dayEndMinutes : null;
        conditionCode = Number.isFinite(payload.conditionCode) ? payload.conditionCode : DEFAULT_CONDITION_CODE;
        updateMoon();
        updateFooter();
    }

    function updateFooter() {
        footerSunriseLabel.text = sunriseEvent ? formatClock(sunriseEvent.minutes) : '--:--';
        footerSunsetLabel.text = sunsetEvent ? formatClock(sunsetEvent.minutes) : '--:--';
    }

    function updateMoon() {
        if (!hasLocation) {
            moonFraction = 0;
            moonsetMinutes = null;
            return;
        }
        const illumination = moonIllumination(Date.now());
        moonFraction = illumination.fraction;
        moonWaxing = illumination.waxing;
        moonsetMinutes = moonSetMinutes(config.latitude, config.longitude, locationMidnightEpochMs(offsetShiftMinutes));
    }

    function isoToMinutes(isoString) {
        if (typeof isoString !== 'string') return null;
        const match = isoString.slice(11, 16).match(/^(\d{2}):(\d{2})$/);
        if (!match) return null;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    function fetchSunTimes() {
        if (!hasLocation || isActorDestroyed(container)) return;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}`
            + `&longitude=${config.longitude}&daily=sunrise,sunset&current=weather_code,is_day&timezone=auto&forecast_days=3&previous_day=1`;
        const message = createGetMessage(url);
        if (!message) {
            console.error('Gridgets: sun times request could not be created');
            return;
        }
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (sourceObject, result) => {
            if (isActorDestroyed(container)) return;
            try {
                const bytes = sourceObject.send_and_read_finish(result);
                if (message.get_status() !== HTTP_STATUS_OK) {
                    console.error(`Gridgets: sun times request failed with HTTP ${message.get_status()}`);
                    return;
                }
                if (!bytes || bytes.get_size() === 0) {
                    console.error('Gridgets: sun times response was empty');
                    return;
                }
                const payload = JSON.parse(decoder.decode(bytes.get_data()));
                applyFetchResult(payload);
            } catch (error) {
                if (isCancelledError(error))
                    return;
                console.error('Gridgets: could not refresh sun times:', error.message);
            }
        });
    }

    function applyFetchResult(payload) {
        const daily = payload && payload.daily ? payload.daily : {};
        const current = payload && payload.current ? payload.current : {};

        const locationOffsetSeconds = Number.isFinite(payload.utc_offset_seconds)
            ? payload.utc_offset_seconds
            : systemUtcOffsetSeconds();
        offsetShiftMinutes = (locationOffsetSeconds - systemUtcOffsetSeconds()) / 60;

        const now = nowInLocationMinutes(offsetShiftMinutes);
        const todayStr = GLib.DateTime.new_now_local().add_seconds(offsetShiftMinutes * 60).format('%Y-%m-%d');

        const findEvent = (series, isPast) => {
            if (!Array.isArray(series)) return null;
            const indices = isPast
                ? Array.from({ length: series.length }, (_unused, index) => series.length - 1 - index)
                : series.keys();
            for (const i of indices) {
                const minutes = isoToMinutes(series[i]);
                const dateStr = isoToDateString(series[i]);
                if (minutes === null || dateStr === null) continue;
                const isPastEntry = dateStr < todayStr
                    || (dateStr === todayStr && minutes <= now);
                if (isPastEntry === isPast)
                    return { dateStr, minutes };
            }
            return null;
        };

        const lastSunrise = findEvent(daily.sunrise, true);
        const nextSunset = findEvent(daily.sunset, false);
        const nextSunrise = findEvent(daily.sunrise, false);
        const lastSunset = findEvent(daily.sunset, true);

        isDaylight = lastSunrise !== null && nextSunset !== null
            && now >= lastSunrise.minutes && now < nextSunset.minutes;

        if (isDaylight) {
            sunriseEvent = lastSunrise;
            sunsetEvent = nextSunset;
            dayStartMinutes = lastSunrise.minutes;
            dayEndMinutes = nextSunset.minutes;
        } else {
            sunriseEvent = nextSunrise;
            sunsetEvent = lastSunset;
            dayStartMinutes = nextSunrise ? nextSunrise.minutes : null;
            dayEndMinutes = nextSunset ? nextSunset.minutes : null;
        }

        if (sunriseEvent === null) {
            const first = daily.sunrise && daily.sunrise[0];
            const minutes = isoToMinutes(first);
            if (minutes !== null) sunriseEvent = { dateStr: todayStr, minutes };
        }
        if (sunsetEvent === null) {
            const first = daily.sunset && daily.sunset[0];
            const minutes = isoToMinutes(first);
            if (minutes !== null) sunsetEvent = { dateStr: todayStr, minutes };
        }

        conditionCode = wmoToWeatherApiCode(Number.isFinite(current.weather_code) ? current.weather_code : 0);

        saveLastGoodCache('sun-schedule', config.id, {
            lat: config.latitude,
            lon: config.longitude,
            offsetShiftMinutes,
            isDaylight,
            sunriseEvent,
            sunsetEvent,
            dayStartMinutes,
            dayEndMinutes,
            conditionCode,
        });

        snapshotAgeText = '';
        updateMoon();
        updateFooter();
        applyBackground(isDaylight);
    }

    function isoToDateString(isoString) {
        if (typeof isoString !== 'string') return null;
        return isoString.slice(0, 10);
    }

    // Defer the first paint until the actors are mapped, avoiding allocation warnings.
    if (container.mapped) {
        renderDynamic();
    } else {
        const mappedId = container.connect('notify::mapped', () => {
            container.disconnect(mappedId);
            if (!isActorDestroyed(container))
                renderDynamic();
        });
    }

    connectTimerCleanup(container, state, ['timerId', 'refreshTimerId']);
    connectTimerCleanup(container, clockState, ['timerId']);
    registerWidgetCleanup(container, () => {
        session.abort();
        state.cancellable.cancel();
        for (const signalId of bgImageActor.backgroundSignalIds || [])
            container.disconnect(signalId);
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (nextScale) => {
        if (isActorDestroyed(container)) return;
        applyLayout(nextScale);
    });

    startPollingTimer(renderDynamic, UI_TICK_INTERVAL_MS, state);
    startMinuteAlignedTimer(clockState, container, renderDynamic);
    fetchSunTimes();
    if (hasLocation) {
        state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SUN_TIMES_REFRESH_SECONDS, () => {
            fetchSunTimes();
            return GLib.SOURCE_CONTINUE;
        });
    }

    return container;
}
