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
    resolveWidgetForegroundColor,
    resolveAccentColor } from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, startPollingTimer, connectTimerCleanup } from '../../shell/widgetUIUtils.js';
import { WEATHER_METADATA_OPACITY, WEATHER_SUBTLE_OPACITY, isCancelledError } from './weatherCommon.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, MIN_FONT_SIZE, ICON_OPACITY_SECONDARY, GRAPHICS_OPACITY, TEXT_OPACITY, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 240;
const CONTAINER_PADDING_V_PX = 18;
const CONTAINER_PADDING_H_PX = 20;
const MAIN_BOX_SPACING_PX = 6;
// The city labels the times, so it sits below them in the scale.
const HEADER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const HEADER_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const TIME_FONT_SIZE_PX = TYPOGRAPHY_SIZE.displayMD;
const TIME_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.bold;
// Graded between the city and the times: the countdown is the part that changes.
const STATUS_FONT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const STATUS_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.medium;
const DIVIDER_MARGIN_VERTICAL_PX = 8;
const METRIC_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconMd;
const ARC_MARGIN_X_RATIO = 0.04;
// Shared by the day arc and the night dip so the orb does not jump when they swap.
const BASELINE_RATIO = 0.66;
const ARC_SEGMENT_COUNT = 64;
const ARC_LINE_WIDTH_PX = 3;
const ARC_TRACK_WIDTH_PX = 2;
const ORB_RADIUS_PX = 5;
const METRIC_ITEM_SPACING_PX = 8;
const METRIC_TEXT_SPACING_PX = 1;
const REFERENCE_DAY_MINUTES = 720;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MILLISECONDS_PER_DAY = 86400000;
// Day length drives arch height; the span is fixed, so this range sets the spread.
const MIN_DAY_LENGTH_MINUTES = 9 * MINUTES_PER_HOUR;
const MAX_DAY_LENGTH_MINUTES = 15 * MINUTES_PER_HOUR;
const MIN_ARCH_HEIGHT_FACTOR = 0.45;
const MAX_ARCH_HEIGHT_FACTOR = 1.0;
// Shallower than the arc rises, and it has only the space below the baseline to use.
const NIGHT_DIP_FACTOR = 0.55;
const NIGHT_ORB_OPACITY = 0.45;

const SUNRISE_ICON_NAME = 'daytime-sunrise-symbolic';
const SUNSET_ICON_NAME = 'daytime-sunset-symbolic';

const UI_TICK_INTERVAL_MS = 30000;
const SUN_TIMES_REFRESH_SECONDS = 6 * 3600;
const SUN_TIMES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// A session with no timeout waits forever, so a network that accepts the connection and
// then goes quiet would leave the widget on its last schedule indefinitely.
const SUN_TIMES_REQUEST_TIMEOUT_SECONDS = 30;
const LOCATION_TOLERANCE = 0.0001;
const decoder = new TextDecoder();

