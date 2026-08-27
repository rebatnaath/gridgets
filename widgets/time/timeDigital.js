import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba, resolveUse24h, SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 180;
const BASE_CONTAINER_HEIGHT = 100;
const BASE_TIME_FONT_SIZE = 34;
const BASE_AMPM_FONT_SIZE = 13;
const BASE_DATE_FONT_SIZE = 14;
const TIME_MARGIN_RIGHT_PX = 5;
const AMPM_MARGIN_BOTTOM_PX = 4;
const BORDER_ALPHA = 0.14;

function buildTimeAndDateLabels({ is24h, timeFontSize, ampmFontSize, dateFontSize, fontCss, textColor }) {
    const timeRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.END,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const timeLabel = new St.Label({
        text: '00:00',
        style: `${fontCss}color: ${textColor}; font-weight: 300; font-size: ${timeFontSize}px; margin-right: ${TIME_MARGIN_RIGHT_PX}px;`
    });
    timeRow.add_child(timeLabel);

    let ampmLabel = null;
    if (!is24h) {
        ampmLabel = new St.Label({
            text: 'AM',
            style: `${fontCss}color: ${textColor}; font-size: ${ampmFontSize}px; opacity: ${SECONDARY_OPACITY}; margin-bottom: ${AMPM_MARGIN_BOTTOM_PX}px;`
        });
        timeRow.add_child(ampmLabel);
    }

    const dateLabel = new St.Label({
        text: 'Monday, Jan 1',
        style: `${fontCss}color: ${textColor}; font-size: ${dateFontSize}px; opacity: ${SECONDARY_OPACITY};`,
        x_align: Clutter.ActorAlign.CENTER
    });

    return { timeRow, timeLabel, ampmLabel, dateLabel };
}

function updateTimeAndDate(elements, is24h) {
    const now = GLib.DateTime.new_now_local();
    const { time, ampm } = formatTimeParts(now, is24h);
    elements.timeLabel.set_text(time);
    if (elements.ampmLabel)
        elements.ampmLabel.set_text(ampm);
    elements.dateLabel.set_text(now.format('%A, %b %d'));
}

export function createDigitalTimeNode(widgetData, width, height, xPosition, yPosition) {
    const is24h = resolveUse24h(widgetData);
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    widgetNode.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const textLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    widgetNode.add_child(textLayout);

    let timeElements = null;

    const applyScale = (scale) => {
        const scaled = (base) => Math.max(1, Math.round(base * scale));
        const nextElements = buildTimeAndDateLabels({
            is24h,
            timeFontSize: scaled(BASE_TIME_FONT_SIZE),
            ampmFontSize: scaled(BASE_AMPM_FONT_SIZE),
            dateFontSize: scaled(BASE_DATE_FONT_SIZE),
            fontCss,
            textColor,
        });

        if (timeElements) {
            const oldTimeRow = timeElements.timeRow;
            const oldDateLabel = timeElements.dateLabel;
            textLayout.replace_child(oldTimeRow, nextElements.timeRow);
            textLayout.replace_child(oldDateLabel, nextElements.dateLabel);
            oldTimeRow.destroy();
            oldDateLabel.destroy();
        } else {
            textLayout.add_child(nextElements.timeRow);
            textLayout.add_child(nextElements.dateLabel);
        }
        timeElements = nextElements;
        updateTimeAndDate(timeElements, is24h);
    };

    const state = {
        timerId: null,
    };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        updateTimeAndDate(timeElements, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    applyScale(Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);
    attachResponsiveScaler(widgetNode, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale) => {
        if (isActorDestroyed(widgetNode)) return;
        applyScale(scale);
    });

    return widgetNode;
}
