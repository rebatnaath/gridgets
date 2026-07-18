/**
 * ============================================================================
 * POMODORO TIMER WIDGET 
 * 
 * This module provides a customizable Pomodoro timer for productivity tracking.
 * It manages work and break intervals, renders a circular progress arc, and
 * updates session completion dots dynamically.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    drawCircularArc, createWidgetContainer, connectTimerCleanup
} from './widgetUIUtils.js';

const WORK_DURATION_SECONDS = 25 * 60;
const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const SESSIONS_BEFORE_LONG_BREAK = 4;
const TICK_INTERVAL_MS = 1000;

const DEFAULT_WORK_COLOR = '#e74c3c';
const DEFAULT_BREAK_COLOR = '#2ecc71';
const DEFAULT_LONG_BREAK_COLOR = '#3498db';

const PHASE_WORK = 'work';
const PHASE_SHORT_BREAK = 'short_break';
const PHASE_LONG_BREAK = 'long_break';

const POMODORO_ARC_LINE_WIDTH_RATIO = 0.06;

function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getPhaseLabel(phase) {
    if (phase === PHASE_WORK) return 'Focus';
    if (phase === PHASE_SHORT_BREAK) return 'Short Break';
    return 'Long Break';
}

function getPhaseDuration(phase) {
    if (phase === PHASE_WORK) return WORK_DURATION_SECONDS;
    if (phase === PHASE_SHORT_BREAK) return SHORT_BREAK_SECONDS;
    return LONG_BREAK_SECONDS;
}

function getPhaseColor(phase) {
    if (phase === PHASE_WORK) return DEFAULT_WORK_COLOR;
    if (phase === PHASE_SHORT_BREAK) return DEFAULT_BREAK_COLOR;
    return DEFAULT_LONG_BREAK_COLOR;
}

//  Widget construction 

export function createPomodoroNode(config, width, height, xPosition, yPosition) {
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    // Timer state
    const state = {
        phase: PHASE_WORK,
        secondsRemaining: WORK_DURATION_SECONDS,
        isRunning: false,
        completedSessions: 0,
        timerId: null,
    };

    // Progress arc canvas
    const arcSize = Math.min(width, height) - 24;
    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        const totalDuration = getPhaseDuration(state.phase);
        const progress = 1 - (state.secondsRemaining / totalDuration);
        const phaseColor = getPhaseColor(state.phase);
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, phaseColor, POMODORO_ARC_LINE_WIDTH_RATIO);
    });
    canvasActor.queue_repaint();

    container.add_child(canvasActor);

    // Center labels overlay
    const labelsBox = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const phaseLabel = new St.Label({
        text: getPhaseLabel(state.phase),
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 14px; font-weight: bold; opacity: 0.8; margin-bottom: 4px;`,
    });

    const timerLabel = new St.Label({
        text: formatSeconds(state.secondsRemaining),
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 28px; font-weight: bold;`,
    });

    const sessionDotsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: 'margin-top: 8px;',
    });

    for (let i = 0; i < SESSIONS_BEFORE_LONG_BREAK; i++) {
        const dot = new St.Widget({
            style: `background-color: ${textColor}; opacity: 0.2; width: 8px; height: 8px; border-radius: 4px; margin: 0px 3px;`,
        });
        sessionDotsBox.add_child(dot);
    }

    const controlsRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: 'margin-top: 12px;',
    });

    const playPauseBtn = new St.Button({
        reactive: true,
        can_focus: true,
        style: 'border-radius: 99px; margin: 0px 6px;',
    });
    const playPauseIcon = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        icon_size: 24,
        style: `color: ${textColor};`,
    });
    playPauseBtn.set_child(playPauseIcon);

    const resetBtn = new St.Button({
        reactive: true,
        can_focus: true,
        style: 'border-radius: 99px; margin: 0px 6px;',
    });
    const resetIcon = new St.Icon({
        icon_name: 'view-refresh-symbolic',
        icon_size: 20,
        style: `color: ${textColor}; opacity: 0.7;`,
    });
    resetBtn.set_child(resetIcon);

    const skipBtn = new St.Button({
        reactive: true,
        can_focus: true,
        style: 'border-radius: 99px; margin: 0px 6px;',
    });
    const skipIcon = new St.Icon({
        icon_name: 'media-skip-forward-symbolic',
        icon_size: 20,
        style: `color: ${textColor}; opacity: 0.7;`,
    });
    skipBtn.set_child(skipIcon);

    controlsRow.add_child(resetBtn);
    controlsRow.add_child(playPauseBtn);
    controlsRow.add_child(skipBtn);

    labelsBox.add_child(phaseLabel);
    labelsBox.add_child(timerLabel);
    labelsBox.add_child(sessionDotsBox);
    labelsBox.add_child(controlsRow);

    container.add_child(labelsBox);

    //  State management 
    const updateSessionDots = () => {
        let dotIndex = 0;
        let child = sessionDotsBox.get_first_child();
        while (child) {
            const isCompleted = dotIndex < state.completedSessions;
            child.style = `background-color: ${isCompleted ? getPhaseColor(PHASE_WORK) : textColor}; opacity: ${isCompleted ? '1.0' : '0.2'}; width: 8px; height: 8px; border-radius: 4px; margin: 0px 3px;`;
            child = child.get_next_sibling();
            dotIndex++;
        }
    };

    const updateDisplay = () => {
        timerLabel.set_text(formatSeconds(state.secondsRemaining));
        phaseLabel.set_text(getPhaseLabel(state.phase));
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
        state.secondsRemaining = getPhaseDuration(state.phase);
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

    //  Button handlers 
    playPauseBtn.connect('button-press-event', (actor, event) => {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        if (container.editMode && container.editMode !== 0) return Clutter.EVENT_PROPAGATE;

        if (state.isRunning) stopTimer();
        else startTimer();

        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (actor, event) => {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        if (container.editMode && container.editMode !== 0) return Clutter.EVENT_PROPAGATE;

        stopTimer();
        state.secondsRemaining = getPhaseDuration(state.phase);
        updateDisplay();

        return Clutter.EVENT_STOP;
    });

    skipBtn.connect('button-press-event', (actor, event) => {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        if (container.editMode && container.editMode !== 0) return Clutter.EVENT_PROPAGATE;

        stopTimer();
        advanceToNextPhase();

        return Clutter.EVENT_STOP;
    });

    //  Cleanup 
    connectTimerCleanup(container, state);

    updateDisplay();
    return container;
}
