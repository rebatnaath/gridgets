import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER, parseCssColor, resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces, cssColorToRgba, resolveAccentColor, MONTH_NAMES_ABBREVIATED as MONTH_NAMES } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, traceRoundedRect, connectTimerCleanup } from '../../shell/widgetUIUtils.js';
import { createOfflineNotice, OFFLINE_NOTICE_MESSAGES } from '../../components/offline/offlineNotice/offlineNotice.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import {
    createGithubClient,
    githubAvatarCacheUri,
    loadGithubUsername,
    noteGithubAvatarFailure,
    saveGithubUsername,
    writeGithubAvatar,
} from './githubData.js';

const REF_WIDTH_PX = 520;
const REF_HEIGHT_PX = 250;
const CONTAINER_PADDING_V_PX = 16;
const CONTAINER_PADDING_H_PX = 20;
const AVATAR_SIZE_PX = 34;
const USERNAME_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const FOOTER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const TOTAL_FONT_SIZE_PX = 42;
const STAT_VALUE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const LEFT_COLUMN_WIDTH_PX = 200;
const COLUMNS_SPACING_PX = 22;
const DIVIDER_THICKNESS_PX = 1;
const CHART_HEIGHT_PX = 34;
const CELL_SIZE_PX = 12;
const CELL_GAP_RATIO = 0.27;
const MAIN_BOX_SPACING_PX = 10;
const STAT_LABELS = ['Current streak', 'Longest streak', 'Busiest day'];
const TOTAL_CAPTION_MONTHS = 6;
const CONTRIBUTION_LEVEL_ALPHAS = [0, 0.28, 0.48, 0.72, 1];
const MIN_CONTRIBUTION_WEEKS = 8;
const MAX_CONTRIBUTION_WEEKS = 30;
const REFRESH_INTERVAL_SECONDS = 600;
const CLUTTER_OPACITY_OPAQUE = 255;

function contributionLevel(count) {
    if (count >= 10) return 4;
    if (count >= 6) return 3;
    if (count >= 3) return 2;
    if (count >= 1) return 1;
    return 0;
}

