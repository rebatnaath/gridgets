import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba } from '../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
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
const BORDER_ALPHA = 0.14;

export function createPomodoroNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    let scale = Math.min(width, height) / BASE_CONTAINER_SIZE;
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let phaseFontSize = Math.max(1, Math.round(13 * scale));
    let timerFontSize = Math.max(1, Math.round(28 * scale));
    let dotSize = Math.max(1, Math.round(8 * scale));
    let dotRadius = Math.round(dotSize / 2);
    let playIconSize = Math.max(1, Math.round(24 * scale));
    let secIconSize = Math.max(1, Math.round(20 * scale));

    const timer = createPomodoroTimer(config, PHASE_CONFIG, () => updateDisplay());
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
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, accentHex, POMODORO_ARC_LINE_WIDTH_RATIO);
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
        style: `${fontCss}color: ${textColor}; font-size: ${phaseFontSize}px; opacity: 0.55; margin-bottom: 2px;`,
    });

    const timerLabel = new St.Label({
        text: formatSeconds(getPhaseDurationSeconds(PHASE_CONFIG, config, PHASE_WORK)),
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: 300;`,
    });

    const sessionDotsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(6 * scale)}px;`,
    });

    for (let i = 0; i < getSessionsBeforeLongBreak(config); i++) {
        const dot = new St.Widget({
            style: `background-color: ${textColor}; opacity: 0.2; width: ${dotSize}px; height: ${dotSize}px; border-radius: ${dotRadius}px; margin: 0px 3px;`,
        });
        sessionDotsBox.add_child(dot);
    }

    const controlsRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(8 * scale)}px;`,
    });

    const playPauseBtn = new St.Button({ reactive: true, can_focus: true, style: 'border-radius: 99px; margin: 0px 4px;' });
    const playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: playIconSize, style: `color: ${textColor};` });
    playPauseBtn.set_child(playPauseIcon);

    const resetBtn = new St.Button({ reactive: true, can_focus: true, style: 'border-radius: 99px; margin: 0px 4px;' });
    const resetIcon = new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: secIconSize, style: `color: ${textColor}; opacity: 0.7;` });
    resetBtn.set_child(resetIcon);

    const skipBtn = new St.Button({ reactive: true, can_focus: true, style: 'border-radius: 99px; margin: 0px 4px;' });
    const skipIcon = new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: secIconSize, style: `color: ${textColor}; opacity: 0.7;` });
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
        let child = sessionDotsBox.get_first_child();
        while (child) {
            const isCompleted = dotIndex < state.completedSessions;
            child.style = `background-color: ${isCompleted ? accentHex : textColor};`
                + `opacity: ${isCompleted ? '1.0' : '0.2'};`
                + `width: ${dotSize}px; height: ${dotSize}px; border-radius: ${dotRadius}px; margin: 0px 3px;`;
            child = child.get_next_sibling();
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

    const syncPlayPauseIcon = () => {
        playPauseIcon.set_icon_name(timer.state.isRunning
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic');
    };

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
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        phaseFontSize = Math.max(1, Math.round(13 * scale));
        timerFontSize = Math.max(1, Math.round(28 * scale));
        dotSize = Math.max(1, Math.round(8 * scale));
        dotRadius = Math.round(dotSize / 2);
        playIconSize = Math.max(1, Math.round(24 * scale));
        secIconSize = Math.max(1, Math.round(20 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        phaseLabel.style = `${fontCss}color: ${textColor}; font-size: ${phaseFontSize}px; opacity: 0.55; margin-bottom: 2px;`;
        timerLabel.style = `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: 300;`;
        sessionDotsBox.style = `margin-top: ${Math.round(6 * scale)}px;`;
        controlsRow.style = `margin-top: ${Math.round(8 * scale)}px;`;
        playPauseIcon.icon_size = playIconSize;
        resetIcon.icon_size = secIconSize;
        skipIcon.icon_size = secIconSize;
        updateSessionDots();
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.min(w, h) / BASE_CONTAINER_SIZE);
    });

    return container;
}
