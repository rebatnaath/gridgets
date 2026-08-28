import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    resolveDesktopAppInfo,
} from '../utils/widgetUtils.js';
import { MONTH_NAMES_ABBREVIATED as MONTH_NAMES, createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { screenTimeEngine } from '../utils/screenTimeEngine.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';
import { toDateString } from '../utils/moodStore.js';

const REF_WIDTH = 360;
const BORDER_ALPHA = 0.14;
const REF_HEIGHT = 170;

const MAIN_PANEL_WIDTH_RATIO = 0.65;
const SIDE_PANEL_LIGHTEN = 0.08;

const Y_AXIS_WIDTH_PX = 35;
const X_AXIS_HEIGHT_PX = 15;
const BAR_WIDTH_PX = 4;
const HOURS_PER_DAY = 24;

// Dynamic axis: tallest hour bucket, rounded up to a 5-minute multiple.
const MIN_SCALE_SECONDS = 300;
const HEADER_RESERVED_HEIGHT_PX = 46;
const HEADER_MARGIN_BOTTOM_PX = 12;

function computeScaleMaxSeconds(hours) {
    let maxSeconds = 0;
    for (const seconds of hours)
        maxSeconds = Math.max(maxSeconds, seconds);
    const base = Math.max(MIN_SCALE_SECONDS, maxSeconds);
    return Math.ceil(base / MIN_SCALE_SECONDS) * MIN_SCALE_SECONDS;
}

const HEADER_FONT_SIZE_PX = 32;
const DATE_LABEL_FONT_SIZE_PX = 11;
const AXIS_LABEL_FONT_SIZE_PX = 10;
const APP_TIME_FONT_SIZE_PX = 13;
const NAV_BUTTON_SIZE_PX = 26;
const NAV_ICON_SIZE_PX = 16;
const APP_ICON_SIZE_PX = 20;
const MAX_VISIBLE_APPS = 4;
const SECONDARY_TEXT_OPACITY = 0.63;
const DISABLED_CONTROL_OPACITY = Math.round(255 * SECONDARY_TEXT_OPACITY);
const GRID_LINE_ALPHA = 0.3;

function addDays(dateString, delta) {
    const [y, m, d] = dateString.split('-').map(Number);
    const next = GLib.DateTime.new_local(y, m, d + delta, 12, 0, 0);
    return toDateString(next);
}

function formatShortDate(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1]}`;
}

function formatCompactDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0)
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    return `${minutes}m`;
}

function shadePanelColor(cssColor, amount) {
    const { r, g, b } = parseCssColor(cssColor);
    const isDark = (r * 0.299 + g * 0.587 + b * 0.114) < 0.5;
    const mix = (channel) => isDark
        ? Math.round(((channel * (1 - amount)) + amount) * 255)
        : Math.round(channel * 255 * (1 - amount));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function createScreenTimeNode(config, width, height, xPosition, yPosition) {
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 0;
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    container.style += ` border: 1px solid ${textRgba(BORDER_ALPHA)};`;

    const state = {
        selectedDate: null,
        snapshot: null,
        geometry: {},
        engineRelease: null,
        engineListener: null,
    };

    const splitBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(splitBox);

    const leftPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        style: `background-color: ${bgColor}; border-radius: ${borderRadius}px 0 0 ${borderRadius}px;`,
    });
    splitBox.add_child(leftPanel);

    const sideBgColor = shadePanelColor(bgColor, SIDE_PANEL_LIGHTEN);
    const rightPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        style: `background-color: ${sideBgColor}; border-radius: 0 ${borderRadius}px ${borderRadius}px 0;`,
    });
    splitBox.add_child(rightPanel);

    const headerBox = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    leftPanel.add_child(headerBox);

    const totalTimeLabel = new St.Label({
        text: '0m',
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style: `${fontCss}color: ${textColor}; font-size: ${HEADER_FONT_SIZE_PX}px; font-weight: 300;`,
    });
    headerBox.add_child(totalTimeLabel);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.END,
        style: 'spacing: 6px;',
    });
    headerBox.add_child(controlsColumn);

    const dateLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-size: ${DATE_LABEL_FONT_SIZE_PX}px; `
            + `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
    });
    controlsColumn.add_child(dateLabel);

    const navButtonsRow = new St.BoxLayout({ style: 'spacing: 6px;' });
    controlsColumn.add_child(navButtonsRow);

    const buildNavButton = (iconName, action) => {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            style: `width: ${NAV_BUTTON_SIZE_PX}px; height: ${NAV_BUTTON_SIZE_PX}px;`
                + `border: 1px solid ${textRgba(0.14)}; border-radius: 6px; background-color: transparent;`,
            child: new St.Icon({
                icon_name: iconName,
                icon_size: NAV_ICON_SIZE_PX,
                style: `color: ${textColor}; opacity: ${SECONDARY_TEXT_OPACITY};`,
            }),
        });
        button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1 || container.actionOverlay) return Clutter.EVENT_PROPAGATE;
            action();
            return Clutter.EVENT_STOP;
        });
        navButtonsRow.add_child(button);
        return button;
    };

    const goToPreviousDay = () => {
        state.selectedDate = addDays(state.selectedDate, -1);
        refreshData();
    };
    const goToNextDay = () => {
        if (state.selectedDate === screenTimeEngine.getTodayDate()) return;
        state.selectedDate = addDays(state.selectedDate, 1);
        refreshData();
    };

    const prevButton = buildNavButton('go-previous-symbolic', goToPreviousDay);
    const nextButton = buildNavButton('go-next-symbolic', goToNextDay);

    const chartWrap = new St.Widget({ x_expand: true, y_expand: true });
    leftPanel.add_child(chartWrap);

    const chartCanvas = new St.DrawingArea();
    chartWrap.add_child(chartCanvas);

    const yAxisAlignments = [Clutter.ActorAlign.START, Clutter.ActorAlign.CENTER, Clutter.ActorAlign.END];
    const yAxisLabels = ['0', '0', '0'].map((_, index) => new St.Label({
        y_expand: true,
        y_align: yAxisAlignments[index],
        x_align: Clutter.ActorAlign.END,
        style: `${fontCss}color: ${textColor}; font-size: ${AXIS_LABEL_FONT_SIZE_PX}px; `
            + `opacity: ${SECONDARY_TEXT_OPACITY};`,
    }));
    const yAxisBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.END,
    });
    yAxisLabels.forEach(label => yAxisBox.add_child(label));
    chartWrap.add_child(yAxisBox);

    const xAxisAlignments = [Clutter.ActorAlign.START, Clutter.ActorAlign.CENTER, Clutter.ActorAlign.END];
    const xAxisLabels = ['00:00', '12:00', '24:00'].map((text, index) => new St.Label({
        text,
        x_expand: true,
        x_align: xAxisAlignments[index],
        style: `${fontCss}color: ${textColor}; font-size: ${AXIS_LABEL_FONT_SIZE_PX}px; `
            + `opacity: ${SECONDARY_TEXT_OPACITY};`,
    }));
    const xAxisBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
    });
    xAxisLabels.forEach(label => xAxisBox.add_child(label));
    chartWrap.add_child(xAxisBox);

    const appRowsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 14px;',
    });
    rightPanel.add_child(appRowsBox);

    state.engineRelease = screenTimeEngine.acquire();
    state.selectedDate = screenTimeEngine.getTodayDate();

    const onEngineTick = () => {
        if (state.selectedDate === screenTimeEngine.getTodayDate())
            refreshData();
    };

    state.engineListener = onEngineTick;
    screenTimeEngine.addListener(onEngineTick);

    registerWidgetCleanup(container, () => {
        screenTimeEngine.removeListener(state.engineListener);
        state.engineRelease();
    });

    function refreshData() {
        if (isActorDestroyed(container)) return;
        if (state.selectedDate === screenTimeEngine.getTodayDate()) {
            state.snapshot = screenTimeEngine.getTodaySnapshot();
            renderDynamic();
        } else {
            screenTimeEngine.loadDayAsync(state.selectedDate, (snapshot) => {
                if (isActorDestroyed(container) || state.selectedDate !== snapshot.date) return;
                state.snapshot = snapshot;
                renderDynamic();
            });
        }
    }

    // Cheap fingerprint of the visible app list.
    function appListSignature(snapshot) {
        return JSON.stringify(snapshot.apps.slice(0, MAX_VISIBLE_APPS).map(app => [app.key, app.seconds]));
    }

    function renderDynamic() {
        if (!state.snapshot) return;
        const { geometry } = state;

        totalTimeLabel.text = formatCompactDuration(state.snapshot.totalSeconds);
        dateLabel.text = formatShortDate(state.selectedDate);
        const isViewingToday = state.selectedDate === screenTimeEngine.getTodayDate();
        nextButton.set_opacity(isViewingToday ? DISABLED_CONTROL_OPACITY : 255);

        updateYAxisLabels();

        const signature = appListSignature(state.snapshot);
        if (signature !== state.lastAppListSignature) {
            state.lastAppListSignature = signature;
            rebuildAppList();
        }
        if (geometry.plotWidth > 0)
            chartCanvas.queue_repaint();
    }

    function updateYAxisLabels() {
        const scaleMax = computeScaleMaxSeconds(state.snapshot.hours);
        const labels = [
            formatCompactDuration(scaleMax),
            formatCompactDuration(scaleMax / 2),
            '0',
        ];
        yAxisLabels.forEach((label, index) => label.set_text(labels[index]));
    }

    function rebuildAppList() {
        appRowsBox.destroy_all_children();

        const apps = state.snapshot.apps.slice(0, MAX_VISIBLE_APPS);
        if (apps.length === 0) {
            appRowsBox.add_child(new St.Label({
                text: 'No activity recorded',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${APP_TIME_FONT_SIZE_PX}px; `
                    + `opacity: ${SECONDARY_TEXT_OPACITY};`,
            }));
            return;
        }

        for (const app of apps) {
            const s = state.geometry.scale || 1;
            const px = (v) => Math.max(1, Math.round(v * s));

            // Icon pinned left, duration immediately after it — every value
            // starts at the same x so short ("6m") and long ("1h 53m") stay aligned.
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.FILL,
                style: 'spacing: 10px;',
            });

            const iconSlot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: px(APP_ICON_SIZE_PX),
                height: px(APP_ICON_SIZE_PX),
            });
            const appIcon = new St.Icon({
                icon_name: 'application-x-generic',
                icon_size: px(APP_ICON_SIZE_PX),
            });
            const appInfo = resolveDesktopAppInfo(app.key);
            const gicon = appInfo ? appInfo.get_icon() : null;
            if (gicon)
                appIcon.gicon = gicon;
            iconSlot.add_child(appIcon);
            row.add_child(iconSlot);

            row.add_child(new St.Label({
                text: formatCompactDuration(app.seconds),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${px(APP_TIME_FONT_SIZE_PX)}px; `
                    + `opacity: ${SECONDARY_TEXT_OPACITY};`,
            }));

            appRowsBox.add_child(row);
        }
    }

    chartCanvas.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        const { r, g, b } = parseCssColor(textColor);
        const s = state.geometry.scale || 1;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        ctx.setSourceRGBA(r, g, b, GRID_LINE_ALPHA);
        ctx.setLineWidth(1);
        ctx.setDash([3 * s, 3 * s], 0);

        for (let i = 0; i < 3; i++) {
            const y = Math.round((canvasHeight / 2) * i) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(canvasWidth, y);

            const x = Math.round((canvasWidth / 2) * i) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvasHeight);
        }
        ctx.stroke();
        ctx.setDash([], 0);

        const hours = state.snapshot ? state.snapshot.hours : [];
        const scaleMax = computeScaleMaxSeconds(hours);
        const accent = parseCssColor(accentHex);
        ctx.setSourceRGBA(accent.r, accent.g, accent.b, 1);
        const barWidth = Math.round(BAR_WIDTH_PX * s);
        const barRadius = Math.round(BAR_WIDTH_PX / 2 * s);

        for (let hour = 0; hour < hours.length; hour++) {
            if (hours[hour] <= 0) continue;
            const barHeight = Math.max(barWidth, (hours[hour] / scaleMax) * canvasHeight);
            const centerX = ((hour + 0.5) / HOURS_PER_DAY) * canvasWidth;
            const x = centerX - (barWidth / 2);
            const y = canvasHeight - barHeight;

            ctx.newSubPath();
            ctx.arc(x + barRadius, y + barRadius, barRadius, Math.PI, 1.5 * Math.PI);
            ctx.arc(x + barWidth - barRadius, y + barRadius, barRadius, 1.5 * Math.PI, 2 * Math.PI);
            ctx.lineTo(x + barWidth, canvasHeight);
            ctx.lineTo(x, canvasHeight);
            ctx.closePath();
        }
        ctx.fill();
        ctx.$dispose();
    });

    function applyLayout(currentWidth, currentHeight) {
        // Skip until the container has real dimensions; otherwise scale and
        // plot extents collapse to NaN and Clutter allocates INT32_MIN.
        if (!currentWidth || !currentHeight) return;
        const s = Math.min(currentWidth / REF_WIDTH, currentHeight / REF_HEIGHT);
        if (!isFinite(s) || s <= 0) return;
        state.geometry.scale = s;

        const totalWidth = currentWidth;
        const mainWidth = Math.round(totalWidth * MAIN_PANEL_WIDTH_RATIO);
        leftPanel.set_width(mainWidth);
        rightPanel.set_width(totalWidth - mainWidth);

        const padTop = Math.round(16 * s);
        const padBottom = Math.round(16 * s);
        const padLeft = Math.round(20 * s);
        const padRight = Math.round(12 * s);
        leftPanel.style = `background-color: ${bgColor}; border-radius: ${borderRadius}px 0 0 ${borderRadius}px;`
            + `padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`;

        rightPanel.style = `background-color: ${sideBgColor}; border-radius: 0 ${borderRadius}px ${borderRadius}px 0;`
            + `padding: ${padTop}px ${padLeft}px;`;

        headerBox.style = `margin-bottom: ${Math.round(12 * s)}px; padding-right: ${Math.round(5 * s)}px;`;
        totalTimeLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(HEADER_FONT_SIZE_PX * s)}px; font-weight: 300;`;

        prevButton.style = `width: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px; height: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px;`
            + `border: 1px solid ${textRgba(0.14)}; border-radius: ${Math.round(6 * s)}px; background-color: transparent;`;
        nextButton.style = prevButton.style;

        const chartWrapWidth = mainWidth - padLeft - padRight;
        // Reserve only what the tallest header column actually occupies
        // (date label 14 + spacing 6 + nav buttons 26), so the plot top — and
        // therefore the max scale mark — rises to the prev/next button level.
        const chartWrapHeight = currentHeight - padTop - padBottom
            - Math.round((HEADER_RESERVED_HEIGHT_PX + HEADER_MARGIN_BOTTOM_PX) * s);
        const plotWidth = Math.max(1, chartWrapWidth - Math.round(Y_AXIS_WIDTH_PX * s));
        const plotHeight = Math.max(1, chartWrapHeight - Math.round(X_AXIS_HEIGHT_PX * s));
        Object.assign(state.geometry, { plotWidth, plotHeight });

        chartCanvas.set_position(0, 0);
        chartCanvas.set_size(plotWidth, plotHeight);

        yAxisBox.set_position(plotWidth, 0);
        yAxisBox.set_size(Math.round(Y_AXIS_WIDTH_PX * s), plotHeight);

        xAxisBox.set_position(0, plotHeight + Math.round(4 * s));
        xAxisBox.set_size(plotWidth, Math.round(X_AXIS_HEIGHT_PX * s));
        xAxisBox.style = `margin-bottom: ${Math.round(6 * s)}px;`;

        appRowsBox.style = `spacing: ${Math.round(14 * s)}px;`;

        renderDynamic();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => applyLayout(w, h));
    refreshData();

    return container;
}
