import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, startMinuteAlignedTimer } from '../../utils/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 260;
const BASE_CONTAINER_HEIGHT = 240;
const TOP_CITY_BASE_FONT_SIZE = 20;
const TOP_TIME_BASE_FONT_SIZE = 40;
const TOP_GMT_BASE_FONT_SIZE = 13;
const SEC_CITY_BASE_FONT_SIZE = 15;
const SEC_TIME_BASE_FONT_SIZE = 24;
const SEC_GMT_BASE_FONT_SIZE = 12;
const DEFAULT_CITIES = [
    { name: 'London', timezone: 'Europe/London', primary: true },
    { name: 'New York', timezone: 'America/New_York', primary: false },
    { name: 'Moscow', timezone: 'Europe/Moscow', primary: false },
];

function getFormattedTimeAndGmt(timezoneId, is24h) {
    let tz;
    try {
        tz = timezoneId ? (GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId)) : GLib.TimeZone.new_local();
    } catch (e) {
        tz = GLib.TimeZone.new_local();
    }

    const now = GLib.DateTime.new_now(tz || GLib.TimeZone.new_local());

    let timeStr;
    let ampmStr = '';
    if (is24h) {
        timeStr = now.format('%H:%M');
    } else {
        const displayHour = parseInt(now.format('%I'), 10).toString();
        const minute = now.format('%M');
        timeStr = `${displayHour}:${minute}`;
        ampmStr = now.format('%p');
    }

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

function buildWorldClockUI(layoutBox, fontFamily, textColor, cities) {
    const primaryCity = cities[0] || DEFAULT_CITIES[0];
    const leftSecondaryCity = cities[1] || DEFAULT_CITIES[1];
    const rightSecondaryCity = cities[2] || DEFAULT_CITIES[2];

    const mainContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'padding: 16px;',
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${TOP_CITY_BASE_FONT_SIZE}px; color: inherit;`,
    });

    const topGmtLabel = new St.Label({
        text: 'GMT +0',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${TOP_GMT_BASE_FONT_SIZE}px; opacity: 0.6; color: inherit;`,
    });

    topInfoBox.add_child(topCityLabel);
    topInfoBox.add_child(topGmtLabel);

    const topTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topTimeLabel = new St.Label({
        text: '00:00',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${TOP_TIME_BASE_FONT_SIZE}px; color: inherit;`,
    });
    const topAmpmLabel = new St.Label({
        text: '',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${TOP_GMT_BASE_FONT_SIZE}px; opacity: 0.6; margin-left: 4px; color: inherit;`,
        y_align: Clutter.ActorAlign.END,
        margin_bottom: 6,
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${SEC_CITY_BASE_FONT_SIZE}px; color: inherit;`,
    });
    const leftTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const leftTimeLabel = new St.Label({
        text: '00:00',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${SEC_TIME_BASE_FONT_SIZE}px; color: inherit;`,
    });
    const leftAmpmLabel = new St.Label({
        text: '',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${SEC_GMT_BASE_FONT_SIZE}px; opacity: 0.6; margin-left: 3px; color: inherit;`,
        y_align: Clutter.ActorAlign.END,
        margin_bottom: 3,
    });
    leftTimeBox.add_child(leftTimeLabel);
    leftTimeBox.add_child(leftAmpmLabel);

    const leftGmtLabel = new St.Label({
        text: 'GMT +0',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${SEC_GMT_BASE_FONT_SIZE}px; opacity: 0.6; color: inherit;`,
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${SEC_CITY_BASE_FONT_SIZE}px; text-align: right; color: inherit;`,
        x_align: Clutter.ActorAlign.END,
    });
    const rightTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const rightTimeLabel = new St.Label({
        text: '00:00',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${SEC_TIME_BASE_FONT_SIZE}px; text-align: right; color: inherit;`,
        x_align: Clutter.ActorAlign.END,
    });
    const rightAmpmLabel = new St.Label({
        text: '',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${SEC_GMT_BASE_FONT_SIZE}px; opacity: 0.6; margin-left: 3px; text-align: right; color: inherit;`,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
        margin_bottom: 3,
    });
    rightTimeBox.add_child(rightTimeLabel);
    rightTimeBox.add_child(rightAmpmLabel);

    const rightGmtLabel = new St.Label({
        text: 'GMT +0',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${SEC_GMT_BASE_FONT_SIZE}px; opacity: 0.6; text-align: right; color: inherit;`,
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

export function createWorldTimeNode(widgetData, width, height, xPosition, yPosition, global24h) {
    const is24h = (widgetData.use24h === false) ? false : (global24h !== false);
    const fontFamily = resolveWidgetFontFamily(widgetData);
    const textColor = resolveWidgetForegroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const cities = widgetData.cities || DEFAULT_CITIES;
    // Keep a stable left/right mapping so the responsive scaler updates the same labels.
    const ui = buildWorldClockUI(widgetNode, fontFamily, textColor, cities);

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (widgetNode.isDestroyed) return GLib.SOURCE_REMOVE;
        updateWorldTimes(ui, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    attachResponsiveScaler(widgetNode, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale) => {
        if (widgetNode.isDestroyed) return;

        const topCitySize = Math.max(12, Math.round(TOP_CITY_BASE_FONT_SIZE * scale));
        const topTimeSize = Math.max(22, Math.round(TOP_TIME_BASE_FONT_SIZE * scale));
        const topGmtSize = Math.max(9, Math.round(TOP_GMT_BASE_FONT_SIZE * scale));

        const secCitySize = Math.max(10, Math.round(SEC_CITY_BASE_FONT_SIZE * scale));
        const secTimeSize = Math.max(14, Math.round(SEC_TIME_BASE_FONT_SIZE * scale));
        const secGmtSize = Math.max(8, Math.round(SEC_GMT_BASE_FONT_SIZE * scale));

        ui.topCityLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${topCitySize}px; color: inherit;`;
        ui.topTimeLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${topTimeSize}px; color: inherit;`;
        ui.topAmpmLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${topGmtSize}px; opacity: 0.6; margin-left: 4px; color: inherit;`;
        ui.topGmtLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${topGmtSize}px; opacity: 0.6; color: inherit;`;

        ui.leftCityLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${secCitySize}px; color: inherit;`;
        ui.leftTimeLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${secTimeSize}px; color: inherit;`;
        ui.leftAmpmLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${secGmtSize}px; opacity: 0.6; margin-left: 3px; color: inherit;`;
        ui.leftGmtLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${secGmtSize}px; opacity: 0.6; color: inherit;`;

        ui.rightCityLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${secCitySize}px; text-align: right; color: inherit;`;
        ui.rightTimeLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${secTimeSize}px; text-align: right; color: inherit;`;
        ui.rightAmpmLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${secGmtSize}px; opacity: 0.6; margin-left: 3px; text-align: right; color: inherit;`;
        ui.rightGmtLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${secGmtSize}px; opacity: 0.6; text-align: right; color: inherit;`;
    });

    return widgetNode;
}
