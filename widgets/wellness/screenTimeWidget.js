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
    resolveWidgetSurfaces,
    resolveChildCornerRadius,
    DEFAULT_CHILD_CORNER_RADIUS_PX,
    DESKTOP_APP_KEY,
    resolveAccentColor } from '../../utils/widgetUtils.js';
import { MONTH_NAMES_ABBREVIATED as MONTH_NAMES, createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { screenTimeEngine } from '../../utils/screenTimeEngine.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { toDateString } from '../../utils/moodStore.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, GRAPHICS_OPACITY, scaleFontSize } from '../../utils/typography.js';

const REF_WIDTH = 360;
const REF_HEIGHT = 170;

const MAIN_PANEL_WIDTH_RATIO = 0.65;

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

const HEADER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.displayLG;
const DATE_LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const AXIS_LABEL_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const APP_TIME_FONT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const NAV_BUTTON_SIZE_PX = 26;
const NAV_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconMd;
const APP_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconMd;
const MAX_VISIBLE_APPS = 4;
const SECONDARY_TEXT_OPACITY = TEXT_OPACITY.secondary;
const DISABLED_CONTROL_OPACITY = Math.round(255 * TEXT_OPACITY.disabled);
const PANEL_PADDING_TOP_PX = 16;
const PANEL_PADDING_BOTTOM_PX = 16;
const PANEL_PADDING_LEFT_PX = 20;
const PANEL_PADDING_RIGHT_PX = 12;

const HEADER_PADDING_RIGHT_PX = 5;
const CONTROLS_COLUMN_SPACING_PX = 6;
const NAV_BUTTONS_SPACING_PX = 6;
const APP_ROW_ITEM_SPACING_PX = 10;
const AXIS_LABEL_SPACING_PX = 4;
const AXIS_MARGIN_BOTTOM_PX = 6;
const APP_ROWS_SPACING_PX = 14;

function addDays(dateString, delta) {
    const [year, month, day] = dateString.split('-').map(Number);
    const next = GLib.DateTime.new_local(year, month, day + delta, 12, 0, 0);
    return toDateString(next);
}

function formatShortDate(dateString) {
    const [, month, day] = dateString.split('-').map(Number);
    return `${day} ${MONTH_NAMES[month - 1]}`;
}

function formatCompactDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0)
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    return `${minutes}m`;
}



