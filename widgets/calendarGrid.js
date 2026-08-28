import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba, resolveTextOnAccentColor } from '../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, connectTimerCleanup, startPollingTimer, MONTH_NAMES_ABBREVIATED as MONTH_NAMES } from '../shell/widgetUIUtils.js';

const REF_SIZE_PX = 170;
const REF_PADDING_PX = 16;
const HEADER_FONT_SIZE_PX = 13;
const WEEKDAY_FONT_SIZE_PX = 8;
const DAY_FONT_SIZE_PX = 11;

// How often to re-check whether the date has rolled over.
const DATE_POLL_INTERVAL_MS = 60000;
const ROW_GAP_PX = 4;

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKS_IN_GRID = 6;

const SECONDARY_TEXT_OPACITY = 0.3;
const WEEKDAY_TEXT_OPACITY = 0.45;
const WEEKEND_TEXT_OPACITY = 0.55;
const HEADER_GAP_PX = 10;
const BORDER_ALPHA = 0.14;

function getDaysInMonth(year, month) {
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}

export function createCalendarGridNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const state = {
        scale: Math.min(width / REF_SIZE_PX, height / REF_SIZE_PX),
        timerId: null,
        dayEntries: [],
        daySlots: [],
        weekdayCells: [],
    };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    const headerLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.START,
    });
    contentBox.add_child(headerLabel);

    const weekdaysRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    contentBox.add_child(weekdaysRow);

    const weekdaySlots = [];
    for (let i = 0; i < 7; i++) {
        const slot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const label = new St.Label({
            text: WEEKDAY_LABELS[i],
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        slot.add_child(label);
        weekdaysRow.add_child(slot);
        weekdaySlots.push(label);
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

        for (let col = 0; col < 7; col++) {
            const slot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            const label = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            slot.add_child(label);
            rowBox.add_child(slot);
            state.daySlots.push(slot);
            state.dayEntries.push(label);
        }
    }

    function baseDayStyle(fontSizePx) {
        return `${fontCss}color: ${textColor}; font-size: ${fontSizePx}px;`;
    }

    function fillDays() {
        const now = GLib.DateTime.new_now_local();
        const year = now.get_year();
        const month = now.get_month();
        const today = now.get_day_of_month();

        headerLabel.text = `${MONTH_NAMES[month - 1]} ${year}`;

        const firstDayCol = GLib.DateTime.new_local(year, month, 1, 12, 0, 0).get_day_of_week() % 7;
        const daysInMonth = getDaysInMonth(year, month);
        const fontSize = Math.round(DAY_FONT_SIZE_PX * state.scale);

        for (let cell = 0; cell < state.dayEntries.length; cell++) {
            const dayNumber = cell - firstDayCol + 1;
            const label = state.dayEntries[cell];

            if (dayNumber < 1 || dayNumber > daysInMonth) {
                label.text = '';
                label.style = `${baseDayStyle(fontSize)} opacity: ${SECONDARY_TEXT_OPACITY};`;
                continue;
            }

            if (dayNumber === today) {
                // Safe to pad the label now: columns are pinned in
                // applyLayout(), and symmetric padding keeps the label
                // centered inside its fixed-width slot, so alignment holds.
                const pad = Math.round(4 * state.scale);
                label.text = String(dayNumber);
                const todayTextColor = resolveTextOnAccentColor(config.globalAccentColor || '#3584e4');
                label.style = `${fontCss}font-size: ${fontSize}px; color: ${todayTextColor};`
                    + `background-color: ${cssColorToRgba(config.globalAccentColor || '#3584e4', 1)};`
                    + `border-radius: 999px;`
                    + `padding: ${pad}px ${pad}px;`;
                continue;
            }

            const isWeekend = cell % 7 === 0 || cell % 7 === 6;
            label.text = String(dayNumber);
            label.style = isWeekend
                ? `${baseDayStyle(fontSize)} opacity: ${WEEKEND_TEXT_OPACITY};`
                : baseDayStyle(fontSize);
        }
    }

    function applyLayout(currentWidth) {
        const s = state.scale;
        const pad = Math.round(REF_PADDING_PX * s);

        contentBox.style = `padding: ${pad}px;`;

        // Pin every cell of every row to the same column width so rows share
        // identical geometry. Without this, each row's BoxLayout computes its
        // own slot sizes from content (empty cells, bold digits), and columns
        // drift out of alignment between rows.
        const colWidth = Math.max(1, Math.floor((currentWidth - (pad * 2)) / 7));
        state.weekdayCells.forEach(slot => {
            slot.x_expand = false;
            slot.width = colWidth;
        });
        state.daySlots.forEach(slot => {
            slot.x_expand = false;
            slot.width = colWidth;
        });

        headerLabel.translation_y = -Math.round(3 * s);
        headerLabel.style = `${fontCss}color: ${textColor};`
            + `font-size: ${Math.round(HEADER_FONT_SIZE_PX * s)}px; font-weight: 700;`
            + `margin-bottom: ${Math.round(HEADER_GAP_PX * s)}px;`;

        weekdaySlots.forEach(label => {
            label.style = `${fontCss}font-size: ${Math.round(WEEKDAY_FONT_SIZE_PX * s)}px; `
                + `color: ${textColor}; opacity: ${WEEKDAY_TEXT_OPACITY};`;
        });

        // Align the month's left edge exactly with the first weekday glyph
        // below it. Weekday labels are centered inside their pinned columns,
        // so mirror that centering offset onto the header. Measured after the
        // weekday styles above so the font metrics are up to date.
        const [, sunNaturalWidth] = weekdaySlots[0].get_preferred_width(-1);
        headerLabel.translation_x = Math.max(0, Math.floor((colWidth - sunNaturalWidth) / 2));

        daysGrid.style = `spacing: ${Math.round(ROW_GAP_PX * s)}px;`;

        fillDays();
    }

    let lastRenderedDayKey = '';

    // Refills the grid only when the calendar day actually rolled over.
    const refreshIfNewDay = () => {
        const now = GLib.DateTime.new_now_local();
        const dayKey = `${now.get_year()}-${now.get_month()}-${now.get_day_of_month()}`;
        if (dayKey === lastRenderedDayKey) return GLib.SOURCE_CONTINUE;
        lastRenderedDayKey = dayKey;
        fillDays();
        return GLib.SOURCE_CONTINUE;
    };

    applyLayout(width);
    attachResponsiveScaler(container, REF_SIZE_PX, REF_SIZE_PX, (_ratio, w, h) => {
        state.scale = Math.min(w / REF_SIZE_PX, h / REF_SIZE_PX);
        applyLayout(w);
    });
    startPollingTimer(refreshIfNewDay, DATE_POLL_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    return container;
}
