import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, COLUMNS_COUNT } from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, connectTimerCleanup, registerWidgetCleanup, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { launchApplication } from '../../utils/widgetInteractions.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { watchCalendarSettings, watchCalendarEvents, eventDatesInMonth, watchDayRollover, toDateKey } from './calendarCommon.js';
import { createMonthGrid, AGENDA_TYPE_SCALE } from './monthGridPanel.js';
import { createDayColumn } from './dayColumnPanel.js';
import { clampWidgetScale } from '../../utils/typography.js';


const REF_WIDTH_PX = 420;
const REF_HEIGHT_PX = 240;
const PANEL_SPACING_PX = 8;

// Columns shifted to the month grid, which has seven day columns to fit.
const GRID_COLUMN_BIAS = 1;

// Sized to clear the widest weekday name, which shares the month title's font size.
const MIN_DAY_PANEL_PX = 120;

const DATE_POLL_INTERVAL_MS = 60000;

export function createCalendarAgendaNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    // No click handler on the container: a click in the grid is a drag or a double click.

    const state = {
        eventsByDate: new Map(),
        eventCancellable: new Gio.Cancellable(),
        selectedDate: GLib.DateTime.new_now_local(),
        hasDateSelection: false,
        timerId: null,
    };

    // Comes first because the month grid reads its state from it, and its callback
    // cannot run until monthGrid is assigned.
    let monthGrid;
    const settingsWatcher = watchCalendarSettings(config.settings, () => {
        monthGrid.refreshWeekdays();
        monthGrid.fillDays();
    });

    const splitBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(splitBox);

    // The two halves are sized apart in applyLayout, not left to share evenly. Neither
    // host takes presses, so the widget stays a drag handle and only the day column's
    // own event area opens the app.
    const dayPanelHost = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
    });
    const gridPanelHost = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
    });
    splitBox.add_child(dayPanelHost);
    splitBox.add_child(gridPanelHost);

    const getEventsForDate = date => state.eventsByDate.get(toDateKey(
        date.get_year(), date.get_month(), date.get_day_of_month())) || [];

    const dayColumn = createDayColumn({
        container: dayPanelHost,
        config,
        textColor,
        fontCss,
        getEvents: getEventsForDate,
        onActivate: () => launchApplication('gnome-calendar'),
        typeScale: AGENDA_TYPE_SCALE,
    });

    monthGrid = createMonthGrid({
        container: gridPanelHost,
        config,
        calendarState: settingsWatcher.state,
        textColor,
        fontCss,
        typeScale: AGENDA_TYPE_SCALE,
        onMonthChanged: (displayDate) => {
            // Follow the month paged to, so the day column describes what is shown.
            state.selectedDate = displayDate;
            monthGrid.setEventDates(eventDatesInMonth(state.eventsByDate, displayDate));
            dayColumn.setDate(displayDate);
        },
        onSelectedDate: (date) => {
            // The grid keeps its own month, so this does not navigate.
            state.hasDateSelection = true;
            state.selectedDate = date;
            monthGrid.setSelectedDate(date);
            dayColumn.setDate(date);
        },
    });

    const eventWatcher = watchCalendarEvents({
        onEvents: (events) => {
            state.eventsByDate = events;
            monthGrid.setEventDates(eventDatesInMonth(events, monthGrid.displayDate));
            // Today is the starting selection, and the grid draws no extra mark for it.
            monthGrid.setSelectedDate(state.selectedDate);
            dayColumn.setDate(state.selectedDate);
        },
        isStale: () => isActorDestroyed(container),
        cancellable: state.eventCancellable,
    });

    registerWidgetCleanup(container, () => {
        settingsWatcher.dispose();
        eventWatcher.dispose();
        dayColumn.destroy();
        state.eventCancellable.cancel();
    });

    function applyLayout(currentWidth, currentHeight) {
        // Clamped like every other widget; left raw, a large agenda scaled its fonts
        // past twice their intended size.
        const currentScale = clampWidgetScale(
            Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX));
        const spacing = Math.round(PANEL_SPACING_PX * currentScale);
        const available = Math.max(2, currentWidth - spacing);
        const halfWidth = Math.floor(available / 2);

        // Measuring the bias in columns holds it at two real grid columns, where a
        // fixed pixel offset would not.
        const columnCount = config.width > 0 ? config.width : COLUMNS_COUNT;
        const columnWidthPx = available / columnCount;
        const idealDayWidth = halfWidth - (GRID_COLUMN_BIAS * columnWidthPx);
        // Neither half may be squeezed out entirely.
        const dayWidth = Math.max(1, Math.round(Math.min(
            Math.max(idealDayWidth, MIN_DAY_PANEL_PX),
            available - MIN_DAY_PANEL_PX)));
        const gridWidth = Math.max(1, available - dayWidth);

        splitBox.style = `spacing: ${spacing}px;`;
        dayPanelHost.width = dayWidth;
        gridPanelHost.width = gridWidth;
        dayColumn.applyLayout(currentScale, currentHeight);
        monthGrid.applyLayout(gridWidth, currentScale);
    }

    dayColumn.setDate(state.selectedDate);
    applyLayout(container.width || width, container.height || height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, currentWidth, currentHeight) => {
        applyLayout(currentWidth, currentHeight);
    });

    startPollingTimer(watchDayRollover(monthGrid, now => {
        if (!state.hasDateSelection)
            dayColumn.setDate(now);
    }), DATE_POLL_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    return container;
}
