import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveUse24h } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';

const BASE_CONTAINER_WIDTH = 260;
const BASE_CONTAINER_HEIGHT = 240;
const TOP_CITY_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const TOP_TIME_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.displayLG;
const TOP_GMT_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.label;
const SEC_CITY_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const SEC_TIME_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.title;
const SEC_GMT_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const CONTAINER_PADDING_PX = 20;
const TOP_AMPM_MARGIN_BOTTOM_PX = 6;
const TOP_AMPM_MARGIN_LEFT_PX = 4;
const SEC_AMPM_MARGIN_BOTTOM_PX = 3;
const SEC_AMPM_MARGIN_LEFT_PX = 3;

const DEFAULT_CITIES = [
    { name: 'London', timezone: 'Europe/London', country: 'GB', primary: true },
    { name: 'New York', timezone: 'America/New_York', country: 'US', primary: false },
    { name: 'Moscow', timezone: 'Europe/Moscow', country: 'RU', primary: false },
];

function getFormattedTimeAndGmt(timezoneId, is24h) {
    const tz = timezoneId
        ? (GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId))
        : GLib.TimeZone.new_local();
    const now = GLib.DateTime.new_now(tz || GLib.TimeZone.new_local());

    const { time: timeStr, ampm: ampmStr } = formatTimeParts(now, is24h);

    const offsetMicrosec = now.get_utc_offset();
    const totalOffsetSec = Math.floor(offsetMicrosec / 1000000);
    const totalOffsetMinutes = Math.round(totalOffsetSec / 60);

    const sign = totalOffsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(totalOffsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;

    let gmtStr = 'GMT';
    if (hours !== 0 || minutes !== 0) {
        if (minutes === 0) {
            gmtStr = `GMT ${sign}${hours}`;
        } else {
            const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
            gmtStr = `GMT ${sign}${hours}:${formattedMinutes}`;
        }
    }

    return { timeStr, ampmStr, gmtStr };
}

// One row of a clock: its four labels, the base size each is drawn at, and the options
// that never change with scale. The build and the responsive scaler both read this, so
// the two cannot drift apart.
const CLOCK_ROWS = [
    {
        key: 'top',
        city: { base: TOP_CITY_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.subtitle, secondary: true, weight: TYPOGRAPHY_WEIGHT.medium },
        time: { base: TOP_TIME_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.primary, weight: TYPOGRAPHY_WEIGHT.extrabold },
        gmt: { base: TOP_GMT_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.label, secondary: true },
        ampm: { marginLeftPx: TOP_AMPM_MARGIN_LEFT_PX, marginBottomPx: TOP_AMPM_MARGIN_BOTTOM_PX },
    },
    {
        key: 'left',
        city: { base: SEC_CITY_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.label, secondary: true, weight: TYPOGRAPHY_WEIGHT.medium },
        time: { base: SEC_TIME_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.subtitle, weight: TYPOGRAPHY_WEIGHT.semibold },
        gmt: { base: SEC_GMT_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.metadata, secondary: true },
        ampm: { marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX, marginBottomPx: SEC_AMPM_MARGIN_BOTTOM_PX },
    },
    {
        key: 'right',
        city: { base: SEC_CITY_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.label, secondary: true, weight: TYPOGRAPHY_WEIGHT.medium },
        time: { base: SEC_TIME_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.subtitle, weight: TYPOGRAPHY_WEIGHT.semibold },
        gmt: { base: SEC_GMT_BASE_FONT_SIZE, minimum: MIN_FONT_SIZE.metadata, secondary: true },
        ampm: { marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX, marginBottomPx: SEC_AMPM_MARGIN_BOTTOM_PX },
        alignRight: true,
    },
];

