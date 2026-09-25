import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, resolveUse24h } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';

const BASE_CONTAINER_WIDTH = 180;
const BASE_CONTAINER_HEIGHT = 100;
const BASE_TIME_FONT_SIZE = TYPOGRAPHY_SIZE.displayLG;
const BASE_AMPM_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_DATE_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const TIME_MARGIN_RIGHT_PX = 5;
const AMPM_MARGIN_BOTTOM_PX = 4;

function timeLabelStyle({ fontCss, textColor, timeFontSize }) {
    return `${fontCss}color: ${textColor}; font-weight: ${TYPOGRAPHY_WEIGHT.black}; font-size: ${timeFontSize}px; margin-right: ${TIME_MARGIN_RIGHT_PX}px;`;
}

function ampmLabelStyle({ fontCss, textColor, ampmFontSize }) {
    return `${fontCss}color: ${textColor}; font-size: ${ampmFontSize}px; opacity: ${TEXT_OPACITY.secondary}; margin-bottom: ${AMPM_MARGIN_BOTTOM_PX}px;`;
}

function dateLabelStyle({ fontCss, textColor, dateFontSize }) {
    return `${fontCss}color: ${textColor}; font-size: ${dateFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${TEXT_OPACITY.secondary};`;
}

function buildTimeAndDateLabels({ is24h, fontCss, textColor, timeFontSize, ampmFontSize, dateFontSize }) {
    const timeRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.END,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const timeLabel = new St.Label({
        text: '00:00',
        style: timeLabelStyle({ fontCss, textColor, timeFontSize }),
    });
    timeRow.add_child(timeLabel);

    let ampmLabel = null;
    if (!is24h) {
        ampmLabel = new St.Label({
            text: 'AM',
            style: ampmLabelStyle({ fontCss, textColor, ampmFontSize }),
        });
        timeRow.add_child(ampmLabel);
    }

    const dateLabel = new St.Label({
        text: 'Monday, Jan 1',
        style: dateLabelStyle({ fontCss, textColor, dateFontSize }),
        x_align: Clutter.ActorAlign.CENTER,
    });

    return { timeRow, timeLabel, ampmLabel, dateLabel, is24h };
}

// Resize restyles the existing labels instead of rebuilding the actor tree,
// which would otherwise churn actors on every resize event.
function applyLabelTypography(elements, typography) {
    elements.timeLabel.style = timeLabelStyle(typography);
    if (elements.ampmLabel)
        elements.ampmLabel.style = ampmLabelStyle(typography);
    elements.dateLabel.style = dateLabelStyle(typography);
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
    connectShortClick(widgetNode, () => launchApplication('gnome-clocks'));

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
        const typography = {
            fontCss,
            textColor,
            timeFontSize: scaleFontSize(BASE_TIME_FONT_SIZE, scale, MIN_FONT_SIZE.primary),
            ampmFontSize: scaleFontSize(BASE_AMPM_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            dateFontSize: scaleFontSize(BASE_DATE_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
        };

        // The actor tree only depends on 12/24h, so restyle in place until that changes.
        if (timeElements && timeElements.is24h === is24h) {
            applyLabelTypography(timeElements, typography);
            return;
        }

        const previous = timeElements;
        const nextElements = buildTimeAndDateLabels({ is24h, ...typography });
        if (previous) {
            textLayout.replace_child(previous.timeRow, nextElements.timeRow);
            textLayout.replace_child(previous.dateLabel, nextElements.dateLabel);
            previous.timeRow.destroy();
            previous.dateLabel.destroy();
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
