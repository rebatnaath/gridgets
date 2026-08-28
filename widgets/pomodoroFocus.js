import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { SECONDARY_OPACITY, cssColorToRgba, resolveExplicitFontFamily, resolveTextOnAccentColor, resolveWidgetBackgroundColor, resolveWidgetForegroundColor } from '../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';
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
const CONTAINER_PADDING_V_PX = 16;
const CONTAINER_PADDING_H_PX = 20;
const GAUGE_SIZE_PX = 130;
const ARC_LINE_WIDTH_RATIO = 0.065;
const TIMER_FONT_SIZE_PX = 26;
const CAPTION_FONT_SIZE_PX = 9;
const MODE_FONT_SIZE_PX = 11;
const BUTTON_FONT_SIZE_PX = 12;
const COUNTER_FONT_SIZE_PX = 11;
const BORDER_ALPHA = 0.14;

export function createPomodoroFocusNode(config, width, height, xPosition, yPosition) {
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 0;
    const accentHex = config.globalAccentColor || '#3584e4';
    const textOnAccent = resolveTextOnAccentColor(accentHex);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);

    const timer = createPomodoroTimer(config, PHASE_CONFIG, () => {
        updateDisplay();
        refreshControlStyles();
    });
    const state = timer.state;

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: 'spacing: 14px;',
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
        drawCircularArc(ctx, canvasWidth, canvasWidth, progress, accentHex, ARC_LINE_WIDTH_RATIO);
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
        const px = (v) => Math.max(1, Math.round(v * scale));
        const isWork = state.phase === PHASE_WORK;
        const activeBg = cssColorToRgba(accentHex, 0.22);
        const inactiveText = `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        const activeText = `color: ${textColor};`;

        modeSelector.style = `background-color: ${textRgba(0.06)};`
            + `padding: ${px(3)}px; border-radius: ${px(10)}px;`;
        const modeButtonStyle = (isActive) => `${fontCss}font-size: ${px(MODE_FONT_SIZE_PX)}px;`
            + `padding: ${px(6)}px 0; border-radius: ${px(7)}px;`
            + `background-color: ${isActive ? activeBg : 'transparent'};`
            + `${isActive ? activeText : inactiveText}`;
        workBtn.style = modeButtonStyle(isWork);
        breakBtn.style = modeButtonStyle(!isWork);

        counterPrefixLabel.style = `${fontCss}font-size: ${px(COUNTER_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-right: ${px(4)}px;`;
        counterValueLabel.style = `${fontCss}font-size: ${px(COUNTER_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; margin-right: ${px(2)}px;`;
        counterTotalLabel.style = `${fontCss}font-size: ${px(COUNTER_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        startBtn.style = `${fontCss}font-size: ${px(BUTTON_FONT_SIZE_PX)}px;`
            + `padding: ${px(10)}px 0; border-radius: ${px(10)}px;`
            + `background-color: ${cssColorToRgba(accentHex, 1)};`
            + `color: ${textOnAccent};`;
        resetBtn.style = `${fontCss}font-size: ${px(BUTTON_FONT_SIZE_PX)}px;`
            + `padding: ${px(10)}px 0; border-radius: ${px(10)}px;`
            + `background-color: transparent;`
            + `border: 1px solid ${textRgba(BORDER_ALPHA)}; color: ${textColor}; opacity: 0.75;`;

        timerLabel.style = `${fontCss}font-size: ${px(TIMER_FONT_SIZE_PX)}px;`
            + `font-weight: 300; color: ${textColor};`;
        phaseCaption.style = `${fontCss}font-size: ${px(CAPTION_FONT_SIZE_PX)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

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
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = (v) => Math.max(1, Math.round(v * scale));

        container.style = `${fontCss}background-color: ${bgColor}; border-radius: ${borderRadius}px;`
            + `border: 1px solid ${textRgba(BORDER_ALPHA)};`;
        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px; spacing: ${px(14)}px;`;

        const gaugeSize = Math.min(currentHeight - px(CONTAINER_PADDING_V_PX) * 2, px(GAUGE_SIZE_PX));
        gaugeWrap.set_size(gaugeSize, gaugeSize);
        canvasActor.set_size(gaugeSize, gaugeSize);

        actionButtons.style = `spacing: ${px(8)}px; margin-top: ${px(6)}px;`;
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