function nowMinutesOfDay() {
    const now = GLib.DateTime.new_now_local();
    return now.get_hour() * MINUTES_PER_HOUR + now.get_minute();
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

function dateToDayIndex(dateStr) {
    if (typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day))
        return null;
    return Math.floor(Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY);
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

function isoToMinutes(isoString) {
    if (typeof isoString !== 'string') return null;
    const timePart = isoString.slice(11, 16);
    const match = timePart.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function nowInLocationMinutes(locationOffsetShiftMinutes) {
    const systemMinutes = nowMinutesOfDay();
    let locMinutes = systemMinutes + locationOffsetShiftMinutes;
    return ((locMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function systemUtcOffsetSeconds() {
    return GLib.DateTime.new_now_local().get_utc_offset() / GLib.USEC_PER_SEC;
}

export function createSunTimesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentHex = resolveAccentColor(config);
    const accent = parseCssColor(accentHex);
    const textRgb = parseCssColor(textColor);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    let sunriseEvent = null; // {dateStr, minutes} or null — nearest sunrise for display
    let sunsetEvent = null;  // {dateStr, minutes} or null — nearest sunset for display
    let arcSunriseMinutes = null; // arc span start; paired with a same-day sunset
    let arcSunsetMinutes = null;  // arc span end; paired with a same-day sunrise
    let offsetShiftMinutes = 0;
    let snapshotAgeText = '';

    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    const session = new Soup.Session({ timeout: SUN_TIMES_REQUEST_TIMEOUT_SECONDS });

    const hasLocation = Number.isFinite(config.latitude) && Number.isFinite(config.longitude);

    if (hasLocation && config.id) {
        loadLastGoodCache('sun-schedule', config.id, (payload, savedAtMs) => {
            if (isActorDestroyed(container) || !payload) return;
            if (Math.abs(payload.lat - config.latitude) > LOCATION_TOLERANCE
                || Math.abs(payload.lon - config.longitude) > LOCATION_TOLERANCE)
                return;
            offsetShiftMinutes = payload.offsetShiftMinutes;
            sunriseEvent = payload.sunriseEvent;
            sunsetEvent = payload.sunsetEvent;
            // Absent in snapshots cached before the arc was stored.
            arcSunriseMinutes = Number.isFinite(payload.arcSunriseMinutes) ? payload.arcSunriseMinutes : null;
            arcSunsetMinutes = Number.isFinite(payload.arcSunsetMinutes) ? payload.arcSunsetMinutes : null;
            // A schedule cached yesterday evening still shows tomorrow's sunrise, so the
            // countdowns below are counted against a clock the data no longer matches.
            snapshotAgeText = formatSnapshotAge(savedAtMs);
            renderDynamic();
        }, SUN_TIMES_CACHE_MAX_AGE_MS);
    }

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

        const divider = new St.Widget({ style: '' });
    mainBox.add_child(divider);

    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    const buildMetricItem = (iconName) => {
        const itemBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style: `spacing: ${METRIC_ITEM_SPACING_PX}px;`,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: METRIC_ICON_SIZE_PX,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const infoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: `spacing: ${METRIC_TEXT_SPACING_PX}px;`,
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

    function renderCityWithAge() {
        const name = GLib.markup_escape_text(String(config.city || 'Unknown location'), -1);
        if (!snapshotAgeText) {
            cityLabel.clutter_text.set_markup(name);
            return;
        }
        const age = GLib.markup_escape_text(snapshotAgeText, -1);
        cityLabel.clutter_text.set_markup(`${name} <span alpha="${Math.round(WEATHER_METADATA_OPACITY * 100)}%">· ${age}</span>`);
    }

    function updateMetric(item, event, nowMinutes) {
        if (!event) {
            item.timeLabel.text = '--:--';
            item.statusLabel.text = '';
            return;
        }
        item.timeLabel.text = formatClock(event.minutes);
        const todayStr = todayLocationDateStr(offsetShiftMinutes);
        const eventDayIndex = dateToDayIndex(event.dateStr);
        const todayDayIndex = dateToDayIndex(todayStr);
        if (eventDayIndex === null || todayDayIndex === null) {
            item.statusLabel.text = '';
            return;
        }
        const dayDiff = eventDayIndex - todayDayIndex;
        const delta = dayDiff * MINUTES_PER_DAY + event.minutes - nowMinutes;
        item.statusLabel.text = formatCountdown(delta);
    }

    function renderDynamic() {
        const now = nowInLocationMinutes(offsetShiftMinutes);
        renderCityWithAge();
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

    function archHeightFactor() {
        const dayLength = daylightMinutes();
        const span = MAX_DAY_LENGTH_MINUTES - MIN_DAY_LENGTH_MINUTES;
        const t = span > 0 ? (dayLength - MIN_DAY_LENGTH_MINUTES) / span : 1;
        const clamped = Math.max(0, Math.min(1, t));
        return MIN_ARCH_HEIGHT_FACTOR + clamped * (MAX_ARCH_HEIGHT_FACTOR - MIN_ARCH_HEIGHT_FACTOR);
    }

    function traceArch(ctx, leftX, spanX, baselineY, radiusY, startT, endT) {
        ctx.newSubPath();
        for (let i = 0; i <= ARC_SEGMENT_COUNT; i++) {
            const t = startT + ((endT - startT) * i) / ARC_SEGMENT_COUNT;
            ctx.lineTo(leftX + t * spanX, baselineY - radiusY * Math.sin(Math.PI * t));
        }
        ctx.stroke();
    }

    function traceNightDip(ctx, leftX, spanX, baselineY, depthY, startT, endT) {
        ctx.newSubPath();
        for (let i = 0; i <= ARC_SEGMENT_COUNT; i++) {
            const t = startT + ((endT - startT) * i) / ARC_SEGMENT_COUNT;
            ctx.lineTo(leftX + t * spanX, baselineY + depthY * Math.sin(Math.PI * t));
        }
        ctx.stroke();
    }

    function daylightMinutes() {
        if (arcSunriseMinutes !== null && arcSunsetMinutes !== null && arcSunsetMinutes > arcSunriseMinutes)
            return arcSunsetMinutes - arcSunriseMinutes;
                return REFERENCE_DAY_MINUTES;
    }

    function drawArcCanvas(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const marginX = canvasWidth * ARC_MARGIN_X_RATIO;
        const lineWidth = scaleFontSize(ARC_LINE_WIDTH_PX, scale);
        const trackWidth = scaleFontSize(ARC_TRACK_WIDTH_PX, scale);
                const leftX = marginX + lineWidth / 2;
        const rightX = canvasWidth - marginX - lineWidth / 2;
        const spanX = Math.max(1, rightX - leftX);
        const baselineY = canvasHeight * BASELINE_RATIO;
        const radiusY = Math.max(1, (baselineY - lineWidth) * archHeightFactor());
        const depthY = Math.max(1, (canvasHeight - baselineY) * NIGHT_DIP_FACTOR);

        ctx.setLineCap(Cairo.LineCap.ROUND);

        const progress = sunProgress();
        const now = nowInLocationMinutes(offsetShiftMinutes);

        // Only the path the sun is on right now: the arc by day, the dip by night.
        if (progress === null) {
            const nightLength = MINUTES_PER_DAY - daylightMinutes();
            if (nightLength > 0) {
                ctx.setSourceRGBA(textRgb.r, textRgb.g, textRgb.b, GRAPHICS_OPACITY.arcTrack);
                ctx.setLineWidth(trackWidth);
                traceNightDip(ctx, leftX, spanX, baselineY, depthY, 0, 1);

                const minutesSinceSunset = arcSunsetMinutes !== null
                    ? ((now - arcSunsetMinutes) + MINUTES_PER_DAY) % MINUTES_PER_DAY
                    : 0;
                const nightT = Math.max(0, Math.min(1, minutesSinceSunset / nightLength));
                ctx.setSourceRGBA(accent.r, accent.g, accent.b, NIGHT_ORB_OPACITY);
                ctx.setLineWidth(lineWidth);
                traceNightDip(ctx, rightX, -spanX, baselineY, depthY, 0, nightT);
                ctx.newSubPath();
                ctx.arc(rightX - nightT * spanX, baselineY + depthY * Math.sin(Math.PI * nightT),
                    ORB_RADIUS_PX * scale, 0, 2 * Math.PI);
                ctx.fill();
            }
            ctx.$dispose();
            return;
        }

        ctx.setSourceRGBA(textRgb.r, textRgb.g, textRgb.b, GRAPHICS_OPACITY.arcTrack);
        ctx.setLineWidth(trackWidth);
        traceArch(ctx, leftX, spanX, baselineY, radiusY, 0, 1);

        ctx.setSourceRGBA(accent.r, accent.g, accent.b, 1);
        ctx.setLineWidth(lineWidth);
        traceArch(ctx, leftX, spanX, baselineY, radiusY, 0, progress);

        ctx.newSubPath();
        ctx.arc(leftX + progress * spanX, baselineY - radiusY * Math.sin(Math.PI * progress),
            ORB_RADIUS_PX * scale, 0, 2 * Math.PI);
        ctx.fill();
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

    function fetchSunTimes() {
        if (!hasLocation || isActorDestroyed(container)) return;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}`
            + `&longitude=${config.longitude}&daily=sunrise,sunset&timezone=auto&forecast_days=3&previous_day=1`;
        const message = createGetMessage(url);
        if (!message) {
            console.error('Gridgets: sun times request could not be created');
            return;
        }
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (sourceObject, result) => {
            if (isActorDestroyed(container)) return;
            try {
                // Finish the transfer before inspecting the status: on a transport
                // failure the status is 0, so checking first would leak the result.
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
                const daily = payload && payload.daily ? payload.daily : {};

                const locationOffsetSeconds = Number.isFinite(payload.utc_offset_seconds)
                    ? payload.utc_offset_seconds
                    : systemUtcOffsetSeconds();
                offsetShiftMinutes = (locationOffsetSeconds - systemUtcOffsetSeconds()) / 60;

                const now = nowInLocationMinutes(offsetShiftMinutes);
                const todayStr = todayLocationDateStr(offsetShiftMinutes);

                // Past scans backwards, upcoming forwards.
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

                const isDaylight = lastSunrise !== null && nextSunset !== null
                    && now >= lastSunrise.minutes && now < nextSunset.minutes;

                // The arc reads a sunrise and sunset from one day; the footer shows
                // whichever pair the reader cares about next.
                if (isDaylight) {
                    sunriseEvent = lastSunrise;
                    sunsetEvent = nextSunset;
                    arcSunriseMinutes = lastSunrise.minutes;
                    arcSunsetMinutes = nextSunset.minutes;
                } else {
                    sunsetEvent = lastSunset;
                    sunriseEvent = nextSunrise;
                    arcSunriseMinutes = nextSunrise ? nextSunrise.minutes : null;
                    arcSunsetMinutes = nextSunset ? nextSunset.minutes : null;
                }

                // Never show --:--: fall back to any value the API returned.
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

                saveLastGoodCache('sun-schedule', config.id, {
                    lat: config.latitude,
                    lon: config.longitude,
                    offsetShiftMinutes,
                    sunriseEvent,
                    sunsetEvent,
                    // The arch needs a span paired with the current daylight state.
                    arcSunriseMinutes,
                    arcSunsetMinutes,
                });

                snapshotAgeText = '';
                renderDynamic();
            } catch (error) {
                if (isCancelledError(error))
                    return;
                // The old schedule stays up, so this is the only record of the failure.
                console.error('Gridgets: could not refresh sun times:', error.message);
            }
        });
    }

    connectTimerCleanup(container, state, ['timerId', 'refreshTimerId']);
    registerWidgetCleanup(container, () => {
        session.abort();
        state.cancellable.cancel();
    });

    function applyLayout(nextScale) {
        scale = nextScale;
        const px = value => scaleFontSize(value, scale);

        cityLabel.style = `${fontCss}font-size: ${scaleFontSize(HEADER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px;`
            + `font-weight: ${HEADER_FONT_WEIGHT}; color: ${textColor}; opacity: ${WEATHER_SUBTLE_OPACITY};`;

        const dividerMargin = px(DIVIDER_MARGIN_VERTICAL_PX);
        divider.style = `background-color: rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, ${GRAPHICS_OPACITY.divider});`
            + ` height: 1px; margin-top: ${dividerMargin}px; margin-bottom: ${dividerMargin}px;`;

        for (const item of [sunriseItem, sunsetItem]) {
            item.icon.style = `color: ${textColor}; opacity: ${ICON_OPACITY_SECONDARY};`;
            item.icon.set_icon_size(px(METRIC_ICON_SIZE_PX));
            item.timeLabel.style = `${fontCss}font-size: ${scaleFontSize(TIME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px;`
                + `font-weight: ${TIME_FONT_WEIGHT}; color: ${textColor};`;
            item.statusLabel.style = `${fontCss}font-size: ${scaleFontSize(STATUS_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                + `font-weight: ${STATUS_FONT_WEIGHT}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;
        }

        // Padding goes on the content box: assigning container.style would replace the
        // themed background, corner radius and foreground createWidgetContainer applied.
        // Horizontal padding sits on the city and footer rows rather than here, so the
        // divider between them spans the full width; St clamps negative margins to zero.
        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px 0;`
            + `spacing: ${px(MAIN_BOX_SPACING_PX)}px;`;
        const inset = `padding-left: ${px(CONTAINER_PADDING_H_PX)}px; padding-right: ${px(CONTAINER_PADDING_H_PX)}px;`;
        cityLabel.style += inset;
        footerBox.style = inset;

        renderDynamic();
    }

    applyLayout(clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX)));
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyLayout(scale);
    });

    startPollingTimer(renderDynamic, UI_TICK_INTERVAL_MS, state);
    fetchSunTimes();
    if (hasLocation) {
        state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SUN_TIMES_REFRESH_SECONDS, () => {
            fetchSunTimes();
            return GLib.SOURCE_CONTINUE;
        });
    }

    return container;
}
