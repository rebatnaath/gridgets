import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba, resolveUse24h, SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 260;
const BASE_CONTAINER_HEIGHT = 240;
const TOP_CITY_BASE_FONT_SIZE = 16;
const TOP_TIME_BASE_FONT_SIZE = 40;
const TOP_GMT_BASE_FONT_SIZE = 15;
const SEC_CITY_BASE_FONT_SIZE = 14;
const SEC_TIME_BASE_FONT_SIZE = 22;
const SEC_GMT_BASE_FONT_SIZE = 13;
const CONTAINER_PADDING_PX = 20;
const BORDER_ALPHA = 0.14;
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

function buildWorldClockUI(layoutBox, fontCss, textColor, cities) {
    const primaryCity = cities[0] || DEFAULT_CITIES[0];
    const leftSecondaryCity = cities[1] || DEFAULT_CITIES[1];
    const rightSecondaryCity = cities[2] || DEFAULT_CITIES[2];

    // Label style builder reused by the responsive scaler.
    const labelStyle = (sizePx, { secondary = false, light = false, marginLeftPx = 0, alignRight = false } = {}) => {
        let style = `${fontCss}font-size: ${Math.max(1, Math.round(sizePx))}px; color: inherit;`;
        if (light) style += ' font-weight: 300;';
        if (secondary) style += ` opacity: ${SECONDARY_OPACITY};`;
        if (marginLeftPx > 0) style += ` margin-left: ${marginLeftPx}px;`;
        if (alignRight) style += ' text-align: right;';
        return style;
    };

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
        style: labelStyle(TOP_CITY_BASE_FONT_SIZE, { secondary: true }),
    });

    const topGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labelStyle(TOP_GMT_BASE_FONT_SIZE, { secondary: true }),
    });

    topInfoBox.add_child(topCityLabel);
    topInfoBox.add_child(topGmtLabel);

    const topTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topTimeLabel = new St.Label({
        text: '00:00',
        style: labelStyle(TOP_TIME_BASE_FONT_SIZE, { light: true }),
    });
    const topAmpmLabel = new St.Label({
        text: '',
        style: labelStyle(TOP_GMT_BASE_FONT_SIZE, { secondary: true, marginLeftPx: TOP_AMPM_MARGIN_LEFT_PX }),
        y_align: Clutter.ActorAlign.END,
        margin_bottom: TOP_AMPM_MARGIN_BOTTOM_PX,
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
        style: labelStyle(SEC_CITY_BASE_FONT_SIZE, { secondary: true }),
    });
    const leftTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const leftTimeLabel = new St.Label({
        text: '00:00',
        style: labelStyle(SEC_TIME_BASE_FONT_SIZE),
    });
    const leftAmpmLabel = new St.Label({
        text: '',
        style: labelStyle(SEC_GMT_BASE_FONT_SIZE, { secondary: true, marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX }),
        y_align: Clutter.ActorAlign.END,
        margin_bottom: SEC_AMPM_MARGIN_BOTTOM_PX,
    });
    leftTimeBox.add_child(leftTimeLabel);
    leftTimeBox.add_child(leftAmpmLabel);

    const leftGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labelStyle(SEC_GMT_BASE_FONT_SIZE, { secondary: true }),
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
        style: labelStyle(SEC_CITY_BASE_FONT_SIZE, { secondary: true, alignRight: true }),
        x_align: Clutter.ActorAlign.END,
    });
    const rightTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const rightTimeLabel = new St.Label({
        text: '00:00',
        style: labelStyle(SEC_TIME_BASE_FONT_SIZE, { alignRight: true }),
        x_align: Clutter.ActorAlign.END,
    });
    const rightAmpmLabel = new St.Label({
        text: '',
        style: labelStyle(SEC_GMT_BASE_FONT_SIZE, { secondary: true, marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX, alignRight: true }),
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
        margin_bottom: SEC_AMPM_MARGIN_BOTTOM_PX,
    });
    rightTimeBox.add_child(rightTimeLabel);
    rightTimeBox.add_child(rightAmpmLabel);

    const rightGmtLabel = new St.Label({
        text: 'GMT +0',
        style: labelStyle(SEC_GMT_BASE_FONT_SIZE, { secondary: true, alignRight: true }),
        x_align: Clutter.ActorAlign.END,
    });
    rightSecBox.add_child(rightCityLabel);
    rightSecBox.add_child(rightTimeBox);
    rightSecBox.add_child(rightGmtLabel);

    bottomRow.add_child(leftSecBox);
    bottomRow.add_child(rightSecBox);
    mainContainer.add_child(bottomRow);

    layoutBox.add_child(mainContainer);

    return {
        labelStyle,
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
    const textColor = resolveWidgetForegroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    widgetNode.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const cities = widgetData.cities || DEFAULT_CITIES;
    // Keep a stable left/right mapping so the responsive scaler updates the same labels.
    const ui = buildWorldClockUI(widgetNode, fontCss, textColor, cities);

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        // Re-evaluate on every tick so toggling the 24h setting takes effect
        // without needing to recreate the widget.
        const is24h = resolveUse24h(widgetData);
        updateWorldTimes(ui, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    attachResponsiveScaler(widgetNode, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale) => {
        if (isActorDestroyed(widgetNode)) return;

        const scaled = (base) => base * scale;
        ui.topCityLabel.style = ui.labelStyle(scaled(TOP_CITY_BASE_FONT_SIZE), { secondary: true });
        ui.topTimeLabel.style = ui.labelStyle(scaled(TOP_TIME_BASE_FONT_SIZE), { light: true });
        ui.topAmpmLabel.style = ui.labelStyle(scaled(TOP_GMT_BASE_FONT_SIZE), { secondary: true, marginLeftPx: TOP_AMPM_MARGIN_LEFT_PX });
        ui.topGmtLabel.style = ui.labelStyle(scaled(TOP_GMT_BASE_FONT_SIZE), { secondary: true });

        ui.leftCityLabel.style = ui.labelStyle(scaled(SEC_CITY_BASE_FONT_SIZE), { secondary: true });
        ui.leftTimeLabel.style = ui.labelStyle(scaled(SEC_TIME_BASE_FONT_SIZE));
        ui.leftAmpmLabel.style = ui.labelStyle(scaled(SEC_GMT_BASE_FONT_SIZE), { secondary: true, marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX });
        ui.leftGmtLabel.style = ui.labelStyle(scaled(SEC_GMT_BASE_FONT_SIZE), { secondary: true });

        ui.rightCityLabel.style = ui.labelStyle(scaled(SEC_CITY_BASE_FONT_SIZE), { secondary: true, alignRight: true });
        ui.rightTimeLabel.style = ui.labelStyle(scaled(SEC_TIME_BASE_FONT_SIZE), { alignRight: true });
        ui.rightAmpmLabel.style = ui.labelStyle(scaled(SEC_GMT_BASE_FONT_SIZE), { secondary: true, marginLeftPx: SEC_AMPM_MARGIN_LEFT_PX, alignRight: true });
        ui.rightGmtLabel.style = ui.labelStyle(scaled(SEC_GMT_BASE_FONT_SIZE), { secondary: true, alignRight: true });
    });

    return widgetNode;
}
