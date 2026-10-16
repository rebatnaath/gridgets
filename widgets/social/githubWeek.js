import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER, DEFAULT_CHILD_CORNER_RADIUS_PX, cssColorToRgba, parseCssColor, resolveAccentColor, resolveChildCornerRadius, resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, connectTimerCleanup } from '../../shell/widgetUIUtils.js';
import { createOfflineNotice, OFFLINE_NOTICE_MESSAGES } from '../../components/offline/offlineNotice/offlineNotice.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import {
    DAY_NAMES,
    createGithubClient,
    githubAvatarCacheUri,
    loadGithubUsername,
    noteGithubAvatarFailure,
    saveGithubUsername,
    sumOverMonths,
    weekOfContributions,
    writeGithubAvatar,
} from './githubData.js';

const REF_WIDTH_PX = 420;
const REF_HEIGHT_PX = 340;
const CONTAINER_PADDING_V_PX = 18;
const CONTAINER_PADDING_H_PX = 22;
const MAIN_BOX_SPACING_PX = 10;
const SUMMARY_SPACING_PX = 26;
const AVATAR_SIZE_PX = 40;
const USERNAME_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const PILL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const CAPTION_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const COUNT_FONT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const SUMMARY_FONT_SIZE_PX = 28;
const BAR_AREA_HEIGHT_PX = 104;
const BAR_WIDTH_RATIO = 0.80;
/** Taken off the share of the column, so the bars sit in it rather than filling it. */
const BAR_WIDTH_TRIM_PX = 4;
/** The gap left between the bottom of a bar and the day name under it. */
const BAR_BASELINE_LIFT_PX = 14;
const BAR_CORNER_RATIO = 0.28;
const EMPTY_BAR_HEIGHT_PX = 5;
const PLACEHOLDER_HEIGHT_PX = 14;
const PLACEHOLDER_DASH_PX = 4;
const PLACEHOLDER_GAP_PX = 3;
const DIVIDER_THICKNESS_PX = 1;
const PILL_BORDER_WIDTH_PX = 1;
const SUMMARY_MONTHS = 6;
const PILL_RADIUS_PX = 999;
const REFRESH_INTERVAL_SECONDS = 600;
const CLUTTER_OPACITY_OPAQUE = 255;

/**
 * The outline of a rounded rectangle as a closed polyline, walked from the top-left corner
 * clockwise so the ends meet around the corners.
 */
function roundedOutline(x, y, width, height, radius, samplesPerCorner = 6) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const points = [];
    const arc = (centreX, centreY, fromDeg, toDeg) => {
        for (let step = 0; step <= samplesPerCorner; step++) {
            const degrees = fromDeg + (toDeg - fromDeg) * (step / samplesPerCorner);
            const radians = (degrees * Math.PI) / 180;
            points.push([centreX + r * Math.cos(radians), centreY + r * Math.sin(radians)]);
        }
    };
    arc(x + r, y + r, 180, 270);
    arc(x + width - r, y + r, 270, 360);
    arc(x + width - r, y + height - r, 0, 90);
    arc(x + r, y + height - r, 90, 180);
    return points;
}

/** The drawn runs of a dash pattern walked along a closed polyline. */
function dashedSegments(points, dash, gap) {
    const segments = [];
    let drawing = true;
    let remaining = dash;
    let fromX = points[0][0];
    let fromY = points[0][1];
    // The last point is joined back to the first, which is what closes the outline.
    for (let index = 1; index <= points.length; index++) {
        const [toX, toY] = points[index % points.length];
        let distanceLeft = Math.hypot(toX - fromX, toY - fromY);
        while (distanceLeft > 0) {
            const step = Math.min(distanceLeft, remaining);
            const ratio = step / distanceLeft;
            const nextX = fromX + (toX - fromX) * ratio;
            const nextY = fromY + (toY - fromY) * ratio;
            if (drawing)
                segments.push([fromX, fromY, nextX, nextY]);
            fromX = nextX;
            fromY = nextY;
            distanceLeft -= step;
            remaining -= step;
            if (remaining <= 1e-6) {
                drawing = !drawing;
                remaining = drawing ? dash : gap;
            }
        }
    }
    return segments;
}