export function createGithubNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentColor = resolveAccentColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const contributionColors = CONTRIBUTION_LEVEL_ALPHAS.map(alpha => cssColorToRgba(accentColor, alpha));
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const emptyCellColor = card;

    let username = typeof config.username === 'string' ? config.username : '';
    let scale = clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    const px = (v) => scaleFontSize(v, scale);
    let latestByDate = new Map();
    /** file:// URI of the stored avatar, empty until one has been fetched. */
    let avatarImageUri = '';

    const state = { timerId: null, editing: false, cancellable: new Gio.Cancellable() };
    const client = createGithubClient(state.cancellable);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${MAIN_BOX_SPACING_PX}px;`,
    });
    container.add_child(mainBox);

    // Two columns: figures on the left, graph on the right. In one column the count and the
    // grid end up so far apart that neither reads as the other's caption.
    const columnsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${px(COLUMNS_SPACING_PX)}px;`,
    });
    mainBox.add_child(columnsRow);

    const leftColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.START,
    });
    columnsRow.add_child(leftColumn);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    leftColumn.add_child(headerBox);

    // A plain widget with the picture as its background: border-radius then clips the
    // image itself, so the avatar is round without any pixel masking. Masking the pixels
    // instead depends on the decoded size being square and on cairo honouring the alpha.
    const avatarWidget = new St.Widget({
        style: `background-color: ${card}; border-radius: 999px;`,
        y_align: Clutter.ActorAlign.CENTER,
        // A child of an actor with no layout manager is placed at 0,0 whatever its
        // alignment says, so the initials sat in the corner. BinLayout gives the label
        // the whole box and the centre alignment then applies. Invisible while the
        // picture loads, but it is what shows when the fetch fails.
        layout_manager: new Clutter.BinLayout(),
    });
    const initialsLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    avatarWidget.add_child(initialsLabel);

    // No style here: applyLayout runs before the scaler is attached and writes these,
    // so a constructor copy would be the unscaled, un-themed version and never paint.
    const usernameLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const usernameEntry = new St.Entry({
        text: username,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    usernameEntry.hide();

    headerBox.add_child(avatarWidget);
    headerBox.add_child(usernameLabel);
    headerBox.add_child(usernameEntry);
    const headerSpacer = new St.Widget({ x_expand: true });
    headerBox.add_child(headerSpacer);

    const totalLabel = new St.Label({
        text: '0',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
    });
    leftColumn.add_child(totalLabel);

    // FILL plus wrapping, so the caption takes the column's width and breaks onto a second
    // line instead of being ellipsised, or forcing the column wider than its set width.
    const totalCaptionLabel = new St.Label({
        text: `contributions · ${TOTAL_CAPTION_MONTHS} months`,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
    });
    // A ClutterText property: passing line_wrap to the St.Label constructor throws and the
    // widget is never built.
    totalCaptionLabel.clutter_text.line_wrap = true;
    leftColumn.add_child(totalCaptionLabel);

    const divider = new St.Widget({ x_align: Clutter.ActorAlign.FILL });
    leftColumn.add_child(divider);

    const statRows = STAT_LABELS.map(() => {
        const name = new St.Label({ text: '', x_align: Clutter.ActorAlign.START });
        const value = new St.Label({ text: '', x_align: Clutter.ActorAlign.END });
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.FILL,
        });
        row.add_child(name);
        row.add_child(new St.Widget({ x_expand: true }));
        row.add_child(value);
        leftColumn.add_child(row);
        return { name, value };
    });

    const rightColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    columnsRow.add_child(rightColumn);

    const matrixBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    rightColumn.add_child(matrixBox);

    const monthLabelsRow = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.START,
    });
    matrixBox.add_child(monthLabelsRow);

    const matrixBody = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_expand: true,
        style: `padding: ${px(3)}px 0;`,
    });
    matrixBox.add_child(matrixBody);

    // A widget added with no network has nothing to show, so the whole layout is held
    // back and this stands in for it. Building an empty header, an empty grid and a red
    // "Error loading" reads as a broken widget rather than an absent connection.
    const offlineNotice = createOfflineNotice({ fontCss, textColor, scale });
    offlineNotice.actor.hide();
    container.add_child(offlineNotice.actor);

    function showOfflineState() {
        mainBox.hide();
        offlineNotice.setMessage(OFFLINE_NOTICE_MESSAGES.offline);
        offlineNotice.actor.show();
    }

    function showContentState() {
        offlineNotice.actor.hide();
        mainBox.show();
    }

    const gridCanvas = new St.DrawingArea({ x_expand: true });
    gridCanvas.connect('repaint', drawMatrixCanvas);
    matrixBody.add_child(gridCanvas);

    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    const statusLabel = new St.Label({
        text: username ? 'Syncing…' : 'Click the username to configure',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${scaleFontSize(FOOTER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor};`,
        opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
    });

    // The bar chart sits under the grid rather than beside it: the two share a week axis, so
    // stacking them lets a bar be read against the column of days above it.
    const chartBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style: `spacing: ${px(2)}px;`,
    });
    rightColumn.add_child(chartBox);

    const weeklyChart = new St.DrawingArea({ x_expand: true });
    weeklyChart.connect('repaint', drawWeeklyChart);
    chartBox.add_child(weeklyChart);

    footerBox.add_child(statusLabel);
    rightColumn.add_child(footerBox);

    const chartCaptionRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    const weeklyCaption = new St.Label({ text: 'Weekly total', x_align: Clutter.ActorAlign.START });
    const thisWeekCaption = new St.Label({ text: '', x_align: Clutter.ActorAlign.END });
    chartCaptionRow.add_child(weeklyCaption);
    chartCaptionRow.add_child(new St.Widget({ x_expand: true }));
    chartCaptionRow.add_child(thisWeekCaption);
    chartBox.add_child(chartCaptionRow);

    const persistUsername = () => saveGithubUsername(config, username);

    function applyLayout() {
        offlineNotice.applyScale(scale);
        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px; spacing: ${px(MAIN_BOX_SPACING_PX)}px;`;
        // Rebuilt rather than appended to, so dropping the picture removes the
        // background-image instead of leaving the last avatar on screen.
        avatarWidget.style = `background-color: ${card}; border-radius: 999px;`
            + `width: ${px(AVATAR_SIZE_PX)}px; height: ${px(AVATAR_SIZE_PX)}px;`
            + (avatarImageUri
                ? ` background-image: url("${avatarImageUri}");`
                    + ' background-size: cover; background-position: center;'
                : '');
        initialsLabel.style = `${fontCss}font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.metadata, scale, MIN_FONT_SIZE.metadata)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; color: ${textColor};`;
        usernameLabel.style = `${fontCss}font-size: ${scaleFontSize(USERNAME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; margin-left: ${px(8)}px;`;
        usernameEntry.style = `${fontCss}font-size: ${scaleFontSize(USERNAME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `color: ${textColor}; width: ${px(150)}px;`;
        totalLabel.style = `${fontCss}font-size: ${scaleFontSize(TOTAL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${accentColor};`;
        const secondaryOpacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary);
        totalCaptionLabel.style = `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor};`;
        totalCaptionLabel.opacity = secondaryOpacity;
        statRows.forEach((row, index) => {
            row.name.style = `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                + `color: ${textColor};`;
            row.name.opacity = secondaryOpacity;
            row.value.style = `${fontCss}font-size: ${scaleFontSize(STAT_VALUE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor};`;
        });
        weeklyCaption.style = `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor};`;
        weeklyCaption.opacity = secondaryOpacity;
        thisWeekCaption.style = `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor};`;
        thisWeekCaption.opacity = secondaryOpacity;

        renderMatrix();
        applySummary();
    }

    function updateHeader() {
        const name = username || 'not configured';
        usernameLabel.text = name === 'not configured' ? name : `@${name}`;
        initialsLabel.text = username ? username.slice(0, 2) : '?';
        loadAvatar();
    }

    function renderMonthLabels(weeks, startUnixSeconds) {
        // Must match the grid's column pitch exactly (cell + spacing), so the
        // labels track the matrix through any resize.
        const columnPitch = cellSize() + cellGap();
        monthLabelsRow.destroy_all_children();
        monthLabelsRow.style = `margin-top: ${px(4)}px;`
            + `margin-bottom: ${px(2)}px;`;

        let currentMonth = -1;
        let lastLabelEnd = -Infinity;
        for (let week = 0; week < weeks; week++) {
            const weekDate = GLib.DateTime.new_from_unix_local(startUnixSeconds + week * 7 * 86400);
            const month = weekDate.get_month() - 1;
            if (month === currentMonth)
                continue;
            const labelX = week * columnPitch;
            const estimatedLabelWidth = Math.max(px(18), MONTH_NAMES[month].length * px(6));
            if (labelX < lastLabelEnd + px(6))
                continue;
            currentMonth = month;

            // The BinLayout gives every label the row's full width, so translation_x
            // positions each one absolutely over its week column regardless of how long
            // the month name is.
            const label = new St.Label({
                text: MONTH_NAMES[month],
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                    + `color: ${textColor};`,
                opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
            });
            label.translation_x = labelX;
            lastLabelEnd = labelX + estimatedLabelWidth;
            monthLabelsRow.add_child(label);
        }
    }

    function cellSize() {
        return scaleFontSize(CELL_SIZE_PX, scale);
    }

    function cellGap() {
        return Math.max(1, Math.round(cellSize() * CELL_GAP_RATIO));
    }

    const matrixGeometry = { size: 0, dataKey: '', cells: [] };
    // What the grid decided to show. The figures on the left are computed from this rather
    // than from the whole response, or the caption would claim a window the grid is not
    // showing.
    let shownRange = { startUnix: 0, days: 0, weeks: 0, weeklyTotals: [], thisWeek: 0 };


    function drawMatrixCanvas(canvas) {
        const { size, cells } = matrixGeometry;
        if (size <= 0) return;
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const radius = Math.min(2 * scale, size / 2);
        for (const cell of cells) {
            if (cell.x + size > canvasWidth || cell.y + size > canvasHeight)
                continue;
            const parsed = parseCssColor(cell.color);
            ctx.setSourceRGBA(parsed.r, parsed.g, parsed.b, parsed.a !== undefined ? parsed.a : 1);
            traceRoundedRect(ctx, cell.x, cell.y, size, size, radius);
            ctx.fill();
        }
        ctx.$dispose();
    }

    function cellColorFor(level) {
        return level === 0 ? emptyCellColor : contributionColors[level];
    }

    /** Totals, streaks and weekly bars for exactly the days the grid is showing. */
    function summariseRange(byDate, alignedStart, daysInGrid) {
        const weeklyTotals = [];
        let total = 0;
        let busiestDay = 0;
        let longestStreak = 0;
        let running = 0;
        const keys = [];

        for (let day = 0; day < daysInGrid; day++) {
            const key = alignedStart.add_days(day).format('%Y-%m-%d');
            keys.push(key);
            const count = byDate.get(key) || 0;
            total += count;
            if (count > busiestDay)
                busiestDay = count;
            if (count > 0) {
                running++;
                if (running > longestStreak)
                    longestStreak = running;
            } else {
                running = 0;
            }
        }

        // Sundays close a column, so a week is the seven days from one Sunday to the next.
        // The weekday is taken modulo the grid so it wraps back to Sunday every seven days:
        // deriving it from the index only ever equalled 6 once, which collapsed the whole
        // series into a single bar and dropped every other week into the leftover.
        const firstWeekday = alignedStart.get_day_of_week() % 7;
        let week = [];
        let started = false;
        for (let day = 0; day < keys.length; day++) {
            const weekday = (firstWeekday + day) % 7;
            if (weekday === 0) {
                week = [];
                started = true;
            }
            // The grid opens part-way through a week, so those leading days have no column.
            if (!started)
                continue;
            week[weekday] = byDate.get(keys[day]) || 0;
            if (weekday === 6) {
                weeklyTotals.push(week.reduce((sum, count) => sum + count, 0));
                // Cleared here, not only when the next Sunday arrives: otherwise the
                // trailing check below finds the last week still in place and counts it twice.
                week = [];
            }
        }
        if (started && week.length > 0 && week.some(count => count > 0))
            weeklyTotals.push(week.reduce((sum, count) => sum + count, 0));

        // The streak is measured to today, not to the end of the grid: the grid ends on
        // Saturday, so days after today in the same column would read as a broken streak.
        let currentStreak = 0;
        const today = GLib.DateTime.new_now_local();
        let latestKey = '';
        for (const key of byDate.keys()) {
            if (key > latestKey)
                latestKey = key;
        }
        for (let back = 0; back < daysInGrid; back++) {
            const dayKey = today.add_days(-back).format('%Y-%m-%d');
            if (dayKey > latestKey)
                continue;
            if ((byDate.get(dayKey) || 0) > 0)
                currentStreak++;
            else
                break;
        }

        return {
            startUnix: alignedStart.to_unix(),
            days: daysInGrid,
            weeks: weeklyTotals.length,
            weeklyTotals,
            thisWeek: weeklyTotals.length > 0 ? weeklyTotals[weeklyTotals.length - 1] : 0,
            total,
            currentStreak,
            longestStreak,
            busiestDay,
        };
    }

    function drawWeeklyChart(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const totals = shownRange.weeklyTotals;
        if (totals.length === 0 || canvasWidth <= 0)
            return;

        const highest = Math.max(1, ...totals);
        // The grid's column pitch, not a share of the surface: dividing the width by the
        // week count made each bar as wide as its slot, which drew a single block whenever
        // the surface was wider than the weeks needed.
        const pitch = cellSize() + cellGap();
        const barWidth = Math.max(2, Math.round(pitch * 0.62));
        const radius = Math.min(3 * scale, barWidth / 2);
        const accent = parseCssColor(accentColor);

        totals.forEach((total, index) => {
            const barHeight = Math.max(2, Math.round((total / highest) * (canvasHeight - 3)));
            const x = Math.round(index * pitch + (pitch - barWidth) / 2);
            if (x + barWidth > canvasWidth)
                return;
            const isCurrent = index === totals.length - 1;
            // The current week is the only one still moving, so it is the only one drawn
            // at full strength; the rest step down so it does not read as a peak.
            ctx.setSourceRGBA(accent.r, accent.g, accent.b, isCurrent ? 0.95 : 0.45);
            traceRoundedRect(ctx, x, canvasHeight - barHeight, barWidth, barHeight, radius);
            ctx.fill();
        });
    }

    function applySummary() {
        totalLabel.text = shownRange.total.toLocaleString();
        const values = [
            `${shownRange.currentStreak}d`,
            `${shownRange.longestStreak}d`,
            String(shownRange.busiestDay),
        ];
        statRows.forEach((row, index) => {
            row.name.text = STAT_LABELS[index];
            row.value.text = values[index];
        });
        thisWeekCaption.text = `this week ${shownRange.thisWeek}`;

        const width_ = px(LEFT_COLUMN_WIDTH_PX);
        leftColumn.style = `width: ${width_}px; spacing: ${px(4)}px;`;
        divider.style = `height: ${px(DIVIDER_THICKNESS_PX)}px; background-color: ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)}; margin: ${px(6)}px 0;`;
        weeklyChart.set_height(px(CHART_HEIGHT_PX));
        weeklyChart.queue_repaint();
    }

    function renderMatrix(contributionsByDate) {
        const byDate = contributionsByDate || latestByDate;

        const size = cellSize();
        const gap = cellGap();
        // matrixBody spans the label column + canvas; only the remainder
        // after the labels can hold week columns, or the tail gets clipped
        // Before the first allocation the right column has no measured width, so it is
        // derived from the widget. The left column and the gap are not available to the
        // grid, and counting them here is what kept the tail from spilling past the card.
        const outerWidth = width - px(CONTAINER_PADDING_H_PX) * 2;
        const reserved = px(LEFT_COLUMN_WIDTH_PX + COLUMNS_SPACING_PX);
        const bodyWidth = matrixBody.width > 0 ? matrixBody.width : Math.max(size, outerWidth - reserved);
        const availableWidth = Math.max(size, bodyWidth);
        const weeks = Math.max(MIN_CONTRIBUTION_WEEKS, Math.min(MAX_CONTRIBUTION_WEEKS, Math.floor((availableWidth + gap) / (size + gap))));

        // Rebuilding the matrix is only needed when geometry or data changed;
        // skip redundant repaints during unrelated layout passes.
        const dataKey = `${size}|${gap}|${weeks}`;
        if (dataKey === matrixGeometry.dataKey && contributionsByDate === undefined)
            return;


        const today = GLib.DateTime.new_now_local();
        const daysInGrid = weeks * 7;
        // Anchor to the end of the current week so the latest, partial week is always the
        // last column. GLib counts Monday as 1 and Sunday as 7, so the modulus maps Sunday
        // to 0 and every day still resolves to the Saturday that closes its week.
        const gridEnd = today.add_days(6 - (today.get_day_of_week() % 7));
        const alignedStart = gridEnd.add_days(-(daysInGrid - 1));

        renderMonthLabels(weeks + 1, alignedStart.to_unix());
        shownRange = summariseRange(byDate, alignedStart, daysInGrid);
        // Fetched data renders without going through applyLayout, so the figures and the
        // bars are refreshed here too; otherwise they would wait for a resize to update.
        applySummary();

        const cells = [];
        for (let index = 0; index < daysInGrid; index++) {
            const date = alignedStart.add_days(index);
            if (date.compare(today) > 0)
                break;

            const dateKey = date.format('%Y-%m-%d');
            const column = Math.floor(index / 7);
            const row = date.get_day_of_week() % 7; // GLib Monday=1..Sunday=7, so Sunday is row 0

            cells.push({
                x: column * (size + gap),
                y: row * (size + gap),
                color: cellColorFor(contributionLevel(byDate.get(dateKey) ?? 0)),
            });
        }

        matrixGeometry.size = size;
        matrixGeometry.dataKey = dataKey;
        matrixGeometry.cells = cells;

        gridCanvas.set_width(Math.max(1, weeks * (size + gap) - gap));
        gridCanvas.set_height(Math.max(1, 7 * (size + gap) - gap));
        gridCanvas.queue_repaint();
    }

    // An empty message hides the row rather than showing a blank line: a successful sync has
    // nothing worth saying, but a failure still has to be visible.
    function updateStatus(text) {
        statusLabel.text = text;
        if (text)
            statusLabel.show();
        else
            statusLabel.hide();
    }

    function loadAvatar() {
        if (!username) return;
        // The request is for this user specifically, so the key and the guard both have to
        // be taken from it rather than from whatever username holds when the answer lands.
        const requestedUsername = username;
        client.fetchAvatar(requestedUsername, (err, bytes) => {
            if (isActorDestroyed(container) || username !== requestedUsername) return;
            if (err || !bytes) {
                noteGithubAvatarFailure(requestedUsername, err || new Error('no avatar'));
                return;
            }
            const uri = githubAvatarCacheUri(config, requestedUsername);
            if (!uri) {
                noteGithubAvatarFailure(requestedUsername, new Error('no cache path for avatar'));
                return;
            }
            // The style is applied only once the write has landed, because a background-image
            // pointing at a file that is not there yet fails silently.
            writeGithubAvatar(config, requestedUsername, bytes, () => {
                if (isActorDestroyed(container) || username !== requestedUsername) return;
                avatarImageUri = uri;
                initialsLabel.hide();
                applyLayout();
            });
        });
    }

    function fetchContributions() {
        if (!username) return;
        const requestedUsername = username;
        updateStatus('Syncing…');
        client.fetchContributions(requestedUsername, (err, byDate) => {
            if (isActorDestroyed(container) || username !== requestedUsername) return;
            if (err || !byDate) {
                if (!isNetworkAvailable()) {
                    showOfflineState();
                    return;
                }
                updateStatus('Error loading');
                return;
            }
            updateStatus('');
            latestByDate = byDate;
            showContentState();
            renderMatrix(byDate);
        });
    }

    const startEdit = () => {
        if (state.editing) return;
        state.editing = true;
        usernameEntry.text = username;
        usernameLabel.hide();
        usernameEntry.show();
        global.stage.set_key_focus(usernameEntry);
    };

    const endEdit = (commit) => {
        if (!state.editing) return;
        state.editing = false;
        const submitted = usernameEntry.get_text().trim().replace(/^@/, '');
        usernameEntry.text = '';
        usernameEntry.hide();
        usernameLabel.show();
        if (global.stage.get_key_focus() === usernameEntry)
            global.stage.set_key_focus(null);

        if (!commit) return;
        if (submitted === '' || submitted === username)
            return;
        username = submitted;
        config.username = username;
        persistUsername();
        // applyLayout is what drops the previous avatar out of the stylesheet. Without
        // it the old picture stays behind the new initials until the replacement
        // arrives, and stays for good if that fetch fails.
        avatarImageUri = '';
        applyLayout();
        initialsLabel.show();
        updateHeader();
        fetchContributions();
    };

    usernameLabel.reactive = true;
    usernameLabel.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        startEdit();
        return Clutter.EVENT_STOP;
    });

    usernameEntry.clutter_text.connect('key-press-event', (_actor, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            endEdit(true);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) {
            endEdit(false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    usernameEntry.clutter_text.connect('key-focus-out', () => {
        endEdit(false);
    });

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (isActorDestroyed(container))
            return GLib.SOURCE_REMOVE;
        fetchContributions();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        state.cancellable.cancel();
        persistUsername();
        if (global.stage.get_key_focus() === usernameEntry)
            global.stage.set_key_focus(null);
    });

    applyLayout();
    updateHeader();
    if (username && !isNetworkAvailable())
        showOfflineState();

    // A widget parked on the offline notice has nothing to retry on its own, so it waits
    // for the network to come back and then asks again. The notice stays up until the
    // fetch actually succeeds, rather than being swapped for an empty grid first.
    const releaseConnectivity = subscribeToSettledConnectivity(available => {
        if (!available || isActorDestroyed(container) || !username) return;
        fetchContributions();
        loadAvatar();
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        scale = ratio;
        applyLayout();
    });

    registerWidgetCleanup(container, () => releaseConnectivity());

    loadGithubUsername(config, (savedUsername, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedUsername) {
            username = savedUsername;
            config.username = username;
            updateHeader();
            fetchContributions();
        } else {
            if (username)
                fetchContributions();
            if (!loadError)
                persistUsername();
        }
    });

    return container;
}
