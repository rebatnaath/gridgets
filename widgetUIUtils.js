/**
 * ============================================================================
 * WIDGET UI UTILITIES
 * 
 * This file contains common UI building blocks and functions used
 * by multiple widgets. It provides functions to create a standard
 * widget container, manage GLib polling timers, create caption
 * overlays, and draw circular progress arcs.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    buildBaseWidgetStyle,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    DEFAULT_FONT_FAMILY,
    parseHexColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND
} from './widgetUtils.js';

/**
 * Creates a standard widget container with background color, border, and BinLayout.
 * All widget `create*Node()` functions construct an almost identical root St.Widget;
 * this centralises that boilerplate.
 *
 * @param {Object}  config     - Widget configuration (must include applied styles)
 * @param {number}  width      - Widget pixel width
 * @param {number}  height     - Widget pixel height
 * @param {number}  xPosition  - Pixel X offset on the grid
 * @param {number}  yPosition  - Pixel Y offset on the grid
 * @returns {St.Widget}        - configured container widget
 */
export function createWidgetContainer(config, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(config);
    const backgroundColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;

    const container = new St.Widget({
        style: `background-color: ${backgroundColor}; color: ${textColor}; font-family: ${fontFamily}; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);
    return container;
}

/**
 * Connects a 'destroy' signal to the container that cleans up a GLib timer.
 * Prevents leaked main-loop sources when the widget is removed.
 *
 * @param {St.Widget} container  - widget container
 * @param {Object}    state      - Mutable state object with a `timerId` property
 */
export function connectTimerCleanup(container, state) {
    container.connect('destroy', () => {
        if (state.timerId) {
            GLib.Source.remove(state.timerId);
            state.timerId = null;
        }
    });
}

/**
 * Runs a poll function immediately, then starts a recurring GLib timer.
 * Returns the timer ID via the provided state object.
 *
 * @param {Function} pollFunction  - function to call on each tick
 * @param {number}   intervalMs    - Milliseconds between ticks
 * @param {Object}   state         - Mutable state; `timerId` will be set
 */
export function startPollingTimer(pollFunction, intervalMs, state) {
    pollFunction();
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
        pollFunction();
        return GLib.SOURCE_CONTINUE;
    });
}

/**
 * Creates a bottom-anchored caption overlay for image-based widgets.
 * Shared by Image, GIF, and Slideshow widgets to avoid code duplication.
 *
 * @param {Object} config   - Widget config with fontFamily, textColor/fgColor
 * @param {string} caption  - caption text to display
 * @returns {St.BoxLayout}  - caption overlay container
 */
export function createCaptionOverlay(config, caption) {
    const CAPTION_PADDING_PIXELS = 12;
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = config.textColor || config.fgColor || resolveWidgetForegroundColor(config);

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.END,
        style: `padding: ${CAPTION_PADDING_PIXELS}px;`,
    });

    const titleLabel = new St.Label({
        text: caption,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: 14px; text-align: center; text-shadow: 0px 2px 4px rgba(0,0,0,0.8);`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    contentBox.add_child(titleLabel);
    return contentBox;
}

/**
 * Draws a circular progress arc on a Cairo context.
 * Shared between CPU/RAM and Pomodoro widgets.
 *
 * @param {Object}  context         - Cairo drawing context
 * @param {number}  width           - Canvas width
 * @param {number}  height          - Canvas height
 * @param {number}  progress        - Progress value from 0 to 1
 * @param {string}  colorHex        - Hex color for the progress arc
 * @param {number}  lineWidthRatio  - Thickness as a ratio of the smaller dimension
 */
export function drawCircularArc(context, width, height, progress, colorHex, lineWidthRatio = 0.1) {
    const TWO_PI = Math.PI * 2;

    context.setOperator(CAIRO_OPERATOR_CLEAR);
    context.paint();
    context.setOperator(CAIRO_OPERATOR_OVER);

    const centerX = width / 2;
    const centerY = height / 2;
    const lineWidth = Math.max(4, Math.min(width, height) * lineWidthRatio);
    const radius = Math.min(centerX, centerY) - lineWidth - 4;

    // Background track
    context.setSourceRGBA(1, 1, 1, 0.1);
    context.setLineWidth(lineWidth);
    context.arc(centerX, centerY, radius, 0, TWO_PI);
    context.stroke();

    // Progress arc
    if (progress > 0) {
        const { r, g, b } = parseHexColor(colorHex);

        context.setSourceRGBA(r, g, b, 1.0);
        context.setLineWidth(lineWidth);
        context.setLineCap(CAIRO_LINE_CAP_ROUND);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + TWO_PI * Math.min(Math.max(progress, 0), 1);
        context.arc(centerX, centerY, radius, startAngle, endAngle);
        context.stroke();
    }
}
