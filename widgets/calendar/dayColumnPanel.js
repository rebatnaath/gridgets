import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {
    CALENDAR_WEEKDAY_NAMES, resolveAccentColor, resolveTextOnAccentColor,
    resolveChildCornerRadius, resolveWidgetBackgroundColor, resolveWidgetSurfaces,
    cssColorToRgba, blendCssColor,
} from '../../utils/widgetUtils.js';
import { GRID_REF_PADDING_PX, weekdayIndex } from './calendarCommon.js';
import { COMPACT_TYPE_SCALE } from './monthGridPanel.js';
import { connectShortClick } from '../../utils/widgetInteractions.js';
import { TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';

// Spacing between the boxes stacked in the column. Kept small so the weekday and the
// date read as one heading, and so the list gets the height.
const COLUMN_SPACING_PX = 4;

const WEEKDAY_GAP_PX = 0;
const DATE_GAP_PX = 6;

const CONTENT_SIDE_PADDING_PX = 12;

/** Measured off the shell: a 13px label reports 18px, a 49px one 70px. */
const LINE_HEIGHT_RATIO = 1.43;

const EVENT_ROW_GAP_PX = 4;

/** Most the row gaps may grow to take up slack; past this the rows stop reading as a list. */
const MAX_EXTRA_GAP_PX = 6;

// Each event is a short accent rule down its left edge, with its text on a
// translucent accent block. The fill is a graphic rather than text, so its strength
// comes from GRAPHICS_OPACITY; gridLine is the strongest of those values.
const EVENT_RULE_WIDTH_PX = 3;
const EVENT_BLOCK_PADDING_PX = 2;

const scaledBlockPadding = scale => Math.max(2, Math.round(EVENT_BLOCK_PADDING_PX * scale));
const EVENT_BLOCK_RADIUS_PX = 6;
const NO_EVENTS_TEXT = 'No events today';
const MORE_EVENTS_LABEL = 'more';

/**
 * Base size of the date number, and the biggest single consumer of the column's
 * height, so it largely decides how many events are on screen at once.
 */
const DATE_FONT_SIZE_PX = 50;

const DATE_FONT_WEIGHT = TYPOGRAPHY_WEIGHT.black;

/** Ceiling on rows, so a day with a huge number of events cannot build them all. */
const MAX_VISIBLE_EVENTS = 24;

/** Rows shown before the real height is known, and on an unusable height. */
const FALLBACK_VISIBLE_ROWS = 3;

/**
 * One row per tick. A notch arrives as several events inside one frame, and moving by
 * all of them at once composited only the last.
 */
const SCROLL_STEP_INTERVAL_MS = 70;

/** The "+N more" line is a hint about the list, so it is set smaller than the events. */
const MORE_LINE_FONT_SCALE = 0.7;
const MORE_LINE_PADDING_PX = 1;

/** Events closer together than this are one notch, which arrives as two events. */
const SCROLL_NOTCH_COALESCE_MS = 60;

/**
 * The weekday, the date number and that date's events. Rows are pooled, since the
 * event count changes as the displayed date moves.
 */
export function createDayColumn({
    container,
    config,
    textColor,
    fontCss,
    getEvents,
    onActivate = null,
    typeScale = COMPACT_TYPE_SCALE,
}) {
    const state = {
        scale: 1,
        currentDate: null,
        eventRows: [],
        eventStyle: null,
        // Real measured heights, once the widget is staged and they can be read. They
        // follow the font scale, so the scale they were taken at is kept alongside.
        // A null heightsScale means nothing has been measured yet.
        heights: null,
        heightsScale: null,
        eventRowCap: FALLBACK_VISIBLE_ROWS,
        scrollOffset: 0,
        scrollTarget: 0,
        scrollTimerId: null,
        measureId: 0,
        // When the last event that moved the window landed, so one notch can be told
        // from the next.
        lastScrollEventUs: 0,
        totalEvents: 0,
    };

    // Seeded before any actor exists because a caller may set a date, and so render,
    // before the first layout pass. applyLayout refreshes it with the real scale.
    refreshEventStyle();

    function eventsPerPage() {
        return Math.max(1, state.eventRowCap);
    }

    const column = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        // Reactive so the column is the actor picked for wheel events. Its rows are
        // all inert, and it sits below a reactive parent, so without this nothing
        // here would ever receive a scroll.
        reactive: true,
    });
    container.add_child(column);

    const weekdayLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const dateLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Owns everything below the heading, so the slack under a short list is still part
    // of the click target. Left unowned it belongs to no actor, and the press reaches
    // only the widget above, which is a drag handle and opens nothing.
    const eventAreaBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        // Reactive so the events are what opens the app, leaving the weekday and date
        // above free as a drag handle for the widget.
        reactive: onActivate !== null,
    });

    // Packed from the top at their natural height. Only as many as fit are ever in the
    // actor tree, so nothing can be clipped and the wheel moves the window.
    const eventsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: false,
    });

    // The "+N more" line is a footer, not another row in the list, so it never
    // competes with an event for one and leaves no dead space beneath it.
    const moreLineBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.END,
        visible: false,
    });
    const moreLineLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.START,
    });
    moreLineBox.add_child(moreLineLabel);

    const noEventsLabel = new St.Label({
        text: NO_EVENTS_TEXT,
        x_align: Clutter.ActorAlign.START,
        // Sits at the foot of the column, and claims no space when hidden.
        y_expand: true,
        y_align: Clutter.ActorAlign.END,
    });

    column.add_child(weekdayLabel);
    column.add_child(dateLabel);
    column.add_child(eventAreaBox);
    eventAreaBox.add_child(eventsBox);
    eventAreaBox.add_child(moreLineBox);
    eventAreaBox.add_child(noEventsLabel);

    if (onActivate)
        connectShortClick(eventAreaBox, onActivate);

    function acquireEventRow(index) {
        while (state.eventRows.length <= index) {
            // The rule stretches to the row height, but the label must not expand: an
            // expanding label makes a lone event fill the whole column.
            const rule = new St.Widget({
                x_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            });
            const label = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.START,
            });
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                // No gap: the rule and the block are meant to read as one shape.
                style: 'spacing: 0px;',
            });
            row.add_child(rule);
            row.add_child(label);
            eventsBox.add_child(row);
            state.eventRows.push({ row, rule, label });
        }
        return state.eventRows[index];
    }

    /** Furthest the window can move, which leaves the last page of events showing. */
    function maxScrollOffset() {
        return Math.max(0, state.totalEvents - eventsPerPage());
    }

    /**
     * Handled here rather than by an StScrollView, which would not scroll reliably:
     * the wheel sets a target and a timer walks to it a row at a time.
     */
    function scrollEventsBy(delta) {
        if (state.totalEvents === 0)
            return Clutter.EVENT_PROPAGATE;

        // Only the first of a burst moves the window, and the reference is the last
        // event that moved it rather than the last one seen: on a continuous stream a
        // window reset by every event would never elapse. Zero means nothing has
        // scrolled yet, which must not read as "just now".
        const now = GLib.get_monotonic_time();
        if (state.lastScrollEventUs !== 0
            && now - state.lastScrollEventUs < SCROLL_NOTCH_COALESCE_MS * 1000)
            return Clutter.EVENT_STOP;

        state.lastScrollEventUs = now;

        const maxOffset = maxScrollOffset();
        const target = Math.max(0, Math.min(maxOffset, state.scrollTarget + delta));
        if (target === state.scrollTarget)
            return Clutter.EVENT_STOP;

        state.scrollTarget = target;
        startScrollStepping();
        // Consumed so the desktop grid behind does not also scroll the view.
        return Clutter.EVENT_STOP;
    }

    function startScrollStepping() {
        if (state.scrollTimerId)
            return;

        state.scrollTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCROLL_STEP_INTERVAL_MS, () => {
            // One row per tick, towards the target; updateEvents pulls the offset back
            // into range if a resize leaves it out of bounds.
            if (state.scrollOffset < state.scrollTarget)
                state.scrollOffset++;
            else if (state.scrollOffset > state.scrollTarget)
                state.scrollOffset--;

            updateEvents();

            if (state.scrollOffset === state.scrollTarget) {
                state.scrollTimerId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    function stopScrollStepping() {
        if (!state.scrollTimerId)
            return;
        GLib.Source.remove(state.scrollTimerId);
        state.scrollTimerId = null;
    }

    function onScrollEvent(_actor, event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            return scrollEventsBy(-1);
        if (direction === Clutter.ScrollDirection.DOWN)
            return scrollEventsBy(1);
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, deltaY] = event.get_scroll_delta();
            if (deltaY !== 0)
                return scrollEventsBy(deltaY > 0 ? 1 : -1);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Resolved once per layout rather than per scroll tick, which meant re-parsing the
    // accent and background CSS ten times a second for the length of a scroll.
    function refreshEventStyle() {
        const accentHex = resolveAccentColor(config);
        const { highlight } = resolveWidgetSurfaces(config);
        // Both blocks below are translucent, so their text has to suit the colour they
        // render as rather than the raw accent or highlight.
        const onAccentText = resolveTextOnAccentColor(
            blendCssColor(accentHex, resolveWidgetBackgroundColor(config), GRAPHICS_OPACITY.gridLine));
        const onHighlight = resolveTextOnAccentColor(
            blendCssColor(highlight, resolveWidgetBackgroundColor(config)));

        state.eventStyle = {
            accentHex,
            highlight,
            onAccentText,
            onHighlight,
            fontSize: scaleFontSize(typeScale.eventSize, state.scale, typeScale.eventMinSize),
            blockPadding: scaledBlockPadding(state.scale),
            blockRadius: resolveChildCornerRadius(EVENT_BLOCK_RADIUS_PX, state.scale),
            ruleWidth: Math.max(2, Math.round(EVENT_RULE_WIDTH_PX * state.scale)),
            morePadding: scaleFontSize(MORE_LINE_PADDING_PX, state.scale),
        };
    }

    function updateEvents() {
        const events = state.currentDate ? getEvents(state.currentDate) : [];
        state.totalEvents = events.length;

        // Only the rows that fit are ever in the actor tree, so nothing can be clipped.
        const maxOffset = Math.max(0, events.length - eventsPerPage());
        // A relayout can leave the window past the new end of a shorter list.
        state.scrollTarget = Math.max(0, Math.min(state.scrollTarget, maxOffset));
        state.scrollOffset = Math.max(0, Math.min(state.scrollOffset, state.scrollTarget));

        noEventsLabel.visible = events.length === 0;

        const {
            accentHex, onAccentText, fontSize, blockPadding, blockRadius, ruleWidth,
        } = state.eventStyle;

        const withinWindow = events.length - state.scrollOffset;
        const windowRows = withinWindow > 0
            ? Math.min(eventsPerPage(), withinWindow)
            : 0;
        const remaining = events.length - (state.scrollOffset + windowRows);

        for (let i = 0; i < windowRows; i++) {
            const { row, rule, label } = acquireEventRow(i);
            row.visible = true;
            const event = events[state.scrollOffset + i];
            label.text = event.summary;
            label.style = `${fontCss}color: ${onAccentText}; font-size: ${fontSize}px;`
                + `font-weight: ${typeScale.eventWeight};`
                + `background-color: ${cssColorToRgba(accentHex, GRAPHICS_OPACITY.gridLine)};`
                // Square on the left so the block meets the rule, rounded on the right.
                + `border-radius: 0 ${blockRadius}px ${blockRadius}px 0;`
                // Lets a long title give way rather than widen the column.
                + `padding: ${blockPadding}px ${blockPadding * 2}px;`
                + 'x-expand: true;';
            rule.visible = true;
            // Mirrored, so the rule and the block read as one shape.
            rule.style = `width: ${ruleWidth}px;`
                + `border-radius: ${blockRadius}px 0 0 ${blockRadius}px;`
                + `background-color: ${accentHex};`;
            row.style = 'spacing: 0px;';
        }

        for (let i = windowRows; i < state.eventRows.length; i++)
            state.eventRows[i].row.visible = false;

        if (remaining > 0) {
            const { onHighlight, highlight, morePadding } = state.eventStyle;
            const moreFontSize = scaleFontSize(fontSize * MORE_LINE_FONT_SCALE, 1, MIN_FONT_SIZE.metadata);

            moreLineBox.visible = true;
            moreLineLabel.text = `+${remaining} ${MORE_EVENTS_LABEL}`;
            moreLineLabel.style = `${fontCss}color: ${onHighlight}; font-size: ${moreFontSize}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.medium};`
                + `background-color: ${highlight};`
                + `border-radius: ${blockRadius}px;`
                + `padding: ${morePadding}px ${morePadding * 2}px;`;
        } else {
            moreLineBox.visible = false;
        }
    }

    /**
     * Real heights of the weekday, the date and an event row. Reading these needs the
     * widget on the stage, so the first layout falls back to estimates and asks again
     * once Clutter can answer.
     */
    function measureHeights() {
        // Null covers both too-early and torn-down: a destroyed actor is on no stage.
        if (column.get_stage() === null)
            return null;
        // A row can only be measured once one exists with real text in it.
        if (state.eventRows.length === 0)
            return null;

        const weekday = weekdayLabel.get_preferred_height(-1)[1];
        const date = dateLabel.get_preferred_height(-1)[1];
        const row = state.eventRows[0].row.get_preferred_height(-1)[1];
        if (!(weekday > 0) || !(date > 0) || !(row > 0))
            return null;
        return { weekday, date, row };
    }

    function applyLayout(currentScale, availableHeight = -1) {
        state.scale = currentScale;
        refreshEventStyle();
        const pad = Math.round(GRID_REF_PADDING_PX * currentScale);
        const accentHex = resolveAccentColor(config);

        // Sides are set separately from top and bottom, so the extra inset costs the
        // event list no vertical room.
        column.style = `padding: ${pad}px ${Math.max(pad, CONTENT_SIDE_PADDING_PX)}px;`
            + ` spacing: ${Math.round(COLUMN_SPACING_PX * currentScale)}px;`;
        // Nested rather than a sibling of the column, so it does not inherit the column's
        // spacing and needs its own.
        eventAreaBox.style = `spacing: ${Math.round(COLUMN_SPACING_PX * currentScale)}px;`;

        weekdayLabel.style = `${fontCss}color: ${accentHex};`
            + `font-size: ${scaleFontSize(typeScale.headerSize, currentScale, typeScale.headerMinSize)}px;`
            + `font-weight: ${typeScale.headerWeight};`
            + `margin-bottom: ${Math.round(WEEKDAY_GAP_PX * currentScale)}px;`;

        dateLabel.style = `${fontCss}color: ${textColor};`
            + `font-size: ${scaleFontSize(DATE_FONT_SIZE_PX, currentScale, MIN_FONT_SIZE.primary)}px;`
            + `font-weight: ${DATE_FONT_WEIGHT};`
            + `margin-bottom: ${Math.round(DATE_GAP_PX * currentScale)}px;`;

        noEventsLabel.style = `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`
            + `font-size: ${scaleFontSize(typeScale.eventSize, currentScale, typeScale.eventMinSize)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.regular};`;

        const rowGap = Math.round(EVENT_ROW_GAP_PX * currentScale);

        // Being out on any of the three measurements clips the list or stops it scrolling.
        const measured = state.heights && state.heightsScale === currentScale
            ? state.heights
            : null;
        const eventFontSize = scaleFontSize(typeScale.eventSize, currentScale, typeScale.eventMinSize);
        const rowHeight = measured
            ? measured.row
            : (eventFontSize * LINE_HEIGHT_RATIO) + (scaledBlockPadding(currentScale) * 2);

        const weekdayHeight = measured
            ? measured.weekday
            : scaleFontSize(typeScale.headerSize, currentScale, typeScale.headerMinSize)
                * LINE_HEIGHT_RATIO;
        const dateHeight = measured
            ? measured.date
            : scaleFontSize(DATE_FONT_SIZE_PX, currentScale, MIN_FONT_SIZE.primary)
                * LINE_HEIGHT_RATIO;
        const aboveList = (pad * 2)
            + weekdayHeight + (WEEKDAY_GAP_PX * currentScale)
            + dateHeight + (DATE_GAP_PX * currentScale)
            + (COLUMN_SPACING_PX * currentScale * 2);

        const forRows = Number.isFinite(availableHeight) ? availableHeight - aboveList : -1;
        // The footer is reserved whether needed or not; deriving it from the leftover
        // meant estimating its height, and a low estimate drew the chip into space that
        // was not there.
        const lineHeight = (scaleFontSize(eventFontSize * MORE_LINE_FONT_SCALE, 1, MIN_FONT_SIZE.metadata) * LINE_HEIGHT_RATIO)
            + (state.eventStyle.morePadding * 2);
        const forEvents = forRows - lineHeight;
        // Whole rows only, so a floor rather than a rounding.
        const rows = forEvents > 0 ? Math.floor(forEvents / (rowHeight + rowGap)) : 0;

        state.eventRowCap = rows > 0
            ? Math.min(MAX_VISIBLE_EVENTS, rows)
            : FALLBACK_VISIBLE_ROWS;

        // Spread into the gaps so the list runs down to the footer. One extra gap comes
        // back because the one under the last row belongs to the column.
        const listHeight = (rows * rowHeight)
            + (Math.max(0, rows - 1) * rowGap)
            + (COLUMN_SPACING_PX * currentScale);
        const gaps = Math.max(0, rows - 1);
        const spare = forEvents - listHeight;
        const extraGap = gaps > 0 && spare > 0
            ? Math.min(MAX_EXTRA_GAP_PX, Math.floor(spare / gaps))
            : 0;
        eventsBox.style = `spacing: ${rowGap + extraGap}px;`;

        updateEvents();

        if (!measured)
            scheduleHeightMeasurement(currentScale, availableHeight);
    }

    function scheduleHeightMeasurement(currentScale, availableHeight) {
        if (state.measureId)
            return;
        state.measureId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            state.measureId = 0;
            const heights = measureHeights();
            if (!heights)
                return GLib.SOURCE_REMOVE;

            state.heights = heights;
            state.heightsScale = currentScale;
            applyLayout(currentScale, availableHeight);
            return GLib.SOURCE_REMOVE;
        });
    }

    column.connect('scroll-event', onScrollEvent);

    return {
        applyLayout,
        /**
         * The caller owns this: the host is a plain St.BoxLayout, and the widget actor
         * above it is where the extension keeps its teardown.
         */
        destroy() {
            stopScrollStepping();
            if (state.measureId) {
                GLib.Source.remove(state.measureId);
                state.measureId = 0;
            }
        },
        setDate(date) {
            const weekday = CALENDAR_WEEKDAY_NAMES[weekdayIndex(date)];
            weekdayLabel.text = weekday.toUpperCase();
            dateLabel.text = String(date.get_day_of_month());
            state.currentDate = date;
            // A new date starts at the top. Stepping in flight is aiming at the old
            // offset, and the notch timestamp is cleared so the next notch is not
            // swallowed as the tail of the last one.
            stopScrollStepping();
            state.scrollOffset = 0;
            state.scrollTarget = 0;
            state.lastScrollEventUs = 0;
            updateEvents();
        },
    };
}
