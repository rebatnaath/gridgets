import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    CALENDAR_WEEKDAY_NAMES, resolveAccentColor, resolveTextOnAccentColor,
    resolveWidgetSurfaces, resolveWidgetBackgroundColor, blendCssColor,
} from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { MONTH_NAMES, GRID_REF_PADDING_PX, getDaysInMonth, getColumnForDate, isWeekend, toDateKey } from './calendarCommon.js';
import { connectDoubleClick } from '../../utils/widgetInteractions.js';

const ROW_GAP_PX = 4;
const HEADER_BOX_SPACING_PX = 4;
const WEEKS_IN_GRID = 6;
const DAY_CELL_SPACING_PX = 1;
const SECONDARY_TEXT_OPACITY = 0.3;
const HEADER_ROW_GAP_PX = 6;

/**
 * One type scale per widget: the standalone calendar is a compact 5x4 grid while the
 * agenda is a much larger 7x4, and at the standalone's sizes one shared scale leaves
 * the agenda under-filled. The agenda's day column also reads its weekday label from
 * here so it matches the month title beside it.
 */
const COMPACT_TYPE_SCALE = Object.freeze({
    headerSize: TYPOGRAPHY_SIZE.compact,
    headerMinSize: MIN_FONT_SIZE.metadata,
    headerWeight: TYPOGRAPHY_WEIGHT.bold,
    weekdaySize: TYPOGRAPHY_SIZE.metadata,
    weekdayMinSize: MIN_FONT_SIZE.metadata,
    weekdayWeight: TYPOGRAPHY_WEIGHT.semibold,
    weekdayOpacity: TEXT_OPACITY.metadata,
    daySize: TYPOGRAPHY_SIZE.metadata,
    dayMinSize: MIN_FONT_SIZE.metadata,
    dayWeight: TYPOGRAPHY_WEIGHT.regular,
    todayWeight: TYPOGRAPHY_WEIGHT.bold,
    eventSize: TYPOGRAPHY_SIZE.metadata,
    eventMinSize: MIN_FONT_SIZE.metadata,
    eventWeight: TYPOGRAPHY_WEIGHT.regular,
    navIconSize: 9,
    navIconMinSize: 6,
});

const AGENDA_TYPE_SCALE = Object.freeze({
    headerSize: TYPOGRAPHY_SIZE.title,
    headerMinSize: MIN_FONT_SIZE.subtitle,
    headerWeight: TYPOGRAPHY_WEIGHT.extrabold,
    weekdaySize: TYPOGRAPHY_SIZE.body,
    weekdayMinSize: MIN_FONT_SIZE.body,
    weekdayWeight: TYPOGRAPHY_WEIGHT.extrabold,
    weekdayOpacity: TEXT_OPACITY.subtle,
    daySize: TYPOGRAPHY_SIZE.body,
    dayMinSize: MIN_FONT_SIZE.body,
    dayWeight: TYPOGRAPHY_WEIGHT.regular,
    todayWeight: TYPOGRAPHY_WEIGHT.extrabold,
    eventSize: TYPOGRAPHY_SIZE.body,
    eventMinSize: MIN_FONT_SIZE.body,
    eventWeight: TYPOGRAPHY_WEIGHT.medium,
    navIconSize: 15,
    navIconMinSize: 12,
});

export { COMPACT_TYPE_SCALE, AGENDA_TYPE_SCALE };

/**
 * Owns the displayed month.
 */
