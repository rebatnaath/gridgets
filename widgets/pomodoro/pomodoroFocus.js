import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveTextOnAccentColor, resolveWidgetColors, resolveChildCornerRadius, DEFAULT_CHILD_CORNER_RADIUS_PX, resolveAccentColor } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import {
    PHASE_WORK,
    PHASE_SHORT_BREAK,
    buildPomodoroPhaseConfig,
    getPhaseDurationSeconds,
    getSessionsBeforeLongBreak,
    formatSeconds,
    createPomodoroTimer,
} from './pomodoroShared.js';

const PHASE_CONFIG = buildPomodoroPhaseConfig('Work', 'Break');

const REF_WIDTH_PX = 360;
const REF_HEIGHT_PX = 180;
const CONTAINER_PADDING_V_PX = 6;
const CONTAINER_PADDING_H_PX = 20;
const GAUGE_SIZE_PX = 200;
const ARC_LINE_WIDTH_RATIO = 0.065;
const TIMER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.timer;
const CAPTION_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const MODE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const BUTTON_FONT_SIZE_PX = TYPOGRAPHY_SIZE.button;
const COUNTER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const MAIN_BOX_SPACING_PX = 14;

export function createPomodoroFocusNode(config, width, height, xPosition, yPosition) {
    const {
        subtleBackground,
        highlightBackground,
        contentColor: textColor,
    } = resolveWidgetColors(config);
    const accentHex = resolveAccentColor(config);
    const textOnAccent = resolveTextOnAccentColor(accentHex);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));

    const timer = createPomodoroTimer(config, PHASE_CONFIG, () => {
        updateDisplay();
        refreshControlStyles();
    });
    const state = timer.state;

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${MAIN_BOX_SPACING_PX}px;`,
    });
    container.add_child(mainBox);

    const gaugeWrap = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const canvasActor = new St.DrawingArea();
    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth] = area.get_surface_size();
        const phaseDurationSeconds = getPhaseDurationSeconds(PHASE_CONFIG, config, state.phase);
        const progress = 1 - (state.secondsRemaining / phaseDurationSeconds);
        drawCircularArc(ctx, canvasWidth, canvasWidth, progress, accentHex, ARC_LINE_WIDTH_RATIO, highlightBackground, 10);
        ctx.$dispose();
    });
    const gaugeOverlay = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const timerLabel = new St.Label({
        text: formatSeconds(state.secondsRemaining),
        x_align: Clutter.ActorAlign.CENTER,
    });
    const phaseCaption = new St.Label({
        text: PHASE_CONFIG[state.phase].label,
        x_align: Clutter.ActorAlign.CENTER,
    });
    gaugeOverlay.add_child(timerLabel);
    gaugeOverlay.add_child(phaseCaption);
    gaugeWrap.add_child(canvasActor);
    gaugeWrap.add_child(gaugeOverlay);
    mainBox.add_child(gaugeWrap);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(controlsColumn);

    const modeSelector = new St.BoxLayout({
        x_align: Clutter.ActorAlign.FILL,
    });
    const buildModeButton = (phase) => {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
            child: new St.Label({
                text: PHASE_CONFIG[phase].label,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });
        button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
                return Clutter.EVENT_PROPAGATE;
            timer.switchToPhase(phase);
            return Clutter.EVENT_STOP;
        });
        attachButtonFeedback(button);
        modeSelector.add_child(button);
        return button;
    };
    const workBtn = buildModeButton(PHASE_WORK);
    const breakBtn = buildModeButton(PHASE_SHORT_BREAK);
    controlsColumn.add_child(modeSelector);

    const counterRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
    });
    const counterPrefixLabel = new St.Label({ text: 'Completed:' });
    const counterValueLabel = new St.Label({ text: '0' });
    const counterTotalLabel = new St.Label({ text: `/ ${getSessionsBeforeLongBreak(config)}` });
    counterRow.add_child(counterPrefixLabel);
    counterRow.add_child(counterValueLabel);
    counterRow.add_child(counterTotalLabel);
    controlsColumn.add_child(counterRow);

    const counterSpacer = new St.Widget({ x_expand: true, y_expand: true });
    controlsColumn.add_child(counterSpacer);

    const actionButtons = new St.BoxLayout({
        x_align: Clutter.ActorAlign.FILL,
    });
    const startBtn = new St.Button({
        reactive: true,
        can_focus: true,
        x_expand: true,
        child: new St.Label({
            text: 'Start',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }),
    });
    const resetBtn = new St.Button({
        reactive: true,
        can_focus: true,
        x_expand: true,
        child: new St.Label({
            text: 'Reset',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }),
    });
    actionButtons.add_child(startBtn);
    actionButtons.add_child(resetBtn);
    controlsColumn.add_child(actionButtons);

    attachButtonFeedback(startBtn);
    attachButtonFeedback(resetBtn);

    const updateDisplay = () => {
        timerLabel.set_text(formatSeconds(state.secondsRemaining));
        phaseCaption.set_text(PHASE_CONFIG[state.phase].label);
        counterValueLabel.set_text(String(state.completedSessions));
        counterTotalLabel.set_text(`/ ${getSessionsBeforeLongBreak(config)}`);
        canvasActor.queue_repaint();
    };

    const refreshControlStyles = () => {
        const px = value => scaleFontSize(value, scale);
        const fontPx = (value, minimum) => scaleFontSize(value, scale, minimum);
        const isWork = state.phase === PHASE_WORK;
        const inactiveText = `color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;
        const activeText = `color: ${textColor};`;

        modeSelector.style = `background-color: ${subtleBackground};`
            + `padding: ${px(3)}px; border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px;`;
        const modeButtonStyle = isActive => `${fontCss}font-size: ${fontPx(MODE_FONT_SIZE_PX, MIN_FONT_SIZE.button)}px; font-weight: ${isActive ? TYPOGRAPHY_WEIGHT.bold : TYPOGRAPHY_WEIGHT.medium};`
            + `padding: ${px(4)}px 0; min-height: 28px; border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px;`
            + `background-color: ${isActive ? highlightBackground : 'transparent'};`
            + `${isActive ? activeText : inactiveText}`;
        workBtn.style = modeButtonStyle(isWork);
        breakBtn.style = modeButtonStyle(!isWork);

        counterPrefixLabel.style = `${fontCss}font-size: ${fontPx(COUNTER_FONT_SIZE_PX, MIN_FONT_SIZE.label)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary}; margin-right: ${px(4)}px;`;
        counterValueLabel.style = `${fontCss}font-size: ${fontPx(COUNTER_FONT_SIZE_PX, MIN_FONT_SIZE.label)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; margin-right: ${px(2)}px;`;
        counterTotalLabel.style = `${fontCss}font-size: ${fontPx(COUNTER_FONT_SIZE_PX, MIN_FONT_SIZE.label)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;

        startBtn.style = `${fontCss}font-size: ${fontPx(BUTTON_FONT_SIZE_PX, MIN_FONT_SIZE.button)}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`
            + `padding: ${px(4)}px 0; min-height: 28px; border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px;`
            + `margin: 0 ${px(2)}px;`
            + `background-color: ${accentHex};`
            + `color: ${textOnAccent};`;
        resetBtn.style = `${fontCss}font-size: ${fontPx(BUTTON_FONT_SIZE_PX, MIN_FONT_SIZE.button)}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`
            + `padding: ${px(4)}px 0; min-height: 28px; border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px;`
            + `margin: 0 ${px(2)}px;`
            + `background-color: ${subtleBackground};`
            + `color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;

        timerLabel.style = `${fontCss}font-size: ${fontPx(TIMER_FONT_SIZE_PX, MIN_FONT_SIZE.primary)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor};`;
        phaseCaption.style = `${fontCss}font-size: ${fontPx(CAPTION_FONT_SIZE_PX, MIN_FONT_SIZE.metadata)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`;

        startBtn.child.text = state.isRunning ? 'Pause' : 'Start';
    };

    startBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) timer.stopTimer();
        else timer.startTimer();
        updateDisplay();
        refreshControlStyles();
        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        timer.resetCurrentPhase();
        updateDisplay();
        refreshControlStyles();
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = clampWidgetScale(Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX));
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px; spacing: ${px(MAIN_BOX_SPACING_PX)}px;`;

        const gaugeSize = Math.min(currentHeight - px(CONTAINER_PADDING_V_PX) * 2, px(GAUGE_SIZE_PX));
        gaugeWrap.set_size(gaugeSize, gaugeSize);
        canvasActor.set_size(gaugeSize, gaugeSize);

        actionButtons.style = `spacing: ${px(4)}px; margin-top: ${px(6)}px; padding: 0 ${px(4)}px;`;
        counterRow.style = `margin-top: ${px(10)}px;`;

        updateDisplay();
        refreshControlStyles();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    return container;
}
