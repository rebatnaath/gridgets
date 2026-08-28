import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveExplicitFontFamily, SECONDARY_OPACITY, cssColorToRgba } from '../../utils/widgetUtils.js';
import { attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { SKIP_BACK_ICON, SKIP_FORWARD_ICON, FALLBACK_ICON } from './icons.js';
import { skipToNext, skipToPrevious, togglePlayPause } from './mpris.js';
import { notifyPlayPauseAllInstances } from './playbackState.js';

const BORDER_RADIUS_PILL = 99;
const PROGRESS_TRACK_ALPHA = 0.25;

export function createBackgroundLayer(config) {
    const borderRadius = config.appliedBorderRadius || 0;
    const backgroundColor = resolveWidgetBackgroundColor(config);
    return new St.Widget({
        style: `background-color: ${backgroundColor}; background-size: cover; border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
}

export function createIconButton(iconName, iconSize, buttonMargin, textColor) {
    const button = new St.Button({
        reactive: true,
        can_focus: true,
        style: `margin: 0px ${buttonMargin}px; border-radius: ${BORDER_RADIUS_PILL}px;`,
    });

    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        style: `color: ${textColor};`,
    });

    button.set_child(icon);
    button.iconRef = icon;
    attachButtonFeedback(button);
    return button;
}

export function resolveControlsAlignment(position, isLargeLayout) {
    if (isLargeLayout)
        return { xAlign: Clutter.ActorAlign.CENTER, yAlign: Clutter.ActorAlign.CENTER };

    let xAlign = Clutter.ActorAlign.CENTER;
    let yAlign = Clutter.ActorAlign.END;

    if (position.includes('left')) xAlign = Clutter.ActorAlign.START;
    if (position.includes('right')) xAlign = Clutter.ActorAlign.END;
    if (position.includes('top')) yAlign = Clutter.ActorAlign.START;
    if (position.includes('middle')) yAlign = Clutter.ActorAlign.CENTER;

    return { xAlign, yAlign };
}

export function connectControlButton(button, state, action) {
    button.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        if (!state.container.editMode) {
            action();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

/**
 * Applies responsive scaling to music playback control buttons and timer label.
 * Shared between small and large layout scaler callbacks to eliminate duplication.
 */
export function updateControlButtonScaling(state, scale, fontFamily, textColor) {
    const BASE_SEEK_SIZE = 18;
    const BASE_PLAY_SIZE = 24;
    const BASE_BUTTON_MARGIN_LARGE = 16;
    const BASE_BUTTON_MARGIN_SMALL = 4;
    const BASE_TIMER_FONT_SIZE = 14;

    const seekSize = Math.max(1, Math.round(BASE_SEEK_SIZE * scale));
    const playSize = Math.max(1, Math.round(BASE_PLAY_SIZE * scale));
    const baseMargin = (state.config && state.config.isLargeLayout === true)
        ? BASE_BUTTON_MARGIN_LARGE
        : BASE_BUTTON_MARGIN_SMALL;
    const buttonMargin = Math.max(1, Math.round(baseMargin * scale));
    const timerFontSize = Math.max(1, Math.round(BASE_TIMER_FONT_SIZE * scale));
    const buttonStyle = (margin) => `margin: 0px ${margin}px; border-radius: ${BORDER_RADIUS_PILL}px;`;
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const timerStyle = `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: 400;`;
    const iconStyle = `color: ${textColor};`;
    if (state.seekBackBtn) {
        state.seekBackBtn.style = buttonStyle(buttonMargin);
        if (state.seekBackBtn.iconRef) {
            state.seekBackBtn.iconRef.set_icon_size(seekSize);
            state.seekBackBtn.iconRef.style = iconStyle;
        }
    }
    if (state.playPauseBtn) {
        state.playPauseBtn.style = buttonStyle(buttonMargin);
        if (state.playPauseBtn.iconRef) {
            state.playPauseBtn.iconRef.set_icon_size(playSize);
            state.playPauseBtn.iconRef.style = iconStyle;
        }
    }
    if (state.seekForwardBtn) {
        state.seekForwardBtn.style = buttonStyle(buttonMargin);
        if (state.seekForwardBtn.iconRef) {
            state.seekForwardBtn.iconRef.set_icon_size(seekSize);
            state.seekForwardBtn.iconRef.style = iconStyle;
        }
    }
    if (state.timerLabelLeft) state.timerLabelLeft.style = timerStyle;
    if (state.timerLabelRight) state.timerLabelRight.style = timerStyle;

    const barH = Math.max(1, Math.round(4 * scale));
    if (state.progressBg) {
        state.progressBg.style = `background-color: ${cssColorToRgba(textColor, PROGRESS_TRACK_ALPHA)}; border-radius: ${Math.floor(barH / 2)}px;`;
        state.progressBg.set_height(barH);
    }
    if (state.progressFill) {
        state.progressFill.style = `background-color: ${textColor}; border-radius: ${Math.floor(barH / 2)}px;`;
        state.progressFill.set_height(barH);
    }
    if (state.progressSpacer) {
        state.progressSpacer.set_height(Math.max(1, Math.round(8 * scale)));
    }
    if (state.timerRow) {
        state.timerRow.style = `margin-top: ${Math.max(1, Math.round(8 * scale))}px;`;
    }
}

/** Builds playback controls layout actor. Returns null when controls are disabled for this widget. */
export function buildControlsColumn(config, state, width = 240, height = 140) {
    if (config.showControls === false) return null;

    const dynScale = Math.min(width / 240, height / 140);
    const scale = (config.layoutScale || 1) * dynScale;
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const margin = Math.floor(12 * scale);

    const isLargeLayout = config.isLargeLayout === true;
    const controlsPosition = config.controlsPosition || 'bottom-center';
    const { xAlign, yAlign } = resolveControlsAlignment(controlsPosition, isLargeLayout);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: !isLargeLayout,
        // small layout must stretch full width or the rows inside collapse
        // to natural width and cluster in the center
        x_align: isLargeLayout ? xAlign : Clutter.ActorAlign.FILL,
        y_align: yAlign,
        style: `margin: ${margin}px;`,
    });

    const buttonRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: isLargeLayout ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const seekIconSize = Math.max(1, Math.round(18 * scale));
    const playIconSize = Math.max(1, Math.round(24 * scale));
    // spread layout needs small edge margins; the large centered cluster
    // keeps the wide 16px gaps between buttons
    const buttonMargin = isLargeLayout
        ? Math.floor(16 * scale)
        : Math.max(1, Math.round(4 * scale));

    const seekBackBtn = createIconButton(
        SKIP_BACK_ICON,
        seekIconSize,
        buttonMargin, textColor
    );
    const playPauseBtn = createIconButton(
        FALLBACK_ICON,
        playIconSize,
        buttonMargin, textColor
    );
    const seekForwardBtn = createIconButton(
        SKIP_FORWARD_ICON,
        seekIconSize,
        buttonMargin, textColor
    );

    buttonRow.add_child(seekBackBtn);
    if (isLargeLayout) {
        buttonRow.add_child(playPauseBtn);
        buttonRow.add_child(seekForwardBtn);
    } else {
        // equal expanders pin skip buttons to the edges and keep play centered
        const leftSpacer = new St.Widget({ x_expand: true });
        const rightSpacer = new St.Widget({ x_expand: true });
        buttonRow.add_child(leftSpacer);
        buttonRow.add_child(playPauseBtn);
        buttonRow.add_child(rightSpacer);
        buttonRow.add_child(seekForwardBtn);
    }

    const progressBarHeight = Math.max(1, Math.round(4 * scale));
    const progressBg = new St.Widget({
        style: `background-color: ${cssColorToRgba(textColor, PROGRESS_TRACK_ALPHA)}; border-radius: ${Math.floor(progressBarHeight / 2)}px;`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        height: progressBarHeight,
    });
    const progressFill = new St.Widget({
        style: `background-color: ${textColor}; border-radius: ${Math.floor(progressBarHeight / 2)}px;`,
        x_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
        height: progressBarHeight,
        width: 0,
    });
    progressBg.add_child(progressFill);

    const timerStyle = `${fontCss}color: ${textColor}; font-size: ${Math.floor(12 * scale)}px; `
        + `opacity: ${SECONDARY_OPACITY};`;
    const timerLabelLeft = new St.Label({
        text: '00:00',
        x_align: Clutter.ActorAlign.START,
        style: timerStyle,
    });
    const timerLabelRight = new St.Label({
        text: '00:00',
        x_align: Clutter.ActorAlign.END,
        style: timerStyle,
    });

    const progressRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    progressRow.add_child(progressBg);

    controlsColumn.add_child(buttonRow);

    const progressSpacer = new St.Widget({
        y_expand: false,
        height: Math.floor(8 * scale),
    });
    controlsColumn.add_child(progressSpacer);
    controlsColumn.add_child(progressRow);
    const timerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-top: ${Math.floor(8 * scale)}px;`,
    });
    timerRow.add_child(timerLabelLeft);
    const timerSpacer = new St.Widget({ x_expand: true });
    timerRow.add_child(timerSpacer);
    timerRow.add_child(timerLabelRight);
    controlsColumn.add_child(timerRow);

    state.controlsColumn = controlsColumn;
    state.seekBackBtn = seekBackBtn;
    state.playPauseBtn = playPauseBtn;
    state.seekForwardBtn = seekForwardBtn;
    state.playPauseIcon = playPauseBtn.iconRef;
    state.timerLabelLeft = timerLabelLeft;
    state.timerLabelRight = timerLabelRight;
    state.progressBg = progressBg;
    state.progressFill = progressFill;
    state.progressSpacer = progressSpacer;
    state.timerRow = timerRow;

    connectControlButton(seekBackBtn, state, () => {
        skipToPrevious(state.currentPlayer);
    });

    connectControlButton(playPauseBtn, state, () => {
        notifyPlayPauseAllInstances(state.currentPlayer);
        togglePlayPause(state.currentPlayer);
    });

    connectControlButton(seekForwardBtn, state, () => {
        skipToNext(state.currentPlayer);
    });

    return controlsColumn;
}
