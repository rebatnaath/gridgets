/**
 * ============================================================================
 * DIGITAL CLOCK WIDGET
 * 
 * This module provides a precise digital clock and date display. It synchronizes
 * its updates to the system minute boundary to avoid unnecessary redraws.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY } from './widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup } from './widgetUIUtils.js';

const OPACITY_80_PERCENT = 204;
const SECONDS_IN_MINUTE = 60;
const MILLISECONDS_IN_SECOND = 1000;

export function createTimeNode(widgetData, width, height, xPosition, yPosition, global24h) {
    const is24h = widgetData.use24h !== undefined ? widgetData.use24h : global24h;
    const fontFamily = widgetData.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(widgetData);
    const backgroundColor = resolveWidgetBackgroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    const textLayout = buildTextLayoutContainer(widgetNode);
    
    const timeElements = buildTimeAndDateLabels(is24h);
    textLayout.add_child(timeElements.timeRow);
    textLayout.add_child(timeElements.dateLabel);

    const state = { timerId: null };

    const updateDisplay = () => {
        updateTimeAndDate(timeElements, is24h);
        return GLib.SOURCE_CONTINUE;
    };

    updateDisplay();
    startClockTimer(state, updateDisplay);

    connectTimerCleanup(widgetNode, state);

    return widgetNode;
}

// buildBaseContainer was removed
function buildTextLayoutContainer(widgetNode) {
    const verticalLayout = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    
    widgetNode.add_child(verticalLayout);

    return verticalLayout;
}

function buildTimeAndDateLabels(is24h) {
    const timeRow = new St.BoxLayout({
        vertical: false,
        y_align: Clutter.ActorAlign.END,
        x_align: Clutter.ActorAlign.CENTER,
    });
    
    const timeLabel = new St.Label({
        text: '00:00',
        style: `font-weight: bold; font-size: 32px; margin-right: 4px;`
    });
    timeRow.add_child(timeLabel);
    
    let ampmLabel = null;
    if (!is24h) {
        ampmLabel = new St.Label({
            text: 'AM',
            style: `font-weight: bold; font-size: 16px; margin-bottom: 8px;`
        });
        timeRow.add_child(ampmLabel);
    }

    const dateLabel = new St.Label({
        text: 'Monday, Jan 1',
        style: `font-size: 13px;`,
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
        const hour12 = parseInt(now.format('%I'), 10).toString();
        const minute = now.format('%M');
        elements.timeLabel.set_text(`${hour12}:${minute}`);
        elements.ampmLabel.set_text(now.format('%p'));
    }
    
    elements.dateLabel.set_text(now.format('%A, %b %d'));
}

// Calculates the exact milliseconds until the next minute begins, triggers an update,
// and schedules a 60-second recurring timer. The timer ID is attached to the widgetNode
// so it can be reliably disconnected when the widget is destroyed.
function startClockTimer(state, updateCallback) {
    const now = GLib.DateTime.new_now_local();
    const millisecondsUntilNextMinute = (SECONDS_IN_MINUTE - now.get_seconds()) * MILLISECONDS_IN_SECOND - (now.get_microsecond() / MILLISECONDS_IN_SECOND);
    
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, millisecondsUntilNextMinute, () => {
        updateCallback();
        state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SECONDS_IN_MINUTE, updateCallback);
        return GLib.SOURCE_REMOVE;
    });
}
