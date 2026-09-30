import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetColors, resolveAccentColor } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, registerWidgetCleanup, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, ICON_OPACITY_SECONDARY, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
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
const BASE_DOT_SIZE = 8;
const BASE_PLAY_ICON_SIZE = 24;
const BASE_SEC_ICON_SIZE = 20;
const BASE_PHASE_MARGIN_PX = 2;
const BASE_DOTS_MARGIN_PX = 6;
const BASE_CONTROLS_MARGIN_PX = 8;
const DOT_HORIZONTAL_MARGIN_PX = 3;
const CONTROLS_SPACING_PX = 1;
const CONTROL_BUTTON_RADIUS_PX = 99;
const CONTROL_BUTTON_MIN_SIZE_PX = 32;
const CONTROL_BUTTON_PADDING_PX = 12;
const CONTROL_BUTTON_MARGIN_PX = 0;

function computeScaleMetrics(boxSize, rawScale) {
    const scale = clampWidgetScale(rawScale);
    const arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    const dotSize = scaleFontSize(BASE_DOT_SIZE, scale);
    return {
        scale,
        arcMargin,
        arcSize: Math.max(BASE_ARC_MIN_SIZE, boxSize - arcMargin),
        phaseFontSize: scaleFontSize(TYPOGRAPHY_SIZE.body, scale, MIN_FONT_SIZE.label),
        timerFontSize: scaleFontSize(TYPOGRAPHY_SIZE.timer, scale, MIN_FONT_SIZE.primary),
        dotSize,
        dotRadius: Math.round(dotSize / 2),
        playIconSize: scaleFontSize(BASE_PLAY_ICON_SIZE, scale),
        secIconSize: scaleFontSize(BASE_SEC_ICON_SIZE, scale),
    };
}

export function createPomodoroNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const {
        highlightBackground,
        contentColor: textColor,
    } = resolveWidgetColors(config);
    const accentHex = resolveAccentColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const initialBox = Math.min(width, height);
    let {
        scale, arcMargin, arcSize, phaseFontSize, timerFontSize,
        dotSize, dotRadius, playIconSize, secIconSize,
    } = computeScaleMetrics(initialBox, initialBox / BASE_CONTAINER_SIZE);

    const phaseLabelStyle = () => `${fontCss}color: ${textColor}; font-size: ${phaseFontSize}px;`
        + ` font-weight: ${TYPOGRAPHY_WEIGHT.bold}; opacity: ${TEXT_OPACITY.secondary};`
        + ` margin-bottom: ${scaleFontSize(BASE_PHASE_MARGIN_PX, scale)}px;`;

    const timerLabelStyle = () => `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px;`
        + ` font-weight: ${TYPOGRAPHY_WEIGHT.bold};`;

    const dotStyle = (background, opacity) => `background-color: ${background}; opacity: ${opacity};`
        + ` width: ${dotSize}px; height: ${dotSize}px;`
        + ` border-radius: ${dotRadius}px; margin: 0px ${DOT_HORIZONTAL_MARGIN_PX}px;`;

    const timer = createPomodoroTimer(config, PHASE_CONFIG, () => {
        updateDisplay();
        syncPlayPauseIcon();
    });
    const { state } = timer;

    registerWidgetCleanup(container, () => timer.stopTimer());

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
        style: phaseLabelStyle(),
    });

    const timerLabel = new St.Label({
        text: formatSeconds(getPhaseDurationSeconds(PHASE_CONFIG, config, PHASE_WORK)),
        x_align: Clutter.ActorAlign.CENTER,
        style: timerLabelStyle(),
    });

    const sessionDotsBox = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(BASE_DOTS_MARGIN_PX * scale)}px;`,
    });

    for (let i = 0; i < getSessionsBeforeLongBreak(config); i++) {
        const dot = new St.Widget({
            style: dotStyle(textColor, TEXT_OPACITY.primary),
        });
        sessionDotsBox.add_child(dot);
    }

    const controlButtonStyle = iconSize => {
        const size = Math.max(CONTROL_BUTTON_MIN_SIZE_PX, iconSize + CONTROL_BUTTON_PADDING_PX);
        return `border-radius: ${CONTROL_BUTTON_RADIUS_PX}px; margin: 0px ${CONTROL_BUTTON_MARGIN_PX}px; `
            + `width: ${size}px; height: ${size}px;`;
    };

    const controlsRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(BASE_CONTROLS_MARGIN_PX * scale)}px; spacing: ${CONTROLS_SPACING_PX}px;`,
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
            sessionDot.style = dotStyle(
                isCompleted ? accentHex : textColor,
                isCompleted ? TEXT_OPACITY.primary : TEXT_OPACITY.disabled);
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

    const onControlPress = (onPress) => {
        return (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY || container.actionOverlay)
                return Clutter.EVENT_PROPAGATE;
            onPress();
            syncPlayPauseIcon();
            return Clutter.EVENT_STOP;
        };
    };

    playPauseBtn.connect('button-press-event', onControlPress(() => {
        if (state.isRunning) timer.stopTimer();
        else timer.startTimer();
    }));

    resetBtn.connect('button-press-event', onControlPress(() => {
        timer.resetCurrentPhase();
    }));

    skipBtn.connect('button-press-event', onControlPress(() => {
        timer.advanceToNextPhase();
    }));

    connectTimerCleanup(container, state);
    updateDisplay();

    function applyScale(newScale) {
        ({ scale, arcMargin, arcSize, phaseFontSize, timerFontSize,
            dotSize, dotRadius, playIconSize, secIconSize } =
            computeScaleMetrics(Math.min(container.width, container.height), newScale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        phaseLabel.style = phaseLabelStyle();
        timerLabel.style = timerLabelStyle();
        sessionDotsBox.style = `margin-top: ${Math.round(BASE_DOTS_MARGIN_PX * scale)}px;`;
        controlsRow.style = `margin-top: ${Math.round(BASE_CONTROLS_MARGIN_PX * scale)}px;`;
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
