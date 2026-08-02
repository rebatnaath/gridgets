import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup } from '../utils/widgetUIUtils.js';

/** Timer phase durations in seconds */
const WORK_DURATION_SECONDS = 25 * 60;
const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const SESSIONS_BEFORE_LONG_BREAK = 4;
const TICK_INTERVAL_MS = 1000;
const SECONDS_PER_MINUTE = 60;

/** Phase identifier constants */
const PHASE_WORK = 'work';
const PHASE_SHORT_BREAK = 'short_break';
const PHASE_LONG_BREAK = 'long_break';

/** Phase Configuration Lookup Table (DRY) */
const PHASE_CONFIG = Object.freeze({
    [PHASE_WORK]: {
        label: 'Focus',
        duration: WORK_DURATION_SECONDS,
        color: '#e74c3c',
    },
    [PHASE_SHORT_BREAK]: {
        label: 'Short Break',
        duration: SHORT_BREAK_SECONDS,
        color: '#2ecc71',
    },
    [PHASE_LONG_BREAK]: {
        label: 'Long Break',
        duration: LONG_BREAK_SECONDS,
        color: '#3498db',
    },
});

/** Arc and layout metrics */
const POMODORO_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 220;
const BASE_ARC_MARGIN = 24;
const BASE_ARC_MIN_SIZE = 80;

/** Mouse button constants */
const BUTTON_PRIMARY = 1;

/** Formats total seconds into MM:SS display format. */
function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** Creates a Pomodoro timer widget node. */
export function createPomodoroNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const state = {
        phase: PHASE_WORK,
        secondsRemaining: WORK_DURATION_SECONDS,
        isRunning: false,
        completedSessions: 0,
        timerId: null,
    };

    const scale = Math.max(0.5, Math.min(width, height) / BASE_CONTAINER_SIZE);
    const arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    const arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    const phaseFontSize = Math.max(10, Math.round(14 * scale));
    const timerFontSize = Math.max(16, Math.round(28 * scale));
    const dotSize = Math.max(5, Math.round(8 * scale));
    const dotRadius = Math.round(dotSize / 2);
    const playIconSize = Math.max(16, Math.round(24 * scale));
    const secIconSize = Math.max(14, Math.round(20 * scale));

    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        const activeConfig = PHASE_CONFIG[state.phase];
        const progress = 1 - (state.secondsRemaining / activeConfig.duration);
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, activeConfig.color, POMODORO_ARC_LINE_WIDTH_RATIO, textColor);
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
        text: PHASE_CONFIG[state.phase].label,
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${phaseFontSize}px; font-weight: bold; opacity: 0.8; margin-bottom: 2px;`,
    });

    const timerLabel = new St.Label({
        text: formatSeconds(state.secondsRemaining),
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${timerFontSize}px; font-weight: bold;`,
    });

    const sessionDotsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(6 * scale)}px;`,
    });

    for (let i = 0; i < SESSIONS_BEFORE_LONG_BREAK; i++) {
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

    labelsBox.add_child(phaseLabel);
    labelsBox.add_child(timerLabel);
    labelsBox.add_child(sessionDotsBox);
    labelsBox.add_child(controlsRow);
    container.add_child(labelsBox);

    const updateSessionDots = () => {
        let dotIndex = 0;
        let child = sessionDotsBox.get_first_child();
        const activeColor = PHASE_CONFIG[PHASE_WORK].color;
        while (child) {
            const isCompleted = dotIndex < state.completedSessions;
            child.style = `background-color: ${isCompleted ? activeColor : textColor}; opacity: ${isCompleted ? '1.0' : '0.2'}; width: ${dotSize}px; height: ${dotSize}px; border-radius: ${dotRadius}px; margin: 0px 3px;`;
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

    const advanceToNextPhase = () => {
        if (state.phase === PHASE_WORK) {
            state.completedSessions++;
            if (state.completedSessions >= SESSIONS_BEFORE_LONG_BREAK) {
                state.phase = PHASE_LONG_BREAK;
                state.completedSessions = 0;
            } else {
                state.phase = PHASE_SHORT_BREAK;
            }
        } else {
            state.phase = PHASE_WORK;
        }
        state.secondsRemaining = PHASE_CONFIG[state.phase].duration;
        updateDisplay();
    };

    const stopTimer = () => {
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
        state.isRunning = false;
        playPauseIcon.set_icon_name('media-playback-start-symbolic');
    };

    const startTimer = () => {
        if (state.isRunning) return;
        state.isRunning = true;
        playPauseIcon.set_icon_name('media-playback-pause-symbolic');

        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
            state.secondsRemaining--;
            if (state.secondsRemaining <= 0) {
                stopTimer();
                advanceToNextPhase();
                return GLib.SOURCE_REMOVE;
            }
            updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    };

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) stopTimer();
        else startTimer();
        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        stopTimer();
        state.secondsRemaining = PHASE_CONFIG[state.phase].duration;
        updateDisplay();
        return Clutter.EVENT_STOP;
    });

    skipBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        stopTimer();
        advanceToNextPhase();
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);
    updateDisplay();

    return container;
}
