import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveChildCornerRadius, DEFAULT_CHILD_CORNER_RADIUS_PX, MOOD_LEVELS } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, ICON_OPACITY_SECONDARY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback, connectTimerCleanup, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { todayDateString, toDateString, loadDatesAsync, getMood, saveMood } from '../../utils/moodStore.js';

const REF_WIDTH_PX = 380;
const REF_HEIGHT_PX = 160;
const CONTAINER_PADDING_PX = 20;
const PANEL_GAP_PX = 24;
const LEFT_COLUMN_WIDTH_PX = 140;

const GREETING_FONT_SIZE_PX = TYPOGRAPHY_SIZE.title;
const DATE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const HISTORY_LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.body;
const PICKER_ROW_PADDING_PX = 6;
const PICKER_ROW_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const FACE_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconLg;
const DOT_SIZE_PX = 12;
const DOT_GRID_GAP_PX = 8;
const GRID_COLUMNS = 7;
const TOTAL_DAYS = 28;
const TODAY_DOT_BORDER_PX = 2;
const PILL_RADIUS_PX = 999;
const CLUTTER_OPACITY_OPAQUE = 255;
const ACTION_PANEL_SPACING_PX = 4;
const GREETING_WIDTH_PX = 100;
const HISTORY_LABEL_MARGIN_BOTTOM_PX = 12;

function buildTrailingDateKeys() {
    const now = GLib.DateTime.new_now_local();
    const keys = [];
    for (let daysAgo = TOTAL_DAYS - 1; daysAgo >= 0; daysAgo--) {
        keys.push(toDateString(now.add_days(-daysAgo)));
    }
    return keys;
}

function greetingForHour(hour) {
    if (hour < 5) return 'Good\nnight';
    if (hour < 12) return 'Good\nmorning';
    if (hour < 17) return 'Good\nafternoon';
    return 'Good\nevening';
}

function formatDisplayDate(dateTime) {
    return `${dateTime.format('%a')}, ${dateTime.format('%b')} ${dateTime.get_day_of_month()}`;
}

