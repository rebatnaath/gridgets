import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetColors, resolveAccentColor } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, ICON_OPACITY_SECONDARY, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import {
    PHASE_WORK,
    buildPomodoroPhaseConfig,
    getPhaseDurationSeconds,
    getSessionsBeforeLongBreak,
    formatSeconds,
    createPomodoroTimer,
} from './pomodoroShared.js';

const PHASE_CONFIG = buildPomodoroPhaseConfig('Focus', 'Short Break');

const POMODORO_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 220;
const BASE_ARC_MARGIN = 24;
const BASE_ARC_MIN_SIZE = 80;
const CONTROL_BUTTON_RADIUS_PX = 99;
const CONTROL_BUTTON_MIN_SIZE_PX = 32;
const CONTROL_BUTTON_PADDING_PX = 12;
const CONTROL_BUTTON_MARGIN_PX = 0;

export function createPomodoroNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const {
        highlightBackground,
        contentColor: textColor,
    } = resolveWidgetColors(config);
    const accentHex = resolveAccentColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = clampWidgetScale(Math.min(width, height) / BASE_CONTAINER_SIZE);
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let phaseFontSize = scaleFontSize(TYPOGRAPHY_SIZE.body, scale, MIN_FONT_SIZE.label);
    let timerFontSize = scaleFontSize(TYPOGRAPHY_SIZE.timer, scale, MIN_FONT_SIZE.primary);
    let dotSize = Math.max(1, Math.round(8 * scale));
    let dotRadius = Math.round(dotSize / 2);
    let playIconSize = Math.max(1, Math.round(24 * scale));
    let secIconSize = Math.max(1, Math.round(20 * scale));

    const timer = createPomodoroTimer(config, PHASE_CONFIG, () => {
        updateDisplay();
        syncPlayPauseIcon();
    });
    const { state } = timer;

    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        const phaseDurationSeconds = getPhaseDurationSeconds(PHASE_CONFIG, config, state.phase);
        const progress = 1 - (state.secondsRemaining / phaseDurationSeconds);
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, accentHex, POMODORO_ARC_LINE_WIDTH_RATIO, highlightBackground);
        ctx.$dispose();
    });
    canvasActor.queue_repaint();
    container.add_child(canvasActor);

    const labelsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const phaseLabel = new St.Label({
        text: PHASE_CONFIG[PHASE_WORK].label,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${phaseFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; opacity: ${TEXT_OPACITY.secondary}; margin-bottom: ${Math.max(1, Math.round(2 * scale))}px;`,
    });

    const timerLabel = new St.Label({
        text: formatSeconds(getPhaseDurationSeconds(PHASE_CONFIG, config, PHASE_WORK)),
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
    });

    const sessionDotsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(6 * scale)}px;`,
    });

    for (let i = 0; i < getSessionsBeforeLongBreak(config); i++) {
        const dot = new St.Widget({
            style: `background-color: ${textColor}; width: ${dotSize}px; height: ${dotSize}px; border-radius: ${dotRadius}px; margin: 0px 3px;`,
        });
        sessionDotsBox.add_child(dot);
    }

        // Single source of truth for the three control buttons, so the build-time
    // and resize paths cannot drift apart.
    const controlButtonStyle = iconSize => {
        const size = Math.max(CONTROL_BUTTON_MIN_SIZE_PX, iconSize + CONTROL_BUTTON_PADDING_PX);
        return `border-radius: ${CONTROL_BUTTON_RADIUS_PX}px; margin: 0px ${CONTROL_BUTTON_MARGIN_PX}px; `
            + `width: ${size}px; height: ${size}px;`;
    };

    const controlsRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(8 * scale)}px; spacing: 1px;`,
    });

    const playPauseBtn = new St.Button({ reactive: true, can_focus: true, style: controlButtonStyle(playIconSize) });
    const playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: playIconSize, style: `color: ${textColor};` });
    playPauseBtn.set_child(playPauseIcon);

    const resetBtn = new St.Button({ reactive: true, can_focus: true, style: controlButtonStyle(secIconSize) });
    const resetIcon = new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: secIconSize, style: `color: ${textColor}; opacity: ${ICON_OPACITY_SECONDARY};` });
    resetBtn.set_child(resetIcon);

    const skipBtn = new St.Button({ reactive: true, can_focus: true, style: controlButtonStyle(secIconSize) });
    const skipIcon = new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: secIconSize, style: `color: ${textColor}; opacity: ${ICON_OPACITY_SECONDARY};` });
    skipBtn.set_child(skipIcon);

    controlsRow.add_child(resetBtn);
    controlsRow.add_child(playPauseBtn);
    controlsRow.add_child(skipBtn);

    attachButtonFeedback(playPauseBtn);
    attachButtonFeedback(resetBtn);
    attachButtonFeedback(skipBtn);

    labelsBox.add_child(phaseLabel);
    labelsBox.add_child(timerLabel);
    labelsBox.add_child(sessionDotsBox);
    labelsBox.add_child(controlsRow);
    container.add_child(labelsBox);

    const updateSessionDots = () => {
        let dotIndex = 0;
        let sessionDot = sessionDotsBox.get_first_child();
        while (sessionDot) {
            const isCompleted = dotIndex < state.completedSessions;
            sessionDot.style = `background-color: ${isCompleted ? accentHex : textColor};`
                + `opacity: ${isCompleted ? TEXT_OPACITY.primary : TEXT_OPACITY.disabled};`
                + `width: ${dotSize}px; height: ${dotSize}px; border-radius: ${dotRadius}px; margin: 0px 3px;`;
            sessionDot = sessionDot.get_next_sibling();
            dotIndex++;
        }
    };

    const updateDisplay = () => {
        const activeConfig = PHASE_CONFIG[state.phase];
        timerLabel.set_text(formatSeconds(state.secondsRemaining));
        phaseLabel.set_text(activeConfig.label);
        canvasActor.queue_repaint();
        updateSessionDots();
    };

    function syncPlayPauseIcon() {
        playPauseIcon.set_icon_name(timer.state.isRunning
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic');
    }

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) timer.stopTimer();
        else timer.startTimer();
        syncPlayPauseIcon();
        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        timer.resetCurrentPhase();
        syncPlayPauseIcon();
        return Clutter.EVENT_STOP;
    });

    skipBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        timer.advanceToNextPhase();
        syncPlayPauseIcon();
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);
    updateDisplay();

    function applyScale(newScale) {
        scale = clampWidgetScale(newScale);
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        phaseFontSize = scaleFontSize(TYPOGRAPHY_SIZE.body, scale, MIN_FONT_SIZE.label);
        timerFontSize = scaleFontSize(TYPOGRAPHY_SIZE.timer, scale, MIN_FONT_SIZE.primary);
        dotSize = Math.max(1, Math.round(8 * scale));
        dotRadius = Math.round(dotSize / 2);
        playIconSize = Math.max(1, Math.round(24 * scale));
        secIconSize = Math.max(1, Math.round(20 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        phaseLabel.style = `${fontCss}color: ${textColor}; font-size: ${phaseFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; opacity: ${TEXT_OPACITY.secondary}; margin-bottom: ${Math.max(1, Math.round(2 * scale))}px;`;
        timerLabel.style = `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`;
        sessionDotsBox.style = `margin-top: ${Math.round(6 * scale)}px;`;
        controlsRow.style = `margin-top: ${Math.round(8 * scale)}px;`;
        playPauseBtn.style = controlButtonStyle(playIconSize);
        resetBtn.style = controlButtonStyle(secIconSize);
        skipBtn.style = controlButtonStyle(secIconSize);
        playPauseIcon.icon_size = playIconSize;
        resetIcon.icon_size = secIconSize;
        skipIcon.icon_size = secIconSize;
        updateSessionDots();
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (scale) => {
        applyScale(scale);
    });

    return container;
}
