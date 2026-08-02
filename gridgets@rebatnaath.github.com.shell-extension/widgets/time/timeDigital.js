import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { connectTimerCleanup, createWidgetContainer, startMinuteAlignedTimer } from '../../utils/widgetUIUtils.js';

const OPACITY_80_PERCENT = 204;
const BASE_CONTAINER_WIDTH = 180;
const BASE_CONTAINER_HEIGHT = 100;
const BASE_TIME_FONT_SIZE = 32;
const MIN_TIME_FONT_SIZE = 18;
const BASE_AMPM_FONT_SIZE = 16;
const MIN_AMPM_FONT_SIZE = 10;
const BASE_DATE_FONT_SIZE = 13;
const MIN_DATE_FONT_SIZE = 10;
const TIME_MARGIN_RIGHT_PX = 4;
const AMPM_MARGIN_BOTTOM_PX = 4;
function buildTimeAndDateLabels({ is24h, timeFontSize, ampmFontSize, dateFontSize, fontFamily, textColor }) {
    const timeRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.END,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const timeLabel = new St.Label({
        text: '00:00',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${timeFontSize}px; margin-right: ${TIME_MARGIN_RIGHT_PX}px;`
    });
    timeRow.add_child(timeLabel);

    let ampmLabel = null;
    if (!is24h) {
        ampmLabel = new St.Label({
            text: 'AM',
            style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${ampmFontSize}px; margin-bottom: ${AMPM_MARGIN_BOTTOM_PX}px;`
        });
        timeRow.add_child(ampmLabel);
    }

    const dateLabel = new St.Label({
        text: 'Monday, Jan 1',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${dateFontSize}px;`,
        x_align: Clutter.ActorAlign.CENTER
    });
    dateLabel.set_opacity(OPACITY_80_PERCENT);

    return { timeRow, timeLabel, ampmLabel, dateLabel };
}

function updateTimeAndDate(elements, is24h) {
    const now = GLib.DateTime.new_now_local();
    if (is24h) {
        elements.timeLabel.set_text(now.format('%H:%M'));
    } else {
        const displayHour = parseInt(now.format('%I'), 10).toString();
        const minute = now.format('%M');
        elements.timeLabel.set_text(`${displayHour}:${minute}`);
        if (elements.ampmLabel) {
            elements.ampmLabel.set_text(now.format('%p'));
        }
    }
    elements.dateLabel.set_text(now.format('%A, %b %d'));
}

export function createDigitalTimeNode(widgetData, width, height, xPosition, yPosition, global24h) {
    const is24h = widgetData.use24h !== undefined ? widgetData.use24h : global24h;
    const fontFamily = resolveWidgetFontFamily(widgetData);
    const textColor = resolveWidgetForegroundColor(widgetData);

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const timeFontSize = Math.max(MIN_TIME_FONT_SIZE, Math.round(BASE_TIME_FONT_SIZE * scale));
    const ampmFontSize = Math.max(MIN_AMPM_FONT_SIZE, Math.round(BASE_AMPM_FONT_SIZE * scale));
    const dateFontSize = Math.max(MIN_DATE_FONT_SIZE, Math.round(BASE_DATE_FONT_SIZE * scale));

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const textLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    widgetNode.add_child(textLayout);

    const timeElements = buildTimeAndDateLabels({ is24h, timeFontSize, ampmFontSize, dateFontSize, fontFamily, textColor });
    textLayout.add_child(timeElements.timeRow);
    textLayout.add_child(timeElements.dateLabel);

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (widgetNode.isDestroyed) return GLib.SOURCE_REMOVE;
        updateTimeAndDate(timeElements, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    return widgetNode;
}
