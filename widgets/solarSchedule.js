import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import Soup from 'gi://Soup?version=3.0';
import { CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER, SECONDARY_OPACITY, cssColorToRgba, parseCssColor, resolveExplicitFontFamily, resolveWidgetBackgroundColor, resolveWidgetForegroundColor } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, startPollingTimer, connectTimerCleanup } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 240;
const CONTAINER_PADDING_V_PX = 18;
const CONTAINER_PADDING_H_PX = 20;
const HEADER_FONT_SIZE_PX = 14;
const TIME_FONT_SIZE_PX = 15;
const STATUS_FONT_SIZE_PX = 11;
const METRIC_ICON_SIZE_PX = 18;
const ARC_MARGIN_X_RATIO = 0.1;
const ARC_BASE_PADDING_RATIO = 0.18;
const ARC_SEGMENT_COUNT = 64;
const ORB_RADIUS_PX = 5;
const REFERENCE_DAY_MINUTES = 720;
const MIN_ARCH_HEIGHT_FACTOR = 0.3;
const GAUSS_EDGE_FALLOFF = 0.07;
const ARCH_SIGMA_SPAN_FRACTION = 0.5 / Math.sqrt(2 * Math.log(1 / GAUSS_EDGE_FALLOFF));
const ARC_TRACK_ALPHA = 0.15;
const BORDER_ALPHA = 0.14;

const SUNRISE_ICON_NAME = 'daytime-sunrise-symbolic';
const SUNSET_ICON_NAME = 'daytime-sunset-symbolic';

const UI_TICK_INTERVAL_MS = 30000;
const SCHEDULE_REFRESH_SECONDS = 6 * 3600;
const HTTP_STATUS_OK = 200;
const decoder = new TextDecoder();

function nowMinutesOfDay() {
    const now = GLib.DateTime.new_now_local();
    return now.get_hour() * 60 + now.get_minute();
}

function todayLocationDateStr(offsetShiftMinutes) {
    const now = GLib.DateTime.new_now_local();
    const shifted = now.add_seconds(offsetShiftMinutes * 60);
    return shifted.format('%Y-%m-%d');
}

function isoToDateString(isoString) {
    if (typeof isoString !== 'string') return null;
    return isoString.slice(0, 10);
}

function _dateToDayIndex(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return 0;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return 0;
    const [y, m, d] = parts.map(Number);
    return y * 366 + m * 31 + d;
}