export function createScreenTimeNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const { card } = resolveWidgetSurfaces(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 0;
    const accentHex = resolveAccentColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    connectShortClick(container, () => launchApplication('gnome-control-center wellbeing'));

    const state = {
        selectedDate: null,
        snapshot: null,
        geometry: {},
        lastAppListSignature: null,
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
        style: `background-color: ${backgroundColor}; border-radius: ${borderRadius}px 0 0 ${borderRadius}px;`,
    });
    splitBox.add_child(leftPanel);

    const rightPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        style: `background-color: ${card}; border-radius: 0 ${borderRadius}px ${borderRadius}px 0;`,
    });
    splitBox.add_child(rightPanel);

    const headerBox = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    leftPanel.add_child(headerBox);

    const totalTimeLabel = new St.Label({
        text: '0m',
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style: `${fontCss}color: ${textColor}; font-size: ${HEADER_FONT_SIZE_PX}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
    });
    headerBox.add_child(totalTimeLabel);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.END,
        style: `spacing: ${CONTROLS_COLUMN_SPACING_PX}px;`,
    });
    headerBox.add_child(controlsColumn);

    const dateLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-size: ${DATE_LABEL_FONT_SIZE_PX}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${SECONDARY_TEXT_OPACITY};`,
    });
    controlsColumn.add_child(dateLabel);

    const navButtonsRow = new St.BoxLayout({ style: `spacing: ${NAV_BUTTONS_SPACING_PX}px;` });
    controlsColumn.add_child(navButtonsRow);

    const buildNavButton = (iconName, action) => {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            style: `width: ${NAV_BUTTON_SIZE_PX}px; height: ${NAV_BUTTON_SIZE_PX}px;`
                + `border: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`
                + `border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, 1)}px; background-color: transparent;`,
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
            + `font-weight: ${TYPOGRAPHY_WEIGHT.medium}; opacity: ${SECONDARY_TEXT_OPACITY};`,
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
                    + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${SECONDARY_TEXT_OPACITY};`,
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
        style: `spacing: ${APP_ROWS_SPACING_PX}px;`,
    });
    rightPanel.add_child(appRowsBox);

    state.selectedDate = screenTimeEngine.getTodayDate();

    const onEngineTick = () => {
        if (state.selectedDate === screenTimeEngine.getTodayDate())
            refreshData();
    };

    screenTimeEngine.addListener(onEngineTick);

    registerWidgetCleanup(container, () => {
        screenTimeEngine.removeListener(onEngineTick);
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

    function appListSignature(snapshot) {
        return JSON.stringify(snapshot.apps
            .filter(app => app.key !== DESKTOP_APP_KEY)
            .slice(0, MAX_VISIBLE_APPS)
            .map(app => [app.key, app.seconds]));
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

        const apps = state.snapshot.apps
            .filter(app => app.key !== DESKTOP_APP_KEY)
            .slice(0, MAX_VISIBLE_APPS);
        if (apps.length === 0) {
            appRowsBox.add_child(new St.Label({
                text: 'No activity recorded',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(APP_TIME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label)}px; `
                    + `opacity: ${SECONDARY_TEXT_OPACITY};`,
            }));
            return;
        }

        for (const app of apps) {
            const scale = state.geometry.scale || 1;
            const scalePixels = value => Math.max(1, Math.round(value * scale));

            // Icon pinned left, duration immediately after it — every value
            // starts at the same x so short ("6m") and long ("1h 53m") stay aligned.
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.FILL,
                style: `spacing: ${APP_ROW_ITEM_SPACING_PX}px;`,
            });

            const iconSlot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: scalePixels(APP_ICON_SIZE_PX),
                height: scalePixels(APP_ICON_SIZE_PX),
            });
            const appIcon = new St.Icon({
                icon_name: 'application-x-generic',
                icon_size: scalePixels(APP_ICON_SIZE_PX),
            });
            const appInfo = resolveDesktopAppInfo(app.key);
            const gicon = appInfo ? appInfo.get_icon() : null;
            if (gicon) {
                appIcon.gicon = gicon;
            }
            iconSlot.add_child(appIcon);
            row.add_child(iconSlot);

            row.add_child(new St.Label({
                text: formatCompactDuration(app.seconds),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(APP_TIME_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label)}px; `
                    + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${SECONDARY_TEXT_OPACITY};`,
            }));

            appRowsBox.add_child(row);
        }
    }

    chartCanvas.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        const { r, g, b } = parseCssColor(textColor);
        const scale = state.geometry.scale || 1;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        ctx.setSourceRGBA(r, g, b, GRAPHICS_OPACITY.gridLine);
        ctx.setLineWidth(1);
        ctx.setDash([3 * scale, 3 * scale], 0);

        for (let gridIndex = 0; gridIndex < 3; gridIndex++) {
            const gridY = Math.round((canvasHeight / 2) * gridIndex) + 0.5;
            ctx.moveTo(0, gridY);
            ctx.lineTo(canvasWidth, gridY);

            const gridX = Math.round((canvasWidth / 2) * gridIndex) + 0.5;
            ctx.moveTo(gridX, 0);
            ctx.lineTo(gridX, canvasHeight);
        }
        ctx.stroke();
        ctx.setDash([], 0);

        const hours = state.snapshot ? state.snapshot.hours : [];
        const scaleMax = computeScaleMaxSeconds(hours);
        const accent = parseCssColor(accentHex);
        ctx.setSourceRGBA(accent.r, accent.g, accent.b, 1);
        const barWidth = Math.round(BAR_WIDTH_PX * scale);
        const barRadius = Math.round(BAR_WIDTH_PX / 2 * scale);

        for (let hour = 0; hour < hours.length; hour++) {
            if (hours[hour] <= 0) continue;
            const barHeight = Math.max(barWidth, (hours[hour] / scaleMax) * canvasHeight);
            const centerX = ((hour + 0.5) / HOURS_PER_DAY) * canvasWidth;
            const barX = centerX - (barWidth / 2);
            const barY = canvasHeight - barHeight;

            ctx.newSubPath();
            ctx.arc(barX + barRadius, barY + barRadius, barRadius, Math.PI, 1.5 * Math.PI);
            ctx.arc(barX + barWidth - barRadius, barY + barRadius, barRadius, 1.5 * Math.PI, 2 * Math.PI);
            ctx.lineTo(barX + barWidth, canvasHeight);
            ctx.lineTo(barX, canvasHeight);
            ctx.closePath();
        }
        ctx.fill();
        ctx.$dispose();
    });

    function applyLayout(currentWidth, currentHeight) {
        // Skip until the container has real dimensions; otherwise scale and
        // plot extents collapse to NaN and Clutter allocates INT32_MIN.
        if (!currentWidth || !currentHeight) return;
        const scale = Math.min(currentWidth / REF_WIDTH, currentHeight / REF_HEIGHT);
        if (!isFinite(scale) || scale <= 0) return;
        state.geometry.scale = scale;

        const totalWidth = currentWidth;
        const mainWidth = Math.round(totalWidth * MAIN_PANEL_WIDTH_RATIO);
        leftPanel.set_width(mainWidth);
        rightPanel.set_width(totalWidth - mainWidth);

        const padTop = Math.round(PANEL_PADDING_TOP_PX * scale);
        const padBottom = Math.round(PANEL_PADDING_BOTTOM_PX * scale);
        const padLeft = Math.round(PANEL_PADDING_LEFT_PX * scale);
        const padRight = Math.round(PANEL_PADDING_RIGHT_PX * scale);
        leftPanel.style = `background-color: ${backgroundColor}; border-radius: ${borderRadius}px 0 0 ${borderRadius}px;`
            + `padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`;

        rightPanel.style = `background-color: ${card}; border-radius: 0 ${borderRadius}px ${borderRadius}px 0;`
            + `padding: ${padTop}px ${padLeft}px;`;

        headerBox.style = `margin-bottom: ${Math.round(HEADER_MARGIN_BOTTOM_PX * scale)}px; padding-right: ${Math.round(HEADER_PADDING_RIGHT_PX * scale)}px;`;
        totalTimeLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(HEADER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`;
        dateLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(DATE_LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${SECONDARY_TEXT_OPACITY};`;
        yAxisLabels.forEach(label => {
            label.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(AXIS_LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px; `
                + `font-weight: ${TYPOGRAPHY_WEIGHT.medium}; opacity: ${SECONDARY_TEXT_OPACITY};`;
        });
        xAxisLabels.forEach(label => {
            label.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(AXIS_LABEL_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px; `
                + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; opacity: ${SECONDARY_TEXT_OPACITY};`;
        });

        prevButton.style = `width: ${Math.round(NAV_BUTTON_SIZE_PX * scale)}px; height: ${Math.round(NAV_BUTTON_SIZE_PX * scale)}px;`
            + `border: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.border)};`
            + `border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px; background-color: transparent;`;
        nextButton.style = prevButton.style;

        const chartWrapWidth = mainWidth - padLeft - padRight;
        // Reserve only what the tallest header column actually occupies
        // (date label 14 + spacing 6 + nav buttons 26), so the plot top — and
        // therefore the max scale mark — rises to the prev/next button level.
        const chartWrapHeight = currentHeight - padTop - padBottom
            - Math.round((HEADER_RESERVED_HEIGHT_PX + HEADER_MARGIN_BOTTOM_PX) * scale);
        const plotWidth = Math.max(1, chartWrapWidth - Math.round(Y_AXIS_WIDTH_PX * scale));
        const axisBottomMargin = scale < 1 ? Math.round(AXIS_MARGIN_BOTTOM_PX * scale) : 0;
        const axisSpace = Math.round(X_AXIS_HEIGHT_PX * scale) + axisBottomMargin;
        const plotHeight = Math.max(1, chartWrapHeight - axisSpace);
        Object.assign(state.geometry, { plotWidth });

        chartCanvas.set_position(0, 0);
        chartCanvas.set_size(plotWidth, plotHeight);

        yAxisBox.set_position(plotWidth, 0);
        yAxisBox.set_size(Math.round(Y_AXIS_WIDTH_PX * scale), plotHeight);

        xAxisBox.set_position(0, plotHeight + Math.round(AXIS_LABEL_SPACING_PX * scale));
        xAxisBox.set_size(plotWidth, Math.round(X_AXIS_HEIGHT_PX * scale));
        xAxisBox.style = `margin-bottom: ${axisBottomMargin}px;`;

        appRowsBox.style = `spacing: ${Math.round(APP_ROWS_SPACING_PX * scale)}px;`;

        renderDynamic();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => applyLayout(w, h));
    refreshData();

    return container;
}
