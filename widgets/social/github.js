import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import { CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER, DEFAULT_CHILD_CORNER_RADIUS_PX, getGridgetsDataDir, loadJsonFromFileAsync, parseCssColor, resolveChildCornerRadius, resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces, cssColorToRgba, saveJsonToFile, resolveAccentColor } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, traceRoundedRect, MONTH_NAMES_ABBREVIATED as MONTH_NAMES } from '../../shell/widgetUIUtils.js';
import { createGetMessage } from '../../utils/httpClient.js';
import { createOfflineNotice, OFFLINE_NOTICE_MESSAGES } from '../../components/offline/offlineNotice/offlineNotice.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';
import { cachedImageUri, writeCachedImageBytes } from '../../utils/lastGoodCache.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH_PX = 420;
const REF_HEIGHT_PX = 200;
const CONTAINER_PADDING_V_PX = 16;
const CONTAINER_PADDING_H_PX = 20;
const AVATAR_SIZE_PX = 34;
const USERNAME_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const BADGE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const FOOTER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const CELL_SIZE_PX = 12;
const CELL_GAP_RATIO = 0.27;
const DAY_LABELS_WIDTH_PX = 24;
const DAY_LABEL_ROWS = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
const MAIN_BOX_SPACING_PX = 10;
const CONTRIBUTION_LEVEL_ALPHAS = [0, 0.28, 0.48, 0.72, 1];
const MIN_CONTRIBUTION_WEEKS = 8;
const MAX_CONTRIBUTION_WEEKS = 30;
const AVATAR_REQUEST_SIZE_PX = 64;
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
    const accentColor = resolveAccentColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const contributionColors = CONTRIBUTION_LEVEL_ALPHAS.map(alpha => cssColorToRgba(accentColor, alpha));
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const emptyCellColor = card;

    let username = typeof config.username === 'string' ? config.username : '';
    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    const px = (v) => Math.max(1, Math.round(v * scale));
    let lastSyncTime = null;
    let latestByDate = new Map();
    /** file:// URI of the stored avatar, empty until one has been fetched. */
    let avatarImageUri = '';

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
        style: `spacing: ${MAIN_BOX_SPACING_PX}px;`,
    });
    container.add_child(mainBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });

    // A plain widget with the picture as its background: border-radius then clips the
    // image itself, so the avatar is round without any pixel masking. Masking the pixels
    // instead depends on the decoded size being square and on cairo honouring the alpha,
    // and it left a rectangle when either assumption did not hold.
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

    const usernameLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor};`,
    });

    const badgeLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${BADGE_FONT_SIZE_PX}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor};`
            + `background-color: ${card}; border: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`
            + `border-radius: 12px; padding: 3px 8px;`,
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
        text: username ? 'Syncing…' : 'Click the username to configure',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}font-size: ${scaleFontSize(FOOTER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`,
    });

    footerBox.add_child(statusLabel);

    const persistUsername = () => saveJsonToFile(dataFilePath, { username });

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
        badgeLabel.style = `${fontCss}font-size: ${scaleFontSize(BADGE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor};`
            + `background-color: ${card}; border: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`
            + `border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px; padding: ${px(3)}px ${px(8)}px;`;

        renderMatrix();
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
        monthLabelsRow.style = `margin-left: ${px(DAY_LABELS_WIDTH_PX + 4)}px; margin-top: ${px(4)}px;`
            + `margin-bottom: ${px(3)}px; height: ${px(12)}px;`;

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

            // BinLayout stacks children, so translation_x positions each label
            // absolutely over its week column regardless of label text width.
            const label = new St.Label({
                text: MONTH_NAMES[month],
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                    + `color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`,
            });
            label.translation_x = labelX;
            lastLabelEnd = labelX + estimatedLabelWidth;
            monthLabelsRow.add_child(label);
        }
    }

    function renderDayLabels() {
        dayLabelsColumn.destroy_all_children();
        dayLabelsColumn.style = `width: ${px(DAY_LABELS_WIDTH_PX)}px; spacing: ${cellGap()}px;`
            + `padding-right: ${px(4)}px;`;

        for (let row = 0; row < 7; row++) {
            const label = new St.Label({
                text: DAY_LABEL_ROWS[row] || '',
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${scaleFontSize(LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                    + `color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`,
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

    const matrixGeometry = { size: 0, dataKey: '', cells: [] };


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

    function renderMatrix(contributionsByDate) {
        const byDate = contributionsByDate || latestByDate;

        const size = cellSize();
        const gap = cellGap();
        // matrixBody spans the label column + canvas; only the remainder
        // after the labels can hold week columns, or the tail gets clipped
        const bodyWidth = matrixBody.width || (width - px(CONTAINER_PADDING_H_PX) * 2);
        const availableWidth = bodyWidth - px(DAY_LABELS_WIDTH_PX + 4);
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
        const message = createGetMessage(url);
        if (!message) {
            callback(new Error('request could not be created'), null);
            return;
        }
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
        const message = createGetMessage(url);
        if (!message) {
            console.error('Gridgets: github avatar request could not be created');
            return;
        }
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (s, res) => {
            if (isActorDestroyed(container)) return;
            try {
                const bytes = s.send_and_read_finish(res);
                if (!bytes || bytes.get_size() === 0)
                    throw new Error('empty response');
                // GitHub's avatar endpoint redirects and answers with JPEG whatever the
                // .png in the URL says, so the bytes are stored as they arrive and the
                // stylesheet is left to work out the format.
                if (message.get_status() !== HTTP_STATUS_OK)
                    throw new Error(`status ${message.get_status()}`);

                // Keyed by username and size, so a different person gets a different file
                // and St's CSS cache cannot serve one avatar in place of another. The style
                // is applied only once the write has landed, because a background-image
                // pointing at a file that is not there yet fails silently.
                const key = `avatar-${username}-${AVATAR_REQUEST_SIZE_PX}`;
                const uri = cachedImageUri('github', config.id, key);
                if (!uri)
                    throw new Error('no cache path for avatar');
                writeCachedImageBytes('github', config.id, key, bytes, () => {
                    if (isActorDestroyed(container)) return;
                    avatarImageUri = uri;
                    initialsLabel.hide();
                    applyLayout();
                });
            } catch (err) {
                console.error('Gridgets: github avatar could not be fetched:', err.message);
            }
        });
    }

    function fetchContributions() {
        if (!username) return;
        updateStatus('Syncing…');
        fetchJson(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}`, (err, data) => {
            if (isActorDestroyed(container)) return;
            if (err || !data || !Array.isArray(data.contributions)) {
                if (!isNetworkAvailable()) {
                    showOfflineState();
                    return;
                }
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
        avatarImageUri = '';
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

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        scale = Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX);
        applyLayout();
    });

    registerWidgetCleanup(container, () => releaseConnectivity());

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
