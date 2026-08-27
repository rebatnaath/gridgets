import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { SECONDARY_OPACITY, parseCssColor, resolveExplicitFontFamily, resolveWidgetForegroundColor } from '../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback, connectTimerCleanup, startPollingTimer } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';
import { todayDateString, toDateString, loadDatesAsync, getMood, saveMood } from '../utils/moodStore.js';

const REF_WIDTH_PX = 380;
const REF_HEIGHT_PX = 160;
const CONTAINER_PADDING_PX = 20;
const PANEL_GAP_PX = 24;
const LEFT_COLUMN_WIDTH_PX = 140;

const GREETING_FONT_SIZE_PX = 18;
const DATE_FONT_SIZE_PX = 14;
const HISTORY_LABEL_FONT_SIZE_PX = 12;
const PICKER_ROW_PADDING_PX = 6;
const PICKER_ROW_RADIUS_PX = 16;
const FACE_ICON_SIZE_PX = 22;
const DOT_SIZE_PX = 12;
const DOT_GRID_GAP_PX = 8;
const GRID_COLUMNS = 7;
const TOTAL_DAYS = 28;
const TODAY_DOT_BORDER_PX = 2;
const BORDER_ALPHA = 0.14;

// Mood ramp; Adwaita face icons double as pickers, colors drive the history grid.
const MOOD_LEVELS = [
    { level: 1, iconName: 'face-sad-symbolic', color: '#F43F5E' },
    { level: 2, iconName: 'face-worried-symbolic', color: '#F97316' },
    { level: 3, iconName: 'face-plain-symbolic', color: '#EAB308' },
    { level: 4, iconName: 'face-smile-symbolic', color: '#22C55E' },
    { level: 5, iconName: 'face-laugh-symbolic', color: '#3B82F6' },
];

function buildTrailingDateKeys() {
    const now = GLib.DateTime.new_now_local();
    const keys = [];
    for (let daysAgo = TOTAL_DAYS - 1; daysAgo >= 0; daysAgo--) {
        keys.push(toDateString(now.add_days(-daysAgo)));
    }
    return keys;
}

function greetingForHour(hour) {
    if (hour < 5) return 'Good night';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

function formatDisplayDate(dateTime) {
    return `${dateTime.format('%a')}, ${dateTime.format('%b')} ${dateTime.get_day_of_month()}`;
}

export function createMoodNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;
    container.style += ` border: 1px solid rgba(${textRgb()}, ${BORDER_ALPHA});`;

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);

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
            child: new St.Icon({ icon_name: mood.iconName, icon_size: FACE_ICON_SIZE_PX }),
        });
        button.moodLevel = mood.level;
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
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px; spacing: ${px(PANEL_GAP_PX)}px;`;
        actionPanel.style = `width: ${px(LEFT_COLUMN_WIDTH_PX)}px; spacing: 4px;`;
        greetingLabel.style = `${fontCss}font-size: ${px(GREETING_FONT_SIZE_PX)}px; `
            + `font-weight: 300; color: ${textColor};`;
        dateLabel.style = `${fontCss}font-size: ${px(DATE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        faceRow.style = `background-color: rgba(${textRgb()}, 0.08);`
            + `padding: ${px(PICKER_ROW_PADDING_PX)}px; border-radius: ${px(PICKER_ROW_RADIUS_PX)}px;`;

        for (const button of state.moodButtons) {
            const level = MOOD_LEVELS.find(mood => mood.level === button.moodLevel);
            const isActive = getMood(todayDateString()) === level.level;
            applyButtonStyle(button, level, isActive, px(FACE_ICON_SIZE_PX));
        }

        historyLabel.style = `${fontCss}font-size: ${px(HISTORY_LABEL_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`
            + `margin-bottom: ${px(12)}px;`;

        renderDotGrid();
    }

    function applyButtonStyle(button, level, isActive, iconSizePx) {
        button.child.icon_size = iconSizePx;
        button.child.opacity = isActive ? 255 : 115;
        button.style = isActive
            ? `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.1);`
            : 'border-radius: 9999px;';
    }

    function buildDot(dateKey, isToday) {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const level = getMood(dateKey);
        const size = isToday ? px(DOT_SIZE_PX + TODAY_DOT_BORDER_PX) : px(DOT_SIZE_PX);

        const dot = new St.Widget({
            width: size,
            height: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let dotStyle = `border-radius: 9999px; width: ${size}px; height: ${size}px;`;
        if (level > 0) {
            const mood = MOOD_LEVELS.find(entry => entry.level === level);
            dotStyle += `background-color: ${mood.color};`;
        } else {
            dotStyle += `background-color: rgba(${textRgb()}, 0.15);`;
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
                applyTodayButtonStates();
            });
        }
    }

    // Reflects today's stored mood on the face picker buttons.
    function applyTodayButtonStates() {
        const todayLevel = getMood(todayDateString());
        for (const button of state.moodButtons) {
            const mood = MOOD_LEVELS.find(entry => entry.level === button.moodLevel);
            applyButtonStyle(button, mood, mood.level === todayLevel, Math.max(1, Math.round(FACE_ICON_SIZE_PX * scale)));
        }
    }

    function setMood(level) {
        const todayKey = todayDateString();
        saveMood(todayKey, level);

        for (const button of state.moodButtons) {
            const mood = MOOD_LEVELS.find(entry => entry.level === button.moodLevel);
            applyButtonStyle(button, mood, mood.level === level, Math.max(1, Math.round(FACE_ICON_SIZE_PX * scale)));
        }
        renderDotGrid();
    }

    const MINUTE_REFRESH_INTERVAL_MS = 60000;
    startPollingTimer(refreshClockDependents, MINUTE_REFRESH_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    applyScale(scale);
    loadDatesAsync(state.dateKeys, () => {
        if (isActorDestroyed(container)) return;
        renderDotGrid();
        const todayLevel = getMood(todayDateString());
        if (todayLevel > 0) {
            setMood(todayLevel);
        }
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    return container;
}