export function createMonthGrid({
    container,
    config,
    calendarState,
    textColor,
    fontCss,
    onMonthChanged,
    onSelectedDate = null,
    typeScale = COMPACT_TYPE_SCALE,
}) {
    const state = {
        scale: 1,
        displayDate: GLib.DateTime.new_now_local(),
        eventDates: new Set(),
        selectedDateKey: null,
        dayEntries: [],
        daySlots: [],
        cellDates: [],
        weekdayCells: [],
        weekdaySlots: [],
        rowBoxes: [],
        eventDotSlots: [],
    };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: `spacing: ${HEADER_BOX_SPACING_PX}px;`,
    });
    const headerLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerSpacer = new St.Widget({ x_expand: true });
    headerBox.add_child(headerLabel);
    headerBox.add_child(headerSpacer);
    contentBox.add_child(headerBox);

    const weekdaysRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    contentBox.add_child(weekdaysRow);

    for (let i = 0; i < 7; i++) {
        const slot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const label = new St.Label({
            text: '',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        slot.add_child(label);
        weekdaysRow.add_child(slot);
        state.weekdaySlots.push(label);
        state.weekdayCells.push(slot);
    }

    const daysGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        x_expand: true,
    });
    contentBox.add_child(daysGrid);

    for (let row = 0; row < WEEKS_IN_GRID; row++) {
        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_expand: true,
            x_expand: true,
        });
        daysGrid.add_child(rowBox);
        state.rowBoxes.push(rowBox);

        for (let col = 0; col < 7; col++) {
            // Mirrors the weekday cell: a BinLayout slot holding the number and the
            // dot stack, so the number stays centred with the dot underneath it.
            const slot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
                // Only reactive when a caller wants day clicks, so the standalone
                // calendar does not intercept presses meant for the desktop grid.
                reactive: onSelectedDate !== null,
            });
            const cellBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `spacing: ${DAY_CELL_SPACING_PX}px;`,
            });
            const label = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const eventDot = new St.Widget({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            cellBox.add_child(label);
            cellBox.add_child(eventDot);
            slot.add_child(cellBox);
            rowBox.add_child(slot);
            state.daySlots.push(slot);
            state.dayEntries.push(label);
            state.cellDates.push(null);
            state.eventDotSlots.push(eventDot);

            if (onSelectedDate) {
                const cellIndex = state.daySlots.length - 1;
                // Propagated so a single press stays free for the desktop grid to drag.
                connectDoubleClick(slot, () => {
                    const dateKey = state.cellDates[cellIndex];
                    if (!dateKey)
                        return;
                    const [cellYear, cellMonth, cellDay] = dateKey.split('-').map(Number);
                    onSelectedDate(GLib.DateTime.new_local(cellYear, cellMonth, cellDay, 12, 0, 0));
                });
            }
        }
    }

    function baseDayStyle(fontSizePx) {
        return `${fontCss}color: ${textColor}; font-size: ${fontSizePx}px; font-weight: ${typeScale.dayWeight};`;
    }

    /**
     * Today and a picked day are pills of one size, so a row keeps its height
     * whichever mark it carries.
     */
    function pillStyle(fontSizePx, background, textOnBackground) {
        const pad = Math.round(4 * state.scale);
        return `${fontCss}font-size: ${fontSizePx}px; font-weight: ${typeScale.todayWeight};`
            + `color: ${textOnBackground};`
            + `background-color: ${background};`
            + `border-radius: 999px;`
            + `padding: ${pad}px ${pad}px;`;
    }

    function fillDays() {
        const now = GLib.DateTime.new_now_local();
        const year = state.displayDate.get_year();
        const month = state.displayDate.get_month();
        const isCurrentMonth = year === now.get_year() && month === now.get_month();
        const today = isCurrentMonth ? now.get_day_of_month() : -1;

        headerLabel.text = MONTH_NAMES[month - 1];

        const firstDayCol = getColumnForDate(GLib.DateTime.new_local(year, month, 1, 12, 0, 0), calendarState.firstDay);
        const daysInMonth = getDaysInMonth(year, month);
        const fontSize = scaleFontSize(typeScale.daySize, state.scale, typeScale.dayMinSize);
        const accentHex = resolveAccentColor(config);

        // All six rows are always built so the columns stay pinned; hiding the unused
        // one lets the rest fill the height.
        const rowsNeeded = Math.ceil((firstDayCol + daysInMonth) / 7);
        state.rowBoxes.forEach((rowBox, row) => {
            rowBox.visible = row < rowsNeeded;
        });

        for (let cell = 0; cell < state.dayEntries.length; cell++) {
            const dayNumber = cell - firstDayCol + 1;
            const label = state.dayEntries[cell];

            if (dayNumber < 1 || dayNumber > daysInMonth) {
                label.text = '';
                label.style = `${baseDayStyle(fontSize)} opacity: ${SECONDARY_TEXT_OPACITY};`;
                state.eventDotSlots[cell].visible = false;
                state.cellDates[cell] = null;
                continue;
            }

            const date = GLib.DateTime.new_local(year, month, dayNumber, 12, 0, 0);
            const dateKey = toDateKey(year, month, dayNumber);
            state.cellDates[cell] = dateKey;
            state.eventDotSlots[cell].visible = state.eventDates.has(dateKey);
            // Symmetric padding keeps the label centred in its pinned column.
            if (dayNumber === today) {
                label.text = String(dayNumber);
                label.style = pillStyle(fontSize, accentHex, resolveTextOnAccentColor(accentHex));
                continue;
            }

            // Today keeps its accent pill, so picking it is a no-op.
            if (state.selectedDateKey === dateKey) {
                const { highlight } = resolveWidgetSurfaces(config);
                // A theme with no highlight of its own derives a translucent white, so
                // the text has to suit the flattened result, not the raw value.
                const onHighlight = resolveTextOnAccentColor(
                    blendCssColor(highlight, resolveWidgetBackgroundColor(config)));
                label.text = String(dayNumber);
                label.style = pillStyle(fontSize, highlight, onHighlight);
                continue;
            }

            label.text = String(dayNumber);
            const isAccentDay = calendarState.accentWeekends
                && isWeekend(date, calendarState.weekendDays);
            label.style = isAccentDay
                ? `${baseDayStyle(fontSize)} color: ${accentHex};`
                : baseDayStyle(fontSize);
        }
    }

    /** @param currentScale Passed in so the caller need not reach into this state. */
    function applyLayout(currentWidth, currentScale) {
        state.scale = currentScale;
        const pad = Math.round(GRID_REF_PADDING_PX * currentScale);
        const accentHex = resolveAccentColor(config);

        contentBox.style = `padding: ${pad}px ${pad}px ${pad + Math.max(3, Math.round(6 * currentScale))}px;`;

        // Pinned so every row shares identical geometry; left to itself each row's
        // BoxLayout sizes from its own content and the columns drift out of alignment.
        const colWidth = Math.max(1, Math.floor((currentWidth - (pad * 2)) / 7));
        state.weekdayCells.forEach(slot => {
            slot.x_expand = false;
            slot.width = colWidth;
        });
        state.daySlots.forEach(slot => {
            slot.x_expand = false;
            slot.width = colWidth;
        });

        headerLabel.style = `${fontCss}color: ${accentHex};`
            + `font-size: ${scaleFontSize(typeScale.headerSize, currentScale, typeScale.headerMinSize)}px; font-weight: ${typeScale.headerWeight};`;
        headerBox.style = `spacing: ${Math.round(HEADER_BOX_SPACING_PX * currentScale)}px;`
            + `margin-bottom: ${Math.round(HEADER_ROW_GAP_PX * currentScale)}px;`;

        state.weekdaySlots.forEach((label, index) => {
            const dayName = CALENDAR_WEEKDAY_NAMES[(calendarState.firstDay + index) % 7].toLowerCase();
            const isAccentDay = calendarState.accentWeekends
                && calendarState.weekendDays.has(dayName);
            label.text = dayName.slice(0, 1).toUpperCase();
            label.style = `${fontCss}font-size: ${scaleFontSize(typeScale.weekdaySize, currentScale, typeScale.weekdayMinSize)}px; `
                + `color: ${isAccentDay ? accentHex : textColor};`
                + ` opacity: ${isAccentDay ? 1 : typeScale.weekdayOpacity}; font-weight: ${typeScale.weekdayWeight};`;
        });

        const dotSize = Math.max(2, Math.round(3 * currentScale));
        state.eventDotSlots.forEach(dot => {
            dot.style = `width: ${dotSize}px;`
                + `height: ${dotSize}px;`
                + `border-radius: 999px; background-color: ${accentHex};`;
        });

        // The weekday labels are centred in their pinned columns, so the same offset
        // is mirrored onto the header, measured after their styles to get fresh metrics.
        const [, firstWeekdayWidth] = state.weekdaySlots[0].get_preferred_width(-1);
        headerLabel.translation_x = Math.max(0, Math.floor((colWidth - firstWeekdayWidth) / 2));

        daysGrid.style = `spacing: ${Math.round(ROW_GAP_PX * currentScale)}px;`;

        fillDays();
    }

    return {
        setSelectedDate(date) {
            state.selectedDateKey = date
                ? toDateKey(date.get_year(), date.get_month(), date.get_day_of_month())
                : null;
            fillDays();
        },
        setEventDates(dates) {
            state.eventDates = dates;
            fillDays();
        },
        get displayDate() {
            return state.displayDate;
        },
        fillDays,
        applyLayout,
        refreshForNewDay() {
            const now = GLib.DateTime.new_now_local();
            state.displayDate = now;
            fillDays();
            onMonthChanged(state.displayDate);
        },
    };
}
