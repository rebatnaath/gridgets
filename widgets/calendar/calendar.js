import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup, startPollingTimer, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';
import { MONTH_NAMES, DATE_POLL_INTERVAL_MS, weekdayIndex } from './calendarCommon.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';

const BASE_SCALE_SIZE = 200;
const DAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.title;
const DATE_FONT_SIZE_PX = 70;
const MONTH_FONT_SIZE_PX = TYPOGRAPHY_SIZE.title;
const MONTH_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.bold;
const SECONDARY_TEXT_OPACITY = TEXT_OPACITY.subtle;
const SECONDARY_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.semibold;
const MONTH_MARGIN_BOTTOM_PX = 8;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createCalendarNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    connectShortClick(container, () => launchApplication('gnome-calendar'));
    const textColor = resolveWidgetForegroundColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const borderRadius = resolveWidgetCornerRadius(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    let scale = clampWidgetScale(Math.min(width / BASE_SCALE_SIZE, height / BASE_SCALE_SIZE));

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(outerBox);

    const topBar = new St.Widget({
        x_expand: true,
        y_expand: true,
        layout_manager: new Clutter.BinLayout(),
    });

    const dayLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    topBar.add_child(dayLabel);
    outerBox.add_child(topBar);

    const contentPanel = new St.Widget({
        x_expand: true,
        y_expand: true,
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
    });
    contentBox.add_child(dateNumber);

    const monthLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
    });
    contentBox.add_child(monthLabel);

    contentPanel.add_child(contentBox);
    outerBox.add_child(contentPanel);

    function applyScale(newScale) {
        scale = newScale;
        // The container's own radius, unscaled: buildBaseWidgetStyle sets it once from the
        // config, so a scaled or separately-defaulted panel would round differently from
        // the corners it is supposed to meet.
        topBar.style = `border-radius: ${borderRadius}px ${borderRadius}px 0 0;`;
        contentPanel.style = `background-color: ${card};`
            + `border-radius: 0 0 ${borderRadius}px ${borderRadius}px;`;
        dayLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DAY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${SECONDARY_FONT_WEIGHT}; opacity: ${SECONDARY_TEXT_OPACITY};`;
        dateNumber.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DATE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px; font-weight: ${TYPOGRAPHY_WEIGHT.black};`;
        monthLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(MONTH_FONT_SIZE_PX, scale, MIN_FONT_SIZE.title)}px; font-weight: ${MONTH_FONT_WEIGHT}; `
            + `opacity: ${SECONDARY_TEXT_OPACITY}; margin-bottom: ${Math.round(MONTH_MARGIN_BOTTOM_PX * scale)}px;`;
    }

    function render() {
        const now = GLib.DateTime.new_now_local();
        dayLabel.set_text(DAY_NAMES[weekdayIndex(now)]);
        dateNumber.set_text(String(now.get_day_of_month()));
        monthLabel.set_text(MONTH_NAMES[now.get_month() - 1]);
    }

    const state = { timerId: null };
    render();
    startPollingTimer(render, DATE_POLL_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    // Before the scaler is attached, whose first pass is deferred to an idle: both panel
    // styles live in applyScale, so without this they paint one frame unstyled.
    applyScale(scale);
    attachResponsiveScaler(container, BASE_SCALE_SIZE, BASE_SCALE_SIZE, (scale) => {
        applyScale(scale);
    });

    return container;
}