export function createGithubWeekNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentColor = resolveAccentColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let username = typeof config.username === 'string' ? config.username : '';
    /** Tracked apart from the parameter: a resize only reaches the scaler callback. */
    let currentWidth = width;
    let scale = clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    const px = v => scaleFontSize(v, scale);
    /** file:// URI of the stored avatar, empty until one has been fetched. */
    let avatarImageUri = '';
    let latestByDate = null;

    const state = { timerId: null, editing: false, cancellable: new Gio.Cancellable() };
    const client = createGithubClient(state.cancellable);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    mainBox.add_child(headerRow);

    // A plain widget with the picture as its background: border-radius then clips the
    // image itself, so the avatar is round without any pixel masking.
    const avatarWidget = new St.Widget({
        style: `background-color: ${card}; border-radius: 999px;`,
        y_align: Clutter.ActorAlign.CENTER,
        layout_manager: new Clutter.BinLayout(),
    });
    headerRow.add_child(avatarWidget);

    const usernameLabel = new St.Label({
        text: username ? `@${username}` : '',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(usernameLabel);

    const usernameEntry = new St.Entry({
        text: username,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    usernameEntry.hide();
    headerRow.add_child(usernameEntry);

    headerRow.add_child(new St.Widget({ x_expand: true }));

    const totalPill = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(totalPill);

    const barsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(barsRow);

    const dayColumns = DAY_NAMES.map(name => {
        const countLabel = new St.Label({ text: '', x_align: Clutter.ActorAlign.CENTER });
        // Takes up whatever the bar does not, so the bar below it is pushed down onto the
        // day name. A slot of a fixed height plus y_align: END was not enough: a short bar
        // came out floating in the middle of the column instead of on the baseline.
        const spacer = new St.Widget({ y_expand: true });
        const dayLabel = new St.Label({ text: name, x_align: Clutter.ActorAlign.CENTER });
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        column.add_child(countLabel);
        column.add_child(spacer);
        column.add_child(dayLabel);
        barsRow.add_child(column);
        // The previous bar is held so it can be destroyed before the next one is inserted.
        // Without that, every refresh and every resize would stack another bar into the
        // column, since the bar now lives in the column itself rather than in a slot that
        // was emptied first.
        return { countLabel, spacer, dayLabel, box: column, bar: null };
    });

    const divider = new St.Widget({ x_align: Clutter.ActorAlign.FILL });
    mainBox.add_child(divider);

    const summaryRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    mainBox.add_child(summaryRow);

    const summaries = ['this week', 'last week'].map(caption => {
        const value = new St.Label({ text: '', x_align: Clutter.ActorAlign.START });
        const captionLabel = new St.Label({ text: caption, x_align: Clutter.ActorAlign.START });
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.START,
        });
        column.add_child(value);
        column.add_child(captionLabel);
        summaryRow.add_child(column);
        return { value, caption: captionLabel };
    });

    summaryRow.add_child(new St.Widget({ x_expand: true }));

    const deltaPill = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    summaryRow.add_child(deltaPill);

    // A widget added with no network has nothing to show, so the whole layout is held back
    // and this stands in for it.
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

    /**
     * The height the bars have to share, measured from what the column was given.
     *
     * The count and the day name are subtracted because the bars are laid out between them.
     * Before the first allocation there is nothing to measure, so the design height stands in
     * and the bars are corrected on the next layout pass.
     */
    function barAreaHeight() {
        const measured = dayColumns[0].box.height || 0;
        const labels = (dayColumns[0].countLabel.height || 0) + (dayColumns[0].dayLabel.height || 0);
        if (measured <= 0 || labels <= 0)
            return px(BAR_AREA_HEIGHT_PX);
        return Math.max(px(EMPTY_BAR_HEIGHT_PX * 2), measured - labels);
    }

    /** Every bar is scaled against the tallest day, so a quiet week still fills the space. */
    function applyBars(summary) {
        const tallest = Math.max(1, ...summary.counts.map(count => count || 0));
        const stubHeight = Math.round(px(EMPTY_BAR_HEIGHT_PX));
        // The lift is taken out of the height before anything is scaled into it. Without that
        // the tallest bar grew by the full area and was then translated up into the count
        // above it, which is how the two came to overlap.
        const lift = Math.round(px(BAR_BASELINE_LIFT_PX));
        const areaHeight = Math.max(stubHeight * 2, barAreaHeight() - lift);

        dayColumns.forEach((column, index) => {
            const count = summary.counts[index];

            // A day still to come has no bar and no number. Drawing it as a zero would claim
            // the day had been quiet, which is a statement about the past.
            column.countLabel.text = count === null ? '' : String(count);
            if (column.bar) {
                column.bar.destroy();
                column.bar = null;
            }

            if (count === null) {
                const placeholder = new St.DrawingArea({
                    // Centred, because a child of the box fills its width by default and the
                    // requested width would be ignored.
                    style: `width: ${barWidth()}px; height: ${px(PLACEHOLDER_HEIGHT_PX)}px;`,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                placeholder.connect('repaint', canvas => drawPlaceholder(canvas));
                // Lifted clear of the baseline so a day still to come reads differently from a
                // day that passed with nothing on it.
                placeholder.translation_y = -px(BAR_BASELINE_LIFT_PX);
                column.box.insert_child_below(placeholder, column.dayLabel);
                column.bar = placeholder;
                return;
            }

            const barHeight = Math.max(stubHeight,
                Math.round((count / tallest) * (areaHeight - stubHeight)));
            // Centred for the same reason as the placeholder: without it the bar fills the
            // whole column, so the width in barStyle never reaches the screen.
            const bar = new St.Widget({
                style: barStyle(count, barHeight),
                x_align: Clutter.ActorAlign.CENTER,
            });
            bar.translation_y = -px(BAR_BASELINE_LIFT_PX);
            column.box.insert_child_below(bar, column.dayLabel);
            column.bar = bar;
        });
    }

    /**
     * The width of a column as it was actually allocated.
     *
     * Reading it off the actor rather than dividing the widget's width is what makes the
     * bars track the layout: the creation-time width is only a starting guess, and the
     * column also has to be wide enough for the day name under it, so neither the guess nor
     * the widget width describes the space the bar actually gets.
     */
    function columnWidth() {
        const measured = dayColumns[0].box.width || 0;
        if (measured > 0)
            return measured;
        const inner = currentWidth - px(CONTAINER_PADDING_H_PX) * 2;
        return inner / DAY_NAMES.length;
    }

    function barWidth() {
        const trimmed = Math.round(columnWidth() * BAR_WIDTH_RATIO) - Math.round(px(BAR_WIDTH_TRIM_PX));
        const floor = Math.round(px(6));
        return Number.isFinite(trimmed) && trimmed > floor ? trimmed : floor;
    }

    function barStyle(count, barHeight) {
        const barWidth_ = barWidth();
        const radius = Math.min(barWidth_ * BAR_CORNER_RATIO, barHeight / 2);
        if (count === 0)
            return `width: ${barWidth_}px; height: ${px(EMPTY_BAR_HEIGHT_PX)}px;`
                + `border-radius: ${radius}px;`
                + `background-color: ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`;
        // St drops a CSS linear-gradient(), so the fade is expressed with its own gradient
        // properties: lighter at the top of the bar, near-full accent at the base.
        return `width: ${barWidth_}px; height: ${barHeight}px; border-radius: ${radius}px;`
            + 'background-gradient-direction: vertical;'
            + ` background-gradient-start: ${cssColorToRgba(accentColor, 0.62)};`
            + ` background-gradient-end: ${cssColorToRgba(accentColor, 0.95)};`;
    }

    /** A dashed outline standing in for a day that has not happened yet. */
    function drawPlaceholder(canvas) {
        const ctx = canvas.get_context();
        const [canvasWidth, canvasHeight] = canvas.get_surface_size();
        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);
        if (canvasWidth <= 0 || canvasHeight <= 0)
            return;

        const width_ = Math.min(barWidth(), canvasWidth);
        const height_ = Math.min(px(PLACEHOLDER_HEIGHT_PX), canvasHeight);
        const x = Math.round((canvasWidth - width_) / 2);
        const y = Math.round(canvasHeight - height_);
        const radius = Math.min(height_ / 2,
            resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale) * 2);
        const accent = parseCssColor(accentColor);

        ctx.setSourceRGBA(accent.r, accent.g, accent.b, GRAPHICS_OPACITY.border);
        ctx.setLineWidth(Math.max(1, Math.round(scale)));
        for (const [fromX, fromY, toX, toY] of
            dashedSegments(roundedOutline(x, y, width_, height_, radius), px(PLACEHOLDER_DASH_PX), px(PLACEHOLDER_GAP_PX))) {
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();
        }
    }

    function applySummary(summary) {
        summaries[0].value.text = summary.thisWeek.toLocaleString();
        summaries[1].value.text = summary.lastWeek.toLocaleString();

        const delta = summary.thisWeek - summary.lastWeek;
        deltaPill.text = delta === 0 ? 'same as last' : `${delta > 0 ? '+' : ''}${delta} vs last`;
        totalPill.text = `${summary.total.toLocaleString()} in ${SUMMARY_MONTHS} months`;
    }

    function render(byDate) {
        latestByDate = byDate;
        const today = GLib.DateTime.new_now_local();
        const summary = {
            ...weekOfContributions(byDate, today),
            total: sumOverMonths(byDate, today, SUMMARY_MONTHS),
        };
        applyBars(summary);
        applySummary(summary);
    }

    function loadAvatar() {
        if (!username) return;
        // The request is for this user specifically, so the cache key comes from the name
        // that was asked for rather than from whatever username holds when the answer lands.
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
            writeGithubAvatar(config, requestedUsername, bytes, () => {
                if (isActorDestroyed(container) || username !== requestedUsername) return;
                avatarImageUri = uri;
                applyLayout();
            });
        });
    }

    function fetchContributions() {
        if (!username) return;
        const requestedUsername = username;
        client.fetchContributions(requestedUsername, (err, byDate) => {
            if (isActorDestroyed(container) || username !== requestedUsername) return;
            if (err || !byDate) {
                // Without a network there is nothing to retry against, so an empty set of
                // bars would only say the account was quiet.
                if (!isNetworkAvailable())
                    showOfflineState();
                return;
            }
            showContentState();
            render(byDate);
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
        if (!commit || !submitted || submitted === username) {
            usernameLabel.text = username ? `@${username}` : '';
            return;
        }
        username = submitted;
        config.username = submitted;
        usernameLabel.text = `@${username}`;
        // Cleared before the rebuild so the previous person's picture goes with the name;
        // leaving it lets a failed fetch keep the old avatar on screen for good.
        avatarImageUri = '';
        saveGithubUsername(config, username);
        applyLayout();
        fetchContributions();
        loadAvatar();
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

    usernameEntry.clutter_text.connect('key-focus-out', () => endEdit(false));

    function applyLayout() {
        offlineNotice.applyScale(scale);
        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px;`
            + ` spacing: ${px(MAIN_BOX_SPACING_PX)}px;`;
        // Rebuilt rather than appended to, so dropping the picture removes the
        // background-image instead of leaving the last avatar on screen.
        avatarWidget.style = `background-color: ${card}; border-radius: 999px;`
            + `width: ${px(AVATAR_SIZE_PX)}px; height: ${px(AVATAR_SIZE_PX)}px;`
            + (avatarImageUri
                ? ` background-image: url("${avatarImageUri}");`
                    + ' background-size: cover; background-position: center;'
                : '');
        usernameLabel.style = `${fontCss}font-size: ${scaleFontSize(USERNAME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; margin-left: ${px(10)}px;`;
        usernameEntry.style = `${fontCss}font-size: ${scaleFontSize(USERNAME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `color: ${textColor}; width: ${px(150)}px;`;

        const pillStyle = `${fontCss}font-size: ${scaleFontSize(PILL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${accentColor};`
            + ` border: ${PILL_BORDER_WIDTH_PX}px solid ${cssColorToRgba(accentColor, GRAPHICS_OPACITY.border)};`
            + ` border-radius: ${px(PILL_RADIUS_PX)}px; padding: ${px(3)}px ${px(10)}px;`
            + ` background-color: ${cssColorToRgba(accentColor, 0.10)};`;
        totalPill.style = pillStyle;
        deltaPill.style = pillStyle;

        dayColumns.forEach(column => {
            column.countLabel.style = `${fontCss}font-size: ${scaleFontSize(COUNT_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label)}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${accentColor};`;
            column.dayLabel.style = `${fontCss}font-size: ${scaleFontSize(CAPTION_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                + `color: ${textColor};`;
            column.dayLabel.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary);
        });

        // The spacing is what keeps 'this week' and 'last week' from running together as one
        // word: the two columns are packed edge to edge otherwise.
        summaryRow.style = `spacing: ${px(SUMMARY_SPACING_PX)}px;`;
        summaries.forEach(summary => {
            summary.value.style = `${fontCss}font-size: ${scaleFontSize(SUMMARY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor};`;
            summary.caption.style = `${fontCss}font-size: ${scaleFontSize(CAPTION_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
                + `color: ${textColor};`;
            summary.caption.opacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary);
        });

        divider.style = `height: ${px(DIVIDER_THICKNESS_PX)}px;`
            + `background-color: ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`;

        if (latestByDate)
            render(latestByDate);
    }

    applyLayout();
    if (username && !isNetworkAvailable())
        showOfflineState();

    // A widget parked on the offline notice has nothing to retry on its own, so it waits for
    // the network to come back and then asks again.
    const releaseConnectivity = subscribeToSettledConnectivity(available => {
        if (!available || isActorDestroyed(container) || !username) return;
        fetchContributions();
        loadAvatar();
    });

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (isActorDestroyed(container))
            return GLib.SOURCE_REMOVE;
        fetchContributions();
        loadAvatar();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        state.cancellable.cancel();
        releaseConnectivity();
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (ratio, newWidth) => {
        if (isActorDestroyed(container)) return;
        scale = ratio;
        currentWidth = newWidth;
        applyLayout();
    });

    loadGithubUsername(config, savedUsername => {
        if (isActorDestroyed(container)) return;
        if (savedUsername) {
            username = savedUsername;
            config.username = username;
            usernameLabel.text = `@${username}`;
            applyLayout();
            fetchContributions();
            loadAvatar();
        } else if (username) {
            fetchContributions();
            loadAvatar();
        } else {
            saveGithubUsername(config, username);
        }
    });

    return container;
}