function buildWorldClockUI(layoutBox, fontCss, scale, cities) {
    const primaryCity = cities[0] || DEFAULT_CITIES[0];
    const leftSecondaryCity = cities[1] || DEFAULT_CITIES[1];
    const rightSecondaryCity = cities[2] || DEFAULT_CITIES[2];

    // Labels inherit the row's colour rather than naming one, so the two secondary
    // cities read as subordinate to the primary above them.
    const labelStyle = (scale, { base, minimum = 1, secondary = false, weight = null, marginLeftPx = 0, marginBottomPx = 0, alignRight = false } = {}) => {
        let style = `${fontCss}font-size: ${scaleFontSize(base, scale, minimum)}px; color: inherit;`;
        if (weight !== null) style += ` font-weight: ${weight};`;
        if (secondary) style += ` opacity: ${TEXT_OPACITY.secondary};`;
        if (marginLeftPx > 0) style += ` margin-left: ${marginLeftPx}px;`;
        if (marginBottomPx > 0) style += ` margin-bottom: ${marginBottomPx}px;`;
        if (alignRight) style += ' text-align: right;';
        return style;
    };

    // The ampm label is drawn at its row's gmt size but carries the row's margins.
    const stylesFor = (row, role, scale) => {
        if (role === 'ampm')
            return labelStyle(scale, { ...row.gmt, secondary: true, ...row.ampm, alignRight: row.alignRight });
        return labelStyle(scale, { ...row[role], alignRight: row.alignRight });
    };

    const labels = {};
    for (const row of CLOCK_ROWS) {
        labels[row.key] = {
            city: stylesFor(row, 'city', scale),
            time: stylesFor(row, 'time', scale),
            gmt: stylesFor(row, 'gmt', scale),
            ampm: stylesFor(row, 'ampm', scale),
        };
    }

    const mainContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${CONTAINER_PADDING_PX}px;`,
    });

    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const topInfoBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const topCityLabel = new St.Label({
        text: primaryCity.name,
        style: labels.top.city,
    });

    const topGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labels.top.gmt,
    });

    topInfoBox.add_child(topCityLabel);
    topInfoBox.add_child(topGmtLabel);

    const topTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topTimeLabel = new St.Label({
        text: '00:00',
        style: labels.top.time,
    });
    const topAmpmLabel = new St.Label({
        text: '',
        style: labels.top.ampm,
        y_align: Clutter.ActorAlign.END,
    });
    topTimeBox.add_child(topTimeLabel);
    topTimeBox.add_child(topAmpmLabel);

    topRow.add_child(topInfoBox);
    topRow.add_child(topTimeBox);
    mainContainer.add_child(topRow);

    const flexSpacer = new St.Widget({
        y_expand: true,
        x_expand: true,
    });
    mainContainer.add_child(flexSpacer);

    const bottomRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.END,
    });

    const leftSecBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    const leftCityLabel = new St.Label({
        text: leftSecondaryCity.name,
        style: labels.left.city,
    });
    const leftTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const leftTimeLabel = new St.Label({
        text: '00:00',
        style: labels.left.time,
    });
    const leftAmpmLabel = new St.Label({
        text: '',
        style: labels.left.ampm,
        y_align: Clutter.ActorAlign.END,
    });
    leftTimeBox.add_child(leftTimeLabel);
    leftTimeBox.add_child(leftAmpmLabel);

    const leftGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labels.left.gmt,
    });
    leftSecBox.add_child(leftCityLabel);
    leftSecBox.add_child(leftTimeBox);
    leftSecBox.add_child(leftGmtLabel);

    const rightSecBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
    });
    const rightCityLabel = new St.Label({
        text: rightSecondaryCity.name,
        style: labels.right.city,
        x_align: Clutter.ActorAlign.END,
    });
    const rightTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const rightTimeLabel = new St.Label({
        text: '00:00',
        style: labels.right.time,
        x_align: Clutter.ActorAlign.END,
    });
    const rightAmpmLabel = new St.Label({
        text: '',
        style: labels.right.ampm,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
    });
    rightTimeBox.add_child(rightTimeLabel);
    rightTimeBox.add_child(rightAmpmLabel);

    const rightGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labels.right.gmt,
        x_align: Clutter.ActorAlign.END,
    });
    rightSecBox.add_child(rightCityLabel);
    rightSecBox.add_child(rightTimeBox);
    rightSecBox.add_child(rightGmtLabel);

    bottomRow.add_child(leftSecBox);
    bottomRow.add_child(rightSecBox);
    mainContainer.add_child(bottomRow);

    layoutBox.add_child(mainContainer);

    const actors = {
        top: { city: topCityLabel, time: topTimeLabel, gmt: topGmtLabel, ampm: topAmpmLabel },
        left: { city: leftCityLabel, time: leftTimeLabel, gmt: leftGmtLabel, ampm: leftAmpmLabel },
        right: { city: rightCityLabel, time: rightTimeLabel, gmt: rightGmtLabel, ampm: rightAmpmLabel },
    };

    return {
        topCityLabel,
        topTimeLabel,
        topAmpmLabel,
        topGmtLabel,
        leftCityLabel,
        leftTimeLabel,
        leftAmpmLabel,
        leftGmtLabel,
        rightCityLabel,
        rightTimeLabel,
        rightAmpmLabel,
        rightGmtLabel,
        primaryCity,
        leftSecondaryCity,
        rightSecondaryCity,
        // One descriptor drives both the initial styles and every later resize, so a
        // row cannot be styled one way at build and another way after a drag.
        applyScale: (scale) => {
            for (const row of CLOCK_ROWS) {
                for (const role of ['city', 'time', 'gmt', 'ampm'])
                    actors[row.key][role].style = stylesFor(row, role, scale);
            }
        },
    };
}

function updateWorldTimes(ui, is24h) {
    if (!ui) return;

    const primaryData = getFormattedTimeAndGmt(ui.primaryCity.timezone, is24h);
    ui.topTimeLabel.set_text(primaryData.timeStr);
    ui.topAmpmLabel.set_text(primaryData.ampmStr);
    ui.topAmpmLabel.visible = (!is24h && primaryData.ampmStr !== '');
    ui.topGmtLabel.set_text(primaryData.gmtStr);

    const leftData = getFormattedTimeAndGmt(ui.leftSecondaryCity.timezone, is24h);
    ui.leftTimeLabel.set_text(leftData.timeStr);
    ui.leftAmpmLabel.set_text(leftData.ampmStr);
    ui.leftAmpmLabel.visible = (!is24h && leftData.ampmStr !== '');
    ui.leftGmtLabel.set_text(leftData.gmtStr);

    const rightData = getFormattedTimeAndGmt(ui.rightSecondaryCity.timezone, is24h);
    ui.rightTimeLabel.set_text(rightData.timeStr);
    ui.rightAmpmLabel.set_text(rightData.ampmStr);
    ui.rightAmpmLabel.visible = (!is24h && rightData.ampmStr !== '');
    ui.rightGmtLabel.set_text(rightData.gmtStr);
}

export function createWorldTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    connectShortClick(widgetNode, () => launchApplication('gnome-clocks'));

    const cities = widgetData.cities || DEFAULT_CITIES;
    // Sized before the first paint, so the initial frame is not drawn at the base size
    // and then restyled by the scaler's first idle pass.
    const initialScale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);
    const ui = buildWorldClockUI(widgetNode, fontCss, initialScale, cities);

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        // Re-evaluated per tick so toggling 24h takes effect without a rebuild.
        const is24h = resolveUse24h(widgetData);
        updateWorldTimes(ui, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    attachResponsiveScaler(widgetNode, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale) => {
        if (isActorDestroyed(widgetNode)) return;
        ui.applyScale(scale);
    });

    return widgetNode;
}
