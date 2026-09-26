import GLib from 'gi://GLib';

const POMODORO_DEFAULTS = Object.freeze({
    WORK_MINUTES: 25,
    SHORT_BREAK_MINUTES: 5,
    LONG_BREAK_MINUTES: 15,
    SESSIONS_BEFORE_LONG_BREAK: 4,
});

const POMODORO_TICK_INTERVAL_MS = 1000;
const SECONDS_PER_MINUTE = 60;
const MICROSECONDS_PER_SECOND = 1000000;

export const PHASE_WORK = 'work';
export const PHASE_SHORT_BREAK = 'short_break';
const PHASE_LONG_BREAK = 'long_break';

export function buildPomodoroPhaseConfig(workLabel, shortBreakLabel) {
    return Object.freeze({
        [PHASE_WORK]: {
            label: workLabel,
            minutesField: 'workMinutes',
            defaultMinutes: POMODORO_DEFAULTS.WORK_MINUTES,
        },
        [PHASE_SHORT_BREAK]: {
            label: shortBreakLabel,
            minutesField: 'shortBreakMinutes',
            defaultMinutes: POMODORO_DEFAULTS.SHORT_BREAK_MINUTES,
        },
        [PHASE_LONG_BREAK]: {
            label: 'Long Break',
            minutesField: 'longBreakMinutes',
            defaultMinutes: POMODORO_DEFAULTS.LONG_BREAK_MINUTES,
        },
    });
}

export function getPhaseDurationSeconds(phaseConfig, config, phase) {
    const phaseEntry = phaseConfig[phase];
    const rawValue = config ? config[phaseEntry.minutesField] : undefined;
    const minutes = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : phaseEntry.defaultMinutes;
    return Math.round(minutes * SECONDS_PER_MINUTE);
}

export function getSessionsBeforeLongBreak(config) {
    const rawValue = config ? config.sessionsBeforeLongBreak : undefined;
    return Number.isFinite(rawValue) && rawValue > 0
        ? Math.round(rawValue)
        : POMODORO_DEFAULTS.SESSIONS_BEFORE_LONG_BREAK;
}

export function formatSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function createPomodoroTimer(config, phaseConfig, onChange) {
    const state = {
        phase: PHASE_WORK,
        secondsRemaining: getPhaseDurationSeconds(phaseConfig, config, PHASE_WORK),
        isRunning: false,
        completedSessions: 0,
        timerId: null,
        deadlineMicro: null,
    };

    // Remaining time is measured from a deadline rather than decremented per tick, so
    // a stalled main loop costs no accuracy. Real time is used because it keeps
    // advancing across suspend, which is when a phase should count as elapsed; the
    // result is clamped to the phase length so a clock correction cannot stretch it.
    const remainingSeconds = () => {
        if (state.deadlineMicro === null)
            return state.secondsRemaining;
        const phaseDuration = getPhaseDurationSeconds(phaseConfig, config, state.phase);
        const remaining = Math.ceil((state.deadlineMicro - GLib.get_real_time()) / MICROSECONDS_PER_SECOND);
        return Math.max(0, Math.min(phaseDuration, remaining));
    };

    // Re-arms the deadline whenever the phase or run state changes, including a
    // phase switch made while the timer is running.
    const armDeadline = () => {
        state.deadlineMicro = state.isRunning
            ? GLib.get_real_time() + (state.secondsRemaining * MICROSECONDS_PER_SECOND)
            : null;
    };

    const stopTimer = () => {
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
        if (state.isRunning)
            state.secondsRemaining = remainingSeconds();
        state.isRunning = false;
        state.deadlineMicro = null;
    };

    const advanceToNextPhase = () => {
        if (state.phase === PHASE_WORK) {
            state.completedSessions++;
            if (state.completedSessions >= getSessionsBeforeLongBreak(config)) {
                state.phase = PHASE_LONG_BREAK;
                state.completedSessions = 0;
            } else {
                state.phase = PHASE_SHORT_BREAK;
            }
        } else {
            state.phase = PHASE_WORK;
        }
        state.secondsRemaining = getPhaseDurationSeconds(phaseConfig, config, state.phase);
        armDeadline();
        onChange();
    };

    const startTimer = () => {
        if (state.isRunning || state.secondsRemaining <= 0) return;
        state.isRunning = true;
        armDeadline();
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POMODORO_TICK_INTERVAL_MS, () => {
            state.secondsRemaining = remainingSeconds();
            if (state.secondsRemaining <= 0) {
                stopTimer();
                advanceToNextPhase();
                return GLib.SOURCE_REMOVE;
            }
            onChange();
            return GLib.SOURCE_CONTINUE;
        });
    };

    const resetCurrentPhase = () => {
        stopTimer();
        state.secondsRemaining = getPhaseDurationSeconds(phaseConfig, config, state.phase);
        armDeadline();
        onChange();
    };

    const switchToPhase = (phase) => {
        stopTimer();
        state.phase = phase;
        state.secondsRemaining = getPhaseDurationSeconds(phaseConfig, config, phase);
        armDeadline();
        onChange();
    };

    return { state, startTimer, stopTimer, resetCurrentPhase, advanceToNextPhase, switchToPhase };
}
