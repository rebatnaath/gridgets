import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';
import { CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER, SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, parseCssColor, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, MONTH_NAMES_ABBREVIATED as MONTH_NAMES } from '../shell/widgetUIUtils.js';
import { applyCornerMask, setImageContentBytes } from './media/mediaCommon.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const REF_WIDTH_PX = 420;
const REF_HEIGHT_PX = 200;
const CONTAINER_PADDING_V_PX = 14;
const CONTAINER_PADDING_H_PX = 18;
const AVATAR_SIZE_PX = 28;
const USERNAME_FONT_SIZE_PX = 13;
const BADGE_FONT_SIZE_PX = 11;
const LABEL_FONT_SIZE_PX = 9;
const FOOTER_FONT_SIZE_PX = 11;
const CELL_SIZE_PX = 11;
const CELL_GAP_RATIO = 0.27;
const MATRIX_PADDING_PX = 8;
const DAY_LABELS_WIDTH_PX = 24;
const DAY_LABEL_ROWS = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
const MIN_CONTRIBUTION_WEEKS = 8;
const MAX_CONTRIBUTION_WEEKS = 30;
const AVATAR_REQUEST_SIZE_PX = 64;

const LEVEL_COLORS = ['#39d353', '#26a641', '#006d32', '#0e4429'];
const BORDER_ALPHA = 0.14;
const REFRESH_INTERVAL_SECONDS = 600;
const HTTP_STATUS_OK = 200;
const decoder = new TextDecoder();

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
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const emptyCellColor = textRgba(0.15);
    container.style += ` border: 1px solid ${textRgba(BORDER_ALPHA)};`;

    let username = typeof config.username === 'string' ? config.username : '';
    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    const px = (v) => Math.max(1, Math.round(v * scale));
    let lastSyncTime = null;
    let latestByDate = new Map();

    const state = { timerId: null, editing: false, cancellable: new Gio.Cancellable() };
    const session = new Soup.Session();

    const dataFilePath = GLib.build_filenamev([
        getGridgetsDataDir('github'),
        `github-${config.id}.json`,
    ]);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: 10px;`,
    });
    container.add_child(mainBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    const avatarWidget = new St.Widget({
        style: `background-color: ${textRgba(0.15)}; border-radius: 999px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const initialsLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    avatarWidget.add_child(initialsLabel);

    const usernameLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-weight: 700; color: ${textColor};`,
    });

    const badgeLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${BADGE_FONT_SIZE_PX}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
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
    headerBox.add_child(badgeLabel);
    mainBox.add_child(headerBox);

    const matrixBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(matrixBox);

    const monthLabelsRow = new St.Widget({ x_align: Clutter.ActorAlign.START });
    matrixBox.add_child(monthLabelsRow);

    const matrixBody = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_expand: true,
    });
    matrixBox.add_child(matrixBody);

    const dayLabelsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
    });
    matrixBody.add_child(dayLabelsColumn);

    const gridCanvas = new St.DrawingArea({ x_expand: true });
    gridCanvas.connect('repaint', drawMatrixCanvas);
    matrixBody.add_child(gridCanvas);

    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    const statusLabel = new St.Label({
        text: username ? 'Fetching…' : 'Click to set username',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${FOOTER_FONT_SIZE_PX}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
    });

    const legendBox = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
        style: 'spacing: 3px;',
    });
    const lessLabel = new St.Label({
        text: 'Less',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${FOOTER_FONT_SIZE_PX - 1}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-right: 3px;`,
    });
    legendBox.add_child(lessLabel);
    const legendSquares = [emptyCellColor, ...LEVEL_COLORS.slice().reverse()].map(color => {
        const square = new St.Widget({ y_align: Clutter.ActorAlign.CENTER });
        square.legendColor = color;
        legendBox.add_child(square);
        return square;
    });
    const moreLabel = new St.Label({
        text: 'More',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${FOOTER_FONT_SIZE_PX - 1}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 3px;`,
    });
    legendBox.add_child(moreLabel);

    footerBox.add_child(statusLabel);
    footerBox.add_child(legendBox);
    mainBox.add_child(footerBox);

    const persistUsername = () => saveJsonToFile(dataFilePath, { username });

    function applyLayout() {
        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px; spacing: ${px(10)}px;`;
        avatarWidget.style = `background-color: ${textRgba(0.15)}; border-radius: 999px;`
            + `width: ${px(AVATAR_SIZE_PX)}px; height: ${px(AVATAR_SIZE_PX)}px;`;
        initialsLabel.style = `${fontCss}font-size: ${px(11)}px;`
            + `font-weight: 400; color: ${textColor};`;
        usernameLabel.style = `${fontCss}font-size: ${px(USERNAME_FONT_SIZE_PX)}px;`
            + `font-weight: 700; color: ${textColor}; margin-left: ${px(8)}px;`;
        usernameEntry.style = `${fontCss}font-size: ${px(USERNAME_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; width: ${px(150)}px;`;
        badgeLabel.style = `${fontCss}font-size: ${px(BADGE_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        legendSquares.forEach(square => {
            square.style = `background-color: ${square.legendColor};`
                + `border-radius: ${Math.max(1, px(2))}px;`
                + `width: ${px(8)}px; height: ${px(8)}px;`;
        });

        renderMatrix();
    }

    function updateHeader() {
        const name = username || 'not configured';
        usernameLabel.text = name;
        initialsLabel.text = username ? username.slice(0, 2) : '?';
        loadAvatar();
    }

    function renderMonthLabels(weeks, startUnixSeconds) {
        // Must match the grid's column pitch exactly (cell + spacing), so the
        // labels track the matrix through any resize.
        const columnPitch = cellSize() + cellGap();
        monthLabelsRow.destroy_all_children();
        monthLabelsRow.style = `margin-left: ${px(DAY_LABELS_WIDTH_PX)}px; height: ${px(12)}px;`;

        let currentMonth = -1;
        for (let week = 0; week < weeks; week++) {
            const weekDate = GLib.DateTime.new_from_unix_local(startUnixSeconds + week * 7 * 86400);
            const month = weekDate.get_month() - 1;
            if (month === currentMonth)
                continue;
            currentMonth = month;

            // BinLayout stacks children, so translation_x positions each label
            // absolutely over its week column regardless of label text width.
            const label = new St.Label({
                text: MONTH_NAMES[month],
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(LABEL_FONT_SIZE_PX)}px;`
                    + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
            });
            label.translation_x = week * columnPitch;
            monthLabelsRow.add_child(label);
        }
    }

    function renderDayLabels() {
        dayLabelsColumn.destroy_all_children();
        dayLabelsColumn.style = `width: ${px(DAY_LABELS_WIDTH_PX)}px; spacing: ${cellGap()}px;`;

        for (let row = 0; row < 7; row++) {
            const label = new St.Label({
                text: DAY_LABEL_ROWS[row] || '',
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(LABEL_FONT_SIZE_PX)}px;`
                    + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
            });
            const slot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: px(DAY_LABELS_WIDTH_PX),
                height: cellSize(),
            });
            slot.add_child(label);
            dayLabelsColumn.add_child(slot);
        }
    }

    function cellSize() {
        return Math.max(1, Math.round(CELL_SIZE_PX * scale));
    }

    function cellGap() {
        return Math.max(1, Math.round(cellSize() * CELL_GAP_RATIO));
    }

    const matrixGeometry = { size: 0, gap: 0, weeks: 0, dataKey: '', cells: [] };

    function traceRoundedRect(ctx, x, y, w, h, radius) {
        ctx.newSubPath();
        ctx.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
        ctx.arc(x + w - radius, y + radius, radius, 1.5 * Math.PI, 2 * Math.PI);
        ctx.arc(x + w - radius, y + h - radius, radius, 2 * Math.PI, 2.5 * Math.PI);
        ctx.arc(x + radius, y + h - radius, radius, 2.5 * Math.PI, 3 * Math.PI);
        ctx.closePath();
    }

    function drawMatrixCanvas(canvas) {
        const { size, gap, cells } = matrixGeometry;
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
        return level === 0 ? emptyCellColor : LEVEL_COLORS[4 - level];
    }

    function renderMatrix(contributionsByDate) {
        const byDate = contributionsByDate || latestByDate;

        const size = cellSize();
        const gap = cellGap();
        // matrixBody spans the label column + canvas; only the remainder
        // after the labels can hold week columns, or the tail gets clipped
        const bodyWidth = matrixBody.width || (width - px(CONTAINER_PADDING_H_PX) * 2);
        const availableWidth = bodyWidth - px(DAY_LABELS_WIDTH_PX);
        const weeks = Math.max(MIN_CONTRIBUTION_WEEKS, Math.min(MAX_CONTRIBUTION_WEEKS, Math.floor((availableWidth + gap) / (size + gap))));

        // Rebuilding the matrix is only needed when geometry or data changed;
        // skip redundant repaints during unrelated layout passes.
        const dataKey = `${size}|${gap}|${weeks}`;
        if (dataKey === matrixGeometry.dataKey && contributionsByDate === undefined)
            return;

        renderDayLabels();

        const today = GLib.DateTime.new_now_local();
        const daysInGrid = weeks * 7;
        // Anchor to the end of the current week (GLib dow: Mon=1..Sun=7) so
        // the latest, partial week is always the last column on screen.
        const gridEnd = today.add_days(6 - (today.get_day_of_week() % 7));
        const alignedStart = gridEnd.add_days(-(daysInGrid - 1));

        renderMonthLabels(weeks + 1, alignedStart.to_unix());

        const cells = [];
        for (let index = 0; index < daysInGrid; index++) {
            const date = alignedStart.add_days(index);
            if (date.compare(today) > 0)
                break;

            const dateKey = date.format('%Y-%m-%d');
            const column = Math.floor(index / 7);
            const row = date.get_day_of_week() % 7; // Sun=7 -> row 0

            cells.push({
                x: column * (size + gap),
                y: row * (size + gap),
                color: cellColorFor(contributionLevel(byDate.get(dateKey) ?? 0)),
            });
        }

        matrixGeometry.size = size;
        matrixGeometry.gap = gap;
        matrixGeometry.weeks = weeks;
        matrixGeometry.dataKey = dataKey;
        matrixGeometry.cells = cells;

        gridCanvas.set_width(Math.max(1, weeks * (size + gap) - gap));
        gridCanvas.set_height(Math.max(1, 7 * (size + gap) - gap));
        gridCanvas.queue_repaint();
    }

    function updateStatus(text) {
        statusLabel.text = text;
    }

    function fetchJson(url, callback) {
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (message.get_status() !== HTTP_STATUS_OK)
                    throw new Error(`HTTP ${message.get_status()}`);
                callback(null, JSON.parse(decoder.decode(bytes.get_data())));
            } catch (err) {
                const isCancelled = err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
                callback(isCancelled ? null : err, null);
            }
        });
    }

    function loadAvatar() {
        if (!username) return;
        const url = `https://github.com/${encodeURIComponent(username)}.png?size=${AVATAR_REQUEST_SIZE_PX}`;
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (s, res) => {
            if (isActorDestroyed(container)) return;
            try {
                const bytes = s.send_and_read_finish(res);
                if (!bytes || bytes.get_size() === 0 || message.get_status() !== HTTP_STATUS_OK) return;

                const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                GdkPixbuf.Pixbuf.new_from_stream_async(stream, state.cancellable, (_source, result) => {
                    if (isActorDestroyed(container)) return;
                    try {
                        let pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(result);
                        if (!pixbuf.get_has_alpha())
                            pixbuf = pixbuf.add_alpha(false, 0, 0, 0);

                        // Bake a circular alpha mask into the pixels; St only
                        // rounds its background, not image content.
                        const pixels = pixbuf.get_pixels();
                        applyCornerMask(pixels, pixbuf.get_width(), pixbuf.get_height(),
                            Math.floor(pixbuf.get_width() / 2), pixbuf.get_rowstride());

                        const imageContent = new St.ImageContent({
                            preferred_width: pixbuf.get_width(),
                            preferred_height: pixbuf.get_height(),
                        });
                        const pixelBytes = new GLib.Bytes(pixels);
                        setImageContentBytes(imageContent, pixelBytes, Cogl.PixelFormat.RGBA_8888,
                            pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_rowstride());
                        avatarWidget.set_content(imageContent);
                        initialsLabel.hide();
                    } catch (_err) {
                        /* keep initials fallback */
                    }
                });
            } catch (_err) {
                /* keep initials fallback */
            }
        });
    }

    function fetchContributions() {
        if (!username) return;
        updateStatus('Fetching…');
        fetchJson(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}`, (err, data) => {
            if (isActorDestroyed(container)) return;
            if (err || !data || !Array.isArray(data.contributions)) {
                updateStatus('Error loading');
                return;
            }

            const byDate = new Map();
            let latestYear = null;
            const yearKeys = Object.keys(data.total || {});
            if (yearKeys.length > 0)
                latestYear = yearKeys[yearKeys.length - 1];

            data.contributions.forEach(day => byDate.set(day.date, day.count || 0));

            badgeLabel.text = `${(latestYear ? data.total[latestYear] : 0).toLocaleString()} contributions`;
            lastSyncTime = GLib.DateTime.new_now_local();
            updateStatus(`Synced ${lastSyncTime.format('%H:%M')}`);

            latestByDate = byDate;
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
        avatarWidget.content = null;
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

    registerWidgetCleanup(container, () => {
        state.cancellable.cancel();
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
        session.abort();
        persistUsername();
        if (global.stage.get_key_focus() === usernameEntry)
            global.stage.set_key_focus(null);
    });

    applyLayout();
    updateHeader();

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        scale = Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX);
        applyLayout();
    });

    loadJsonFromFileAsync(dataFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && typeof savedData.username === 'string') {
            username = savedData.username;
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