export function createMoodNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);


    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    const px = value => Math.max(1, Math.round(value * scale));

    const state = { dateKeys: buildTrailingDateKeys(), moodButtons: [] };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const actionPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'spacing',
    });
    mainBox.add_child(actionPanel);

    const greetingLabel = new St.Label({
        text: greetingForHour(GLib.DateTime.new_now_local().get_hour()),
    });

    const dateLabel = new St.Label({
        text: formatDisplayDate(GLib.DateTime.new_now_local()),
    });
    actionPanel.add_child(greetingLabel);
    actionPanel.add_child(dateLabel);
    actionPanel.add_child(new St.Widget({ y_expand: true }));

    const faceRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    actionPanel.add_child(faceRow);

    for (const mood of MOOD_LEVELS) {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            child: new St.Icon({ icon_name: mood.icon, icon_size: FACE_ICON_SIZE_PX }),
        });
        button.mood = mood;
        button.connect('clicked', () => setMood(mood.level));
        faceRow.add_child(button);
        attachButtonFeedback(button);
        state.moodButtons.push(button);
    }

    const historyPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    mainBox.add_child(historyPanel);

    const historyLabel = new St.Label({ text: 'Past 28 Days' });
    historyPanel.add_child(historyLabel);

    const dotGrid = new St.Widget({
        layout_manager: new Clutter.GridLayout({
            column_spacing: DOT_GRID_GAP_PX,
            row_spacing: DOT_GRID_GAP_PX,
        }),
    });
    historyPanel.add_child(dotGrid);

    function applyScale(newScale) {
        scale = newScale;
        const fontPx = (value, minimum) => scaleFontSize(value, scale, minimum);

        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px; spacing: ${px(PANEL_GAP_PX)}px;`;
        actionPanel.style = `width: ${px(LEFT_COLUMN_WIDTH_PX)}px; spacing: ${px(ACTION_PANEL_SPACING_PX)}px;`;
        greetingLabel.style = `${fontCss}font-size: ${fontPx(GREETING_FONT_SIZE_PX, MIN_FONT_SIZE.title)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.extrabold}; color: ${textColor};`;
        greetingLabel.width = px(GREETING_WIDTH_PX);
        greetingLabel.clutter_text.line_wrap = false;
        dateLabel.style = `${fontCss}font-size: ${fontPx(DATE_FONT_SIZE_PX, MIN_FONT_SIZE.subtitle)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;

        faceRow.style = `background-color: ${card};`
            + `padding: ${px(PICKER_ROW_PADDING_PX)}px; border-radius: ${resolveChildCornerRadius(PICKER_ROW_RADIUS_PX, scale)}px;`;

        applyMoodSelection(getMood(todayDateString()));

        historyLabel.style = `${fontCss}font-size: ${fontPx(HISTORY_LABEL_FONT_SIZE_PX, MIN_FONT_SIZE.body)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`
            + `margin-bottom: ${px(HISTORY_LABEL_MARGIN_BOTTOM_PX)}px;`;

        renderDotGrid();
    }

    function applyButtonStyle(button, isActive) {
        button.child.icon_size = px(FACE_ICON_SIZE_PX);
        button.child.opacity = isActive ? CLUTTER_OPACITY_OPAQUE : Math.round(CLUTTER_OPACITY_OPAQUE * ICON_OPACITY_SECONDARY);
        button.style = isActive
            ? `border-radius: ${PILL_RADIUS_PX}px; background-color: ${highlight};`
            : `border-radius: ${PILL_RADIUS_PX}px;`;
    }

    // Single place that reflects the active mood on the face picker buttons.
    function applyMoodSelection(activeLevel) {
        for (const button of state.moodButtons)
            applyButtonStyle(button, button.mood.level === activeLevel);
    }

    function buildDot(dateKey, isToday) {
        const level = getMood(dateKey);
        const size = isToday ? px(DOT_SIZE_PX + TODAY_DOT_BORDER_PX) : px(DOT_SIZE_PX);

        const dot = new St.Widget({
            width: size,
            height: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let dotStyle = `border-radius: ${PILL_RADIUS_PX}px; width: ${size}px; height: ${size}px;`;
        if (level > 0) {
            dotStyle += `background-color: ${MOOD_LEVELS[level - 1].color};`;
        } else {
            dotStyle += `background-color: ${card};`;
        }
        if (isToday) {
            dotStyle += `border: ${px(TODAY_DOT_BORDER_PX)}px solid ${textColor};`;
        }
        dot.style = dotStyle;
        return dot;
    }

    function renderDotGrid() {
        const layout = dotGrid.layout_manager;
        dotGrid.destroy_all_children();

        state.dateKeys.forEach((dateKey, index) => {
            const column = index % GRID_COLUMNS;
            const row = Math.floor(index / GRID_COLUMNS);
            layout.attach(buildDot(dateKey, index === state.dateKeys.length - 1), column, row, 1, 1);
        });
    }

    // Re-renders dynamic parts when the day or hour rolls over.
    function refreshClockDependents() {
        const now = GLib.DateTime.new_now_local();
        greetingLabel.text = greetingForHour(now.get_hour());
        dateLabel.text = formatDisplayDate(now);

        const todayKey = todayDateString();
        const lastKey = state.dateKeys[state.dateKeys.length - 1];
        if (todayKey !== lastKey) {
            state.dateKeys = buildTrailingDateKeys();
            loadDatesAsync(state.dateKeys, () => {
                if (isActorDestroyed(container)) return;
                renderDotGrid();
                applyMoodSelection(getMood(todayDateString()));
            });
        }
    }

    function setMood(level) {
        saveMood(todayDateString(), level);
        applyMoodSelection(level);
        renderDotGrid();
    }

    const MINUTE_REFRESH_INTERVAL_MS = 60000;
    startPollingTimer(refreshClockDependents, MINUTE_REFRESH_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    applyScale(scale);
    loadDatesAsync(state.dateKeys, () => {
        if (isActorDestroyed(container)) return;
        renderDotGrid();
        applyMoodSelection(getMood(todayDateString()));
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyScale(scale);
    });

    return container;
}
