import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveChildCornerRadius, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup, startPollingTimer, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';

const DATE_POLL_INTERVAL_MS = 60_000;
const BASE_SCALE_SIZE = 200;
const TOP_BAR_RADIUS_PX = 12;
const DAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.title;
const DATE_FONT_SIZE_PX = 70;
const MONTH_FONT_SIZE_PX = TYPOGRAPHY_SIZE.title;
const SECONDARY_TEXT_OPACITY = TEXT_OPACITY.subtle;
const SECONDARY_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const MONTH_MARGIN_BOTTOM_PX = 8;

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
    connectShortClick(container, () => launchApplication('gnome-calendar'));
    const textColor = resolveWidgetForegroundColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const borderRadius = resolveWidgetCornerRadius(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    let scale = Math.min(width / BASE_SCALE_SIZE, height / BASE_SCALE_SIZE);

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(outerBox);

    const topBar = new St.Widget({
        x_expand: true,
        y_expand: true,
        style: `border-radius: ${borderRadius}px ${borderRadius}px 0 0;`,
        layout_manager: new Clutter.BinLayout(),
    });

    const dayLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DAY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${SECONDARY_FONT_WEIGHT}; opacity: ${SECONDARY_TEXT_OPACITY};`,
    });
    topBar.add_child(dayLabel);
    outerBox.add_child(topBar);

    const contentPanel = new St.Widget({
        x_expand: true,
        y_expand: true,
        style: `background-color: ${card}; border-radius: 0 0 ${resolveChildCornerRadius(TOP_BAR_RADIUS_PX, scale)}px ${resolveChildCornerRadius(TOP_BAR_RADIUS_PX, scale)}px;`,
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
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DATE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px; font-weight: ${TYPOGRAPHY_WEIGHT.black};`,
    });
    contentBox.add_child(dateNumber);

    const monthLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(MONTH_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${SECONDARY_FONT_WEIGHT}; `
            + `opacity: ${SECONDARY_TEXT_OPACITY}; margin-bottom: ${Math.round(MONTH_MARGIN_BOTTOM_PX * scale)}px;`,
    });
    contentBox.add_child(monthLabel);

    contentPanel.add_child(contentBox);
    outerBox.add_child(contentPanel);

    function applyScale(newScale) {
        scale = newScale;
        dayLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DAY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${SECONDARY_FONT_WEIGHT}; opacity: ${SECONDARY_TEXT_OPACITY};`;
        dateNumber.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DATE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px; font-weight: ${TYPOGRAPHY_WEIGHT.black};`;
        monthLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(MONTH_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${SECONDARY_FONT_WEIGHT}; `
            + `opacity: ${SECONDARY_TEXT_OPACITY}; margin-bottom: ${Math.round(MONTH_MARGIN_BOTTOM_PX * scale)}px;`;
    }

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

    attachResponsiveScaler(container, BASE_SCALE_SIZE, BASE_SCALE_SIZE, (scale) => {
        applyScale(scale);
    });

    return container;
}
