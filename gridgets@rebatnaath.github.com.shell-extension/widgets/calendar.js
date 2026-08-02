import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveWidgetFontFamily,
    parseHexColor,
} from '../utils/widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup, startPollingTimer } from '../utils/widgetUIUtils.js';

const DATE_POLL_INTERVAL_MS = 60_000;
const BUTTON_PRIMARY = 1;

function getToday() {
    const now = GLib.DateTime.new_now_local();
    return { year: now.get_year(), month: now.get_month(), day: now.get_day_of_month() };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export function createCalendarNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveWidgetFontFamily(config);
    const { r, g, b } = parseHexColor(textColor);

    const scale = Math.max(0.4, Math.min(width / 200, height / 200));

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(outerBox);

    const topBar = new St.Widget({
        x_expand: true,
        y_expand: true,
        style: `background-color: ${bgColor}; border-radius: 12px 12px 0 0;`,
        layout_manager: new Clutter.BinLayout(),
    });

    const dayLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.max(10, Math.round(13 * scale))}px; font-weight: 600; opacity: 0.9;`,
    });
    topBar.add_child(dayLabel);
    outerBox.add_child(topBar);

    const contentPanel = new St.Widget({
        x_expand: true,
        y_expand: true,
        style: `background-color: rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.06); border-radius: 0 0 12px 12px;`,
        layout_manager: new Clutter.BinLayout(),
    });

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const dateNumber = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.max(28, Math.round(48 * scale))}px; font-weight: 700;`,
    });
    contentBox.add_child(dateNumber);

    const monthLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.max(11, Math.round(15 * scale))}px; font-weight: 500; opacity: 0.7; margin-bottom: ${Math.max(4, Math.round(8 * scale))}px;`,
    });
    contentBox.add_child(monthLabel);

    contentPanel.add_child(contentBox);
    outerBox.add_child(contentPanel);

    function render() {
        const today = getToday();
        const now = GLib.DateTime.new_now_local();
        const dayOfWeek = now.get_day_of_week();
        const dayIndex = dayOfWeek === 7 ? 0 : dayOfWeek;

        dayLabel.set_text(DAY_NAMES[dayIndex]);
        dateNumber.set_text(String(today.day));
        monthLabel.set_text(MONTH_NAMES[today.month]);
    }

    const state = { timerId: null };
    render();
    startPollingTimer(render, DATE_POLL_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    return container;
}
