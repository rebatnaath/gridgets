import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { CALENDAR_WEEKDAY_NAMES, resolveWidgetForegroundColor, resolveExplicitFontFamily, resolveTextOnAccentColor, resolveAccentColor, resolveChildCornerRadius, DEFAULT_CHILD_CORNER_RADIUS_PX, cssColorToRgba } from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, connectTimerCleanup, registerWidgetCleanup, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const REF_SIZE_PX = 170;
const REF_PADDING_PX = 12;
const HEADER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const WEEKDAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const NAV_BUTTON_SIZE_PX = 12;
const DAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const HEADER_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.bold;
const DAY_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.regular;
const TODAY_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.bold;

// How often to re-check whether the date has rolled over.
const DATE_POLL_INTERVAL_MS = 60000;
const ROW_GAP_PX = 4;
const HEADER_BOX_SPACING_PX = 4;
const DAY_CELL_SPACING_PX = 1;

const SUNDAY_FIRST_REGIONS = new Set(['US', 'CA', 'AU', 'NZ', 'IN', 'JP', 'KR', 'TW', 'HK', 'SG', 'PH', 'ZA', 'BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'VE', 'IL', 'EG', 'SA', 'AE', 'TH', 'ID', 'MY', 'CN']);
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKS_IN_GRID = 6;

const SECONDARY_TEXT_OPACITY = 0.3;
const WEEKDAY_TEXT_OPACITY = TEXT_OPACITY.metadata;
const HEADER_GAP_PX = 3;

function getDaysInMonth(year, month) {
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}

function resolveFirstDay(settings) {
    const override = settings.get_int('calendar-first-day');
    if (override >= 0 && override <= 6)
        return override;

    const desktopCalendar = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });
    const configuredDay = desktopCalendar.get_string('week-start-day');
    const configuredDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const configuredIndex = configuredDays.indexOf(configuredDay);
    if (configuredIndex >= 0)
        return configuredIndex;

    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const region = locale.match(/-([A-Z]{2})(?:-|$)/)?.[1] || '';
    return SUNDAY_FIRST_REGIONS.has(region) ? 0 : 1;
}

function resolveWeekendDays(settings) {
    return new Set(settings.get_strv('calendar-weekend-days')
        .filter(day => CALENDAR_WEEKDAY_NAMES.includes(day)));
}

