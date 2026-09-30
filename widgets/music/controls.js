import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, resolveWidgetSurfaces, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { skipToNext, skipToPrevious, togglePlayPause } from './mpris.js';
import { notifyPlayPauseAllInstances } from './playbackState.js';
import { MIN_FONT_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, scaleFontSize } from '../../utils/typography.js';

const BORDER_RADIUS_PILL = 99;

const SKIP_BACK_ICON = 'media-skip-backward-symbolic';
const SKIP_FORWARD_ICON = 'media-skip-forward-symbolic';
const FALLBACK_ICON = 'audio-x-generic-symbolic';

const BASE_SEEK_ICON_SIZE = 18;
const BASE_PLAY_ICON_SIZE = 24;
const BASE_BUTTON_MARGIN_LARGE = 16;
const BASE_BUTTON_MARGIN_SMALL = 4;
const BASE_PROGRESS_BAR_HEIGHT = 4;
const BASE_PROGRESS_SPACER_HEIGHT = 8;
const BASE_TIMER_MARGIN_TOP = 8;
const BASE_TIMER_FONT_SIZE = 12;

// Both timer labels share this so a resize cannot drop the build-time dimming.
function buildTimerLabelStyle(fontCss, textColor, scale) {
    const fontSize = scaleFontSize(BASE_TIMER_FONT_SIZE, scale, MIN_FONT_SIZE.metadata);
    return `${fontCss}color: ${textColor}; font-size: ${fontSize}px; `
        + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; opacity: ${TEXT_OPACITY.secondary};`;
}

export function createBackgroundLayer(config) {
    const borderRadius = resolveWidgetCornerRadius(config);
    const { card } = resolveWidgetSurfaces(config);
    return new St.Widget({
        style: `background-color: ${card}; background-size: cover; border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
}

function createIconButton(iconName, iconSize, buttonMargin, textColor) {
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

/** The controls sit centred in the wide layout and along the bottom edge in the small one. */
function resolveControlsAlignment(isLargeLayout) {
    if (isLargeLayout)
        return { xAlign: Clutter.ActorAlign.CENTER, yAlign: Clutter.ActorAlign.CENTER };
    return { xAlign: Clutter.ActorAlign.CENTER, yAlign: Clutter.ActorAlign.END };
}

function connectControlButton(button, action) {
    button.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        Promise.resolve(action()).catch(error => {
            console.error('Gridgets: control action failed:', error);
        });
        return Clutter.EVENT_STOP;
    });
}

// Shared by the build and the rescale, which had drifted apart when each computed its
// own margin.
const scaledButtonMargin = (scale, isLargeLayout) => scaleFontSize(
    isLargeLayout ? BASE_BUTTON_MARGIN_LARGE : BASE_BUTTON_MARGIN_SMALL, scale);

export function updateControlButtonScaling(state, scale, fontFamily, textColor, trackColor) {
    const seekSize = scaleFontSize(BASE_SEEK_ICON_SIZE, scale);
    const playSize = scaleFontSize(BASE_PLAY_ICON_SIZE, scale);
    const buttonMargin = scaledButtonMargin(scale, state.config.isLargeLayout === true);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const timerStyle = buildTimerLabelStyle(fontCss, textColor, scale);
    const buttonStyle = (margin) => `margin: 0px ${margin}px; border-radius: ${BORDER_RADIUS_PILL}px;`;
    const iconStyle = `color: ${textColor};`;
    const applyButton = (button, iconSize) => {
        if (!button) return;
        button.style = buttonStyle(buttonMargin);
        if (button.iconRef) {
            button.iconRef.set_icon_size(iconSize);
            button.iconRef.style = iconStyle;
        }
    };
    applyButton(state.seekBackBtn, seekSize);
    applyButton(state.playPauseBtn, playSize);
    applyButton(state.seekForwardBtn, seekSize);
    if (state.timerLabelLeft) state.timerLabelLeft.style = timerStyle;
    if (state.timerLabelRight) state.timerLabelRight.style = timerStyle;

    const barH = scaleFontSize(BASE_PROGRESS_BAR_HEIGHT, scale);
    if (state.progressBg) {
        state.progressBg.style = `background-color: ${trackColor}; border-radius: ${Math.floor(barH / 2)}px;`;
        state.progressBg.set_height(barH);
    }
    if (state.progressFill) {
        state.progressFill.style = `background-color: ${textColor}; border-radius: ${Math.floor(barH / 2)}px;`;
        state.progressFill.set_height(barH);
    }
    if (state.progressSpacer) {
        state.progressSpacer.set_height(scaleFontSize(BASE_PROGRESS_SPACER_HEIGHT, scale));
    }
    if (state.timerRow) {
        state.timerRow.style = `margin-top: ${scaleFontSize(BASE_TIMER_MARGIN_TOP, scale)}px;`;
    }
}

export function buildControlsColumn(config, state, initialScale = 1) {
    if (config.showControls === false) return null;

    // Pre-allocation values, replaced by updateControlButtonScaling once the responsive
    // scaler has run. The caller supplies its own reference box, so the first frame is
    // already the size the widget settles at; a flat 1 would be far too large for a
    // small widget.
    const scale = initialScale;
    const textColor = resolveWidgetForegroundColor(config);
    const { highlight } = resolveWidgetSurfaces(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const isLargeLayout = config.isLargeLayout === true;
    const { xAlign, yAlign } = resolveControlsAlignment(isLargeLayout);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: !isLargeLayout,
        // The small layout stretches full width, otherwise the rows inside
        // collapse to natural width and cluster in the centre.
        x_align: isLargeLayout ? xAlign : Clutter.ActorAlign.FILL,
        y_align: yAlign,
    });

    const buttonRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: isLargeLayout ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const seekIconSize = scaleFontSize(BASE_SEEK_ICON_SIZE, scale);
    const playIconSize = scaleFontSize(BASE_PLAY_ICON_SIZE, scale);
    const buttonMargin = scaledButtonMargin(scale, isLargeLayout);

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
        // Equal expanders pin the skip buttons to the edges and keep play centred.
        const leftSpacer = new St.Widget({ x_expand: true });
        const rightSpacer = new St.Widget({ x_expand: true });
        buttonRow.add_child(leftSpacer);
        buttonRow.add_child(playPauseBtn);
        buttonRow.add_child(rightSpacer);
        buttonRow.add_child(seekForwardBtn);
    }

    const progressBarHeight = scaleFontSize(BASE_PROGRESS_BAR_HEIGHT, scale);
    const progressBg = new St.Widget({
        style: `background-color: ${highlight}; border-radius: ${Math.floor(progressBarHeight / 2)}px;`,
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

    const timerStyle = buildTimerLabelStyle(fontCss, textColor, scale);
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
        height: scaleFontSize(BASE_PROGRESS_SPACER_HEIGHT, scale),
    });
    controlsColumn.add_child(progressSpacer);
    controlsColumn.add_child(progressRow);
    const timerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-top: ${scaleFontSize(BASE_TIMER_MARGIN_TOP, scale)}px;`,
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

    connectControlButton(seekBackBtn, () => skipToPrevious(state.config, state));

    connectControlButton(playPauseBtn, () => {
        notifyPlayPauseAllInstances(state.currentPlayer);
        return togglePlayPause(state.config, state);
    });

    connectControlButton(seekForwardBtn, () => skipToNext(state.config, state));

    return controlsColumn;
}