function formatClock(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
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

// Extracts minutes-since-midnight from an Open-Meteo ISO local string.
function isoToMinutes(isoString) {
    if (typeof isoString !== 'string') return null;
    const timePart = isoString.slice(11, 16);
    const match = timePart.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

// Current time expressed in the forecast location's wall-clock minutes,
// computed by shifting the system's local minutes by the timezone offset
// difference between the location and the system.
function nowInLocationMinutes(locationOffsetShiftMinutes) {
    const systemMinutes = nowMinutesOfDay();
    let locMinutes = systemMinutes + locationOffsetShiftMinutes;
    return ((locMinutes % 1440) + 1440) % 1440;
}

function systemUtcOffsetSeconds() {
    return GLib.DateTime.new_now_local().get_utc_offset() / GLib.USEC_PER_SEC;
}

export function createSunScheduleNode(config, width, height, xPosition, yPosition) {
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 0;
    const accentHex = config.globalAccentColor || '#3584e4';
    const accent = parseCssColor(accentHex);
    const textRgb = parseCssColor(textColor);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    let sunriseEvent = null; // {dateStr, minutes} or null — nearest sunrise for display
    let sunsetEvent = null;  // {dateStr, minutes} or null — nearest sunset for display
    let arcSunriseMinutes = null; // today's sunrise minutes for arc rendering
    let arcSunsetMinutes = null;  // today's sunset minutes for arc rendering
    let offsetShiftMinutes = 0;

    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    const session = new Soup.Session();

    const hasLocation = Number.isFinite(config.latitude) && Number.isFinite(config.longitude);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const cityLabel = new St.Label({
        text: config.city || 'Unknown location',
        x_expand: true,
    });
    mainBox.add_child(cityLabel);

    const arcCanvas = new St.DrawingArea({ x_expand: true, y_expand: true });
    arcCanvas.connect('repaint', drawArcCanvas);
    mainBox.add_child(arcCanvas);

    const separator = new St.Widget({ x_expand: true, style: 'height: 1px;' });
    mainBox.add_child(separator);

    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    const buildMetricItem = (iconName) => {
        const itemBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style: 'spacing: 8px;',
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: METRIC_ICON_SIZE_PX,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const infoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'spacing: 1px;',
        });
        const timeLabel = new St.Label({ text: '--:--' });
        const statusLabel = new St.Label({ text: '' });
        infoBox.add_child(timeLabel);
        infoBox.add_child(statusLabel);
        itemBox.add_child(icon);
        itemBox.add_child(infoBox);
        return { itemBox, icon, timeLabel, statusLabel };
    };

    const sunriseItem = buildMetricItem(SUNRISE_ICON_NAME);
    const sunsetItem = buildMetricItem(SUNSET_ICON_NAME);
    const footerSpacer = new St.Widget({ x_expand: true });
    footerBox.add_child(sunriseItem.itemBox);
    footerBox.add_child(footerSpacer);
    footerBox.add_child(sunsetItem.itemBox);
    mainBox.add_child(footerBox);

    function updateMetric(item, event, nowMinutes) {
        if (!event) {
            item.timeLabel.text = '--:--';
            item.statusLabel.text = '';
            return;
        }
        item.timeLabel.text = formatClock(event.minutes);
        const todayStr = todayLocationDateStr(offsetShiftMinutes);
        const dateDiff = _dateToDayIndex(event.dateStr) - _dateToDayIndex(todayStr);
        const delta = dateDiff * 1440 + event.minutes - nowMinutes;
        item.statusLabel.text = formatCountdown(delta);
    }

    function renderDynamic() {
        const now = nowInLocationMinutes(offsetShiftMinutes);
        updateMetric(sunriseItem, sunriseEvent, now);
        updateMetric(sunsetItem, sunsetEvent, now);
        if (!hasLocation)
            sunsetItem.statusLabel.text = 'Set location';
        if (container.mapped)
            arcCanvas.queue_repaint();
    }

    function sunProgress() {
        if (arcSunriseMinutes === null || arcSunsetMinutes === null || arcSunsetMinutes <= arcSunriseMinutes)
            return null;
        const now = nowInLocationMinutes(offsetShiftMinutes);
        if (now <= arcSunriseMinutes || now >= arcSunsetMinutes)
            return null;
        return (now - arcSunriseMinutes) / (arcSunsetMinutes - arcSunriseMinutes);
    }

    /**
     * The arch always spans the same fixed, centered base. The city's day
     * length only sets the height: 12h of daylight is the full-height
     * baseline, shorter days render lower, longer days cap at full height.
     */
    function archHeightFactor() {
        const { dayLength } = daylightWindow();
        return Math.max(MIN_ARCH_HEIGHT_FACTOR, Math.min(1, dayLength / REFERENCE_DAY_MINUTES));
    }

    function traceArch(ctx, leftX, spanX, baseY, radiusY, startT, endT) {
        ctx.newSubPath();
        for (let i = 0; i <= ARC_SEGMENT_COUNT; i++) {
            const t = startT + ((endT - startT) * i) / ARC_SEGMENT_COUNT;
            const x = leftX + t * spanX;
            const y = baseY - radiusY * Math.exp(-((t - 0.5) ** 2) / (2 * ARCH_SIGMA_SPAN_FRACTION * ARCH_SIGMA_SPAN_FRACTION));
            if (i === 0)
                ctx.moveTo(x, y);
            else
                ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function daylightWindow() {
        if (arcSunriseMinutes !== null && arcSunsetMinutes !== null && arcSunsetMinutes > arcSunriseMinutes)
            return { dayLength: arcSunsetMinutes - arcSunriseMinutes };
        // placeholder full-height arch until a real schedule arrives
        return { dayLength: REFERENCE_DAY_MINUTES };
    }

    function isNight() {
        if (arcSunriseMinutes === null || arcSunsetMinutes === null)
            return false;
        const now = nowInLocationMinutes(offsetShiftMinutes);
        return now < arcSunriseMinutes || now > arcSunsetMinutes;
    }

    function drawArcCanvas(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const marginX = canvasWidth * ARC_MARGIN_X_RATIO;
        const basePadding = canvasHeight * ARC_BASE_PADDING_RATIO;
        const lineWidth = Math.max(1, Math.round(3 * scale));
        const trackWidth = Math.max(1, Math.round(2 * scale));
        const leftX = marginX + lineWidth + 1;
        const rightX = canvasWidth - marginX - lineWidth - 1;
        const spanX = Math.max(1, rightX - leftX);
        const availableHeight = canvasHeight - basePadding - lineWidth - 1;
        const radiusY = Math.max(1, availableHeight * archHeightFactor());
        const baseY = canvasHeight - basePadding;

        // after sundown the arch switches from muted text to the accent color
        const bellColor = isNight() ? accent : textRgb;

        ctx.setLineCap(Cairo.LineCap.ROUND);

        ctx.setSourceRGBA(bellColor.r, bellColor.g, bellColor.b, ARC_TRACK_ALPHA);
        ctx.setLineWidth(trackWidth);
        traceArch(ctx, leftX, spanX, baseY, radiusY, 0, 1);

        const progress = sunProgress();
        if (progress !== null) {
            ctx.setSourceRGBA(accent.r, accent.g, accent.b, 1);
            ctx.setLineWidth(lineWidth);
            traceArch(ctx, leftX, spanX, baseY, radiusY, 0, progress);

            const orbX = leftX + progress * spanX;
            const orbY = baseY - radiusY * Math.exp(-((progress - 0.5) ** 2) / (2 * ARCH_SIGMA_SPAN_FRACTION * ARCH_SIGMA_SPAN_FRACTION));
            const orbRadius = ORB_RADIUS_PX * scale;

            ctx.setSourceRGBA(accent.r, accent.g, accent.b, 1);
            ctx.newSubPath();
            ctx.arc(orbX, orbY, orbRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
        ctx.$dispose();
    }

    // Defer first repaint until the DrawingArea is mapped to the stage,
    // avoiding Clutter "needs an allocation" warnings.
    if (container.mapped) {
        renderDynamic();
    } else {
        const mappedId = container.connect('notify::mapped', () => {
            container.disconnect(mappedId);
            if (!isActorDestroyed(container))
                renderDynamic();
        });
    }

    function fetchSchedule() {
        if (!hasLocation || isActorDestroyed(container)) return;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}`
            + `&longitude=${config.longitude}&daily=sunrise,sunset&timezone=auto&forecast_days=3&previous_day=1`;
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (sourceObject, result) => {
            if (isActorDestroyed(container)) return;
            try {
                if (message.get_status() !== HTTP_STATUS_OK) return;
                const bytes = sourceObject.send_and_read_finish(result);
                if (!bytes || bytes.get_size() === 0) return;
                const payload = JSON.parse(decoder.decode(bytes.get_data()));
                const daily = payload && payload.daily ? payload.daily : {};

                const locationOffsetSeconds = Number.isFinite(payload.utc_offset_seconds)
                    ? payload.utc_offset_seconds
                    : systemUtcOffsetSeconds();
                offsetShiftMinutes = (locationOffsetSeconds - systemUtcOffsetSeconds()) / 60;

                const now = nowInLocationMinutes(offsetShiftMinutes);
                const todayStr = todayLocationDateStr(offsetShiftMinutes);

                // Find most recent passed sunrise
                let lastSunrise = null;
                for (let i = daily.sunrise ? daily.sunrise.length - 1 : -1; i >= 0; i--) {
                    const riseMin = isoToMinutes(daily.sunrise[i]);
                    const riseDate = isoToDateString(daily.sunrise[i]);
                    if (riseMin === null || riseDate === null) continue;
                    if (riseDate < todayStr || (riseDate === todayStr && riseMin <= now)) {
                        lastSunrise = {dateStr: riseDate, minutes: riseMin};
                        break;
                    }
                }

                // Find next future sunset
                let nextSunset = null;
                for (let i = 0; i < (daily.sunset ? daily.sunset.length : 0); i++) {
                    const setMin = isoToMinutes(daily.sunset[i]);
                    const setDate = isoToDateString(daily.sunset[i]);
                    if (setMin === null || setDate === null) continue;
                    if (setDate > todayStr || (setDate === todayStr && setMin > now)) {
                        nextSunset = {dateStr: setDate, minutes: setMin};
                        break;
                    }
                }

                // Find next future sunrise
                let nextSunrise = null;
                for (let i = 0; i < (daily.sunrise ? daily.sunrise.length : 0); i++) {
                    const riseMin = isoToMinutes(daily.sunrise[i]);
                    const riseDate = isoToDateString(daily.sunrise[i]);
                    if (riseMin === null || riseDate === null) continue;
                    if (riseDate > todayStr || (riseDate === todayStr && riseMin > now)) {
                        nextSunrise = {dateStr: riseDate, minutes: riseMin};
                        break;
                    }
                }

                // Find most recent passed sunset
                let lastSunset = null;
                for (let i = daily.sunset ? daily.sunset.length - 1 : -1; i >= 0; i--) {
                    const setMin = isoToMinutes(daily.sunset[i]);
                    const setDate = isoToDateString(daily.sunset[i]);
                    if (setMin === null || setDate === null) continue;
                    if (setDate < todayStr || (setDate === todayStr && setMin <= now)) {
                        lastSunset = {dateStr: setDate, minutes: setMin};
                        break;
                    }
                }

                // Daylight = now falls between a past sunrise and a future sunset.
                const isDaylight = lastSunrise !== null && nextSunset !== null
                    && now >= lastSunrise.minutes && now < nextSunset.minutes;

                if (isDaylight) {
                    sunriseEvent = lastSunrise;
                    sunsetEvent = nextSunset;
                } else {
                    sunsetEvent = lastSunset;
                    sunriseEvent = nextSunrise;
                }

                // Arc always uses today's sunrise/sunset (same day for correct progress calc).
                if (isDaylight) {
                    arcSunriseMinutes = lastSunrise ? lastSunrise.minutes : null;
                    arcSunsetMinutes = nextSunset ? nextSunset.minutes : null;
                } else {
                    arcSunriseMinutes = nextSunrise ? nextSunrise.minutes : null;
                    arcSunsetMinutes = nextSunset ? nextSunset.minutes : null;
                }

                // Fallback: if a directional search returned null, use any
                // available value from the API so the display never shows --:--.
                if (sunriseEvent === null) {
                    const first = daily.sunrise && daily.sunrise[0];
                    const m = isoToMinutes(first);
                    if (m !== null) sunriseEvent = {dateStr: todayStr, minutes: m};
                }
                if (sunsetEvent === null) {
                    const first = daily.sunset && daily.sunset[0];
                    const m = isoToMinutes(first);
                    if (m !== null) sunsetEvent = {dateStr: todayStr, minutes: m};
                }

                renderDynamic();
            } catch (_err) {
                /* keep previous schedule until the next refresh */
            }
        });
    }

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        if (state.refreshTimerId) {
            GLib.Source.remove(state.refreshTimerId);
            state.refreshTimerId = null;
        }
        session.abort();
        state.cancellable.cancel();
    });

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = (v) => Math.max(1, Math.round(v * scale));

        container.style = `${fontCss}background-color: ${bgColor}; border-radius: ${borderRadius}px;`
            + `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px;`
            + `border: 1px solid ${textRgba(BORDER_ALPHA)};`;

        cityLabel.style = `${fontCss}font-size: ${px(HEADER_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        separator.style = `height: 1px; background-color: ${textRgba(0.12)}; margin: ${px(6)}px 0;`;

        for (const item of [sunriseItem, sunsetItem]) {
            item.icon.style = `color: ${textColor}; opacity: 0.7;`;
            item.icon.set_icon_size(px(METRIC_ICON_SIZE_PX));
            item.timeLabel.style = `${fontCss}font-size: ${px(TIME_FONT_SIZE_PX)}px;`
                + `color: ${textColor};`;
            item.statusLabel.style = `${fontCss}font-size: ${px(STATUS_FONT_SIZE_PX)}px;`
                + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        }

        mainBox.style = `spacing: ${px(6)}px;`;

        renderDynamic();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    startPollingTimer(renderDynamic, UI_TICK_INTERVAL_MS, state);
    fetchSchedule();
    if (hasLocation) {
        state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SCHEDULE_REFRESH_SECONDS, () => {
            fetchSchedule();
            return GLib.SOURCE_CONTINUE;
        });
    }

    return container;
}