export function createCalendarGridNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    connectShortClick(container, () => launchApplication('gnome-calendar'));

    const calendarSettings = config.settings;
    const calendarState = {
        firstDay: resolveFirstDay(calendarSettings),
        weekendDays: resolveWeekendDays(calendarSettings),
        accentWeekends: calendarSettings.get_boolean('calendar-weekend-accent'),
        settingIds: [],
    };

    const refreshCalendarSettings = () => {
        calendarState.firstDay = resolveFirstDay(calendarSettings);
        calendarState.weekendDays = resolveWeekendDays(calendarSettings);
        calendarState.accentWeekends = calendarSettings.get_boolean('calendar-weekend-accent');
        weekdaySlots.forEach((label, index) => {
            label.text = CALENDAR_WEEKDAY_NAMES[(calendarState.firstDay + index) % 7].slice(0, 1).toUpperCase();
        });
        applyLayout(container.width || width);
    };
    calendarState.settingIds = [
        calendarSettings.connect('changed::calendar-first-day', refreshCalendarSettings),
        calendarSettings.connect('changed::calendar-weekend-days', refreshCalendarSettings),
        calendarSettings.connect('changed::calendar-weekend-accent', refreshCalendarSettings),
    ];

    const state = {
        scale: Math.min(width / REF_SIZE_PX, height / REF_SIZE_PX),
        timerId: null,
        dayEntries: [],
        daySlots: [],
        weekdayCells: [],
        eventDotSlots: [],
        eventDates: new Set(),
        eventMonitor: null,
        eventMonitorChangedId: 0,
        eventCancellable: new Gio.Cancellable(),
        displayDate: GLib.DateTime.new_now_local(),
    };

    registerWidgetCleanup(container, () => {
        calendarState.settingIds.forEach(id => calendarSettings.disconnect(id));
        if (state.eventMonitorChangedId) {
            state.eventMonitor.disconnect(state.eventMonitorChangedId);
            state.eventMonitorChangedId = 0;
        }
        state.eventMonitor?.cancel();
        state.eventMonitor = null;
        state.eventCancellable.cancel();
    });

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
    const previousButton = new St.Button({
        reactive: true,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: 'go-previous-symbolic' }),
    });
    const nextButton = new St.Button({
        reactive: true,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: 'go-next-symbolic' }),
    });
    headerBox.add_child(headerLabel);
    headerBox.add_child(headerSpacer);
    headerBox.add_child(previousButton);
    headerBox.add_child(nextButton);
    contentBox.add_child(headerBox);

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
            text: CALENDAR_WEEKDAY_NAMES[(calendarState.firstDay + i) % 7].slice(0, 1).toUpperCase(),
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
            const cellBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `spacing: ${DAY_CELL_SPACING_PX}px;`,
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
            state.eventDotSlots.push(eventDot);
        }
    }

    function baseDayStyle(fontSizePx) {
        return `${fontCss}color: ${textColor}; font-size: ${fontSizePx}px; font-weight: ${DAY_FONT_WEIGHT};`;
    }

    function shiftMonth(delta) {
        const current = state.displayDate;
        const monthIndex = current.get_year() * 12 + current.get_month() - 1 + delta;
        const year = Math.floor(monthIndex / 12);
        const month = ((monthIndex % 12) + 12) % 12 + 1;
        state.displayDate = GLib.DateTime.new_local(year, month, 1, 12, 0, 0);
        fillDays();
    }

    previousButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        shiftMonth(-1);
        return Clutter.EVENT_STOP;
    });
    nextButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        shiftMonth(1);
        return Clutter.EVENT_STOP;
    });

    function fillDays() {
        const now = GLib.DateTime.new_now_local();
        const year = state.displayDate.get_year();
        const month = state.displayDate.get_month();
        const isCurrentMonth = year === now.get_year() && month === now.get_month();
        const today = isCurrentMonth ? now.get_day_of_month() : -1;

        headerLabel.text = MONTH_NAMES[month - 1];

        const firstDayCol = (GLib.DateTime.new_local(year, month, 1, 12, 0, 0).get_day_of_week() - calendarState.firstDay + 7) % 7;
        const daysInMonth = getDaysInMonth(year, month);
        const fontSize = scaleFontSize(DAY_FONT_SIZE_PX, state.scale, 10);

        const accentHex = resolveAccentColor(config);
        for (let cell = 0; cell < state.dayEntries.length; cell++) {
            const dayNumber = cell - firstDayCol + 1;
            const label = state.dayEntries[cell];

            if (dayNumber < 1 || dayNumber > daysInMonth) {
                label.text = '';
                label.style = `${baseDayStyle(fontSize)} opacity: ${SECONDARY_TEXT_OPACITY};`;
                state.eventDotSlots[cell].visible = false;
                continue;
            }

            const date = GLib.DateTime.new_local(year, month, dayNumber, 12, 0, 0);
            state.eventDotSlots[cell].visible = state.eventDates.has(date.format('%Y-%m-%d'));
            if (dayNumber === today) {
                // Safe to pad the label now: columns are pinned in
                // applyLayout(), and symmetric padding keeps the label
                // centered inside its fixed-width slot, so alignment holds.
                const pad = Math.round(4 * state.scale);
                label.text = String(dayNumber);
                const todayTextColor = resolveTextOnAccentColor(accentHex);
                label.style = `${fontCss}font-size: ${fontSize}px; font-weight: ${TODAY_FONT_WEIGHT}; color: ${todayTextColor};`
                    + `background-color: ${accentHex};`
                    + `border-radius: 999px;`
                    + `padding: ${pad}px ${pad}px;`;
                continue;
            }

            label.text = String(dayNumber);
            const dayName = CALENDAR_WEEKDAY_NAMES[date.get_day_of_week() % 7].toLowerCase();
            const isAccentDay = calendarState.accentWeekends
                && calendarState.weekendDays.has(dayName);
            label.style = isAccentDay
                ? `${baseDayStyle(fontSize)} color: ${accentHex};`
                : baseDayStyle(fontSize);
        }
    }

    function applyLayout(currentWidth) {
        const currentScale = state.scale;
        const pad = Math.round(REF_PADDING_PX * currentScale);

        contentBox.style = `padding: ${pad}px ${pad}px ${pad + Math.max(3, Math.round(6 * currentScale))}px;`;

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

        headerLabel.translation_y = 0;
        const accentHex = resolveAccentColor(config);
        headerLabel.style = `${fontCss}color: ${accentHex};`
            + `font-size: ${scaleFontSize(HEADER_FONT_SIZE_PX, currentScale, MIN_FONT_SIZE.metadata)}px; font-weight: ${HEADER_FONT_WEIGHT};`
            + `margin-bottom: ${Math.round(HEADER_GAP_PX * currentScale)}px;`;
        const navButtonStyle = `width: ${Math.max(24, Math.round(NAV_BUTTON_SIZE_PX * currentScale))}px;`
            + `height: ${Math.max(24, Math.round(NAV_BUTTON_SIZE_PX * currentScale))}px;`
            + `border: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`
            + `border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, currentScale)}px;`
            + `background-color: transparent;`;
        previousButton.style = navButtonStyle;
        nextButton.style = navButtonStyle;
        const navigationIconSize = scaleFontSize(TYPOGRAPHY_SIZE.iconXs, currentScale, 6);
        previousButton.child.icon_size = navigationIconSize;
        nextButton.child.icon_size = navigationIconSize;

        weekdaySlots.forEach((label, index) => {
            const dayIndex = (calendarState.firstDay + index) % 7;
            const dayName = CALENDAR_WEEKDAY_NAMES[dayIndex].toLowerCase();
            const isAccentDay = calendarState.accentWeekends
                && calendarState.weekendDays.has(dayName);
            label.style = `${fontCss}font-size: ${scaleFontSize(WEEKDAY_FONT_SIZE_PX, currentScale, 10)}px; `
                + `color: ${isAccentDay ? accentHex : textColor};`
                + ` opacity: ${isAccentDay ? 1 : WEEKDAY_TEXT_OPACITY}; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`;
        });
        state.eventDotSlots.forEach(dot => {
            dot.style = `width: ${Math.max(2, Math.round(3 * currentScale))}px;`
                + `height: ${Math.max(2, Math.round(3 * currentScale))}px;`
                + `border-radius: 999px; background-color: ${accentHex};`;
        });

        // Align the month's left edge exactly with the first weekday glyph
        // below it. Weekday labels are centered inside their pinned columns,
        // so mirror that centering offset onto the header. Measured after the
        // weekday styles above so the font metrics are up to date.
        const [, sunNaturalWidth] = weekdaySlots[0].get_preferred_width(-1);
        headerLabel.translation_x = Math.max(0, Math.floor((colWidth - sunNaturalWidth) / 2));

        daysGrid.style = `spacing: ${Math.round(ROW_GAP_PX * currentScale)}px;`
            + `padding-bottom: ${Math.max(12, Math.round(28 * currentScale))}px;`;

        fillDays();
    }

    function applyEventData(bytes) {
        const text = new TextDecoder('utf-8').decode(bytes);
        const dates = new Set();
        const events = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
        for (const event of events) {
            const match = event.match(/^DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})/m);
            if (match)
                dates.add(`${match[1]}-${match[2]}-${match[3]}`);
        }
        state.eventDates = dates;
        fillDays();
    }

    const eventFile = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'evolution',
        'calendar',
        'system',
        'calendar.ics',
    ]));

    function loadEventDates() {
        eventFile.load_contents_async(state.eventCancellable, (file, result) => {
            if (isActorDestroyed(container)) return;
            try {
                const [success, bytes] = file.load_contents_finish(result);
                if (success && !isActorDestroyed(container))
                    applyEventData(bytes);
            } catch (_error) {
                if (isActorDestroyed(container)) return;
                state.eventDates = new Set();
                fillDays();
            }
        });
    }

    state.eventMonitor = eventFile.monitor_file(Gio.FileMonitorFlags.NONE, state.eventCancellable);
    state.eventMonitorChangedId = state.eventMonitor.connect('changed', () => loadEventDates());
    loadEventDates();

    let lastRenderedDayKey = '';

    // Refills the grid only when the calendar day actually rolled over.
    const refreshIfNewDay = () => {
        const now = GLib.DateTime.new_now_local();
        const dayKey = `${now.get_year()}-${now.get_month()}-${now.get_day_of_month()}`;
        if (dayKey === lastRenderedDayKey) return GLib.SOURCE_CONTINUE;
        const wasViewingCurrentMonth = state.displayDate.get_year() === now.get_year()
            && state.displayDate.get_month() === now.get_month();
        if (wasViewingCurrentMonth)
            state.displayDate = now;
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
