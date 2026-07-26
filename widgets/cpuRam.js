/**
 * ============================================================================
 * CPU & RAM MONITOR WIDGET
 * 
 * Visually displays real-time CPU and RAM usage via circular progress arcs.
 * Subscribes to the centralized SystemMonitorEngine to avoid redundant polls.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer } from '../utils/widgetUIUtils.js';
import { cpuRamEngine } from '../utils/systemMonitorEngine.js';

/** Gauge section color accents */
const DEFAULT_CPU_COLOR = '#ff9e64';
const DEFAULT_RAM_COLOR = '#7aa2f7';

/** Layout scaling constants */
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 120;
const BASE_VALUE_FONT_SIZE = 18;
const MIN_VALUE_FONT_SIZE = 12;
const BASE_TITLE_FONT_SIZE = 12;
const MIN_TITLE_FONT_SIZE = 9;
const PERCENTAGE_FACTOR = 100;

/** Creates a circular gauge section containing canvas and text labels. */
function createGaugeSection(titleText, titleColor, { fontFamily, textColor, valueFontSize, titleFontSize }) {
    const gaugeBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    const canvas = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });

    const labelBox = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
        text: '0%',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${valueFontSize}px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: titleText,
        style: `font-family: ${fontFamily}; color: ${titleColor}; font-size: ${titleFontSize}px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    labelBox.add_child(valueLabel);
    labelBox.add_child(titleLabel);
    gaugeBox.add_child(canvas);
    gaugeBox.add_child(labelBox);

    return { gaugeBox, canvas, valueLabel };
}

/** Creates a CPU & RAM gauge monitor widget node. */
export function createCpuRamNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const valueFontSize = Math.max(MIN_VALUE_FONT_SIZE, Math.round(BASE_VALUE_FONT_SIZE * scale));
    const titleFontSize = Math.max(MIN_TITLE_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));

    const styleOptions = { fontFamily, textColor, valueFontSize, titleFontSize };

    const contentBox = new St.Widget({
        layout_manager: new Clutter.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            homogeneous: true,
        }),
        x_expand: true,
        y_expand: true,
    });

    let currentCpuProgress = 0;
    let currentRamProgress = 0;

    const cpuSection = createGaugeSection('CPU', DEFAULT_CPU_COLOR, styleOptions);
    cpuSection.canvas.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        drawCircularArc(ctx, canvasWidth, canvasHeight, currentCpuProgress, DEFAULT_CPU_COLOR);
    });

    const ramSection = createGaugeSection('RAM', DEFAULT_RAM_COLOR, styleOptions);
    ramSection.canvas.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        drawCircularArc(ctx, canvasWidth, canvasHeight, currentRamProgress, DEFAULT_RAM_COLOR);
    });

    contentBox.add_child(cpuSection.gaugeBox);
    contentBox.add_child(ramSection.gaugeBox);
    container.add_child(contentBox);

    const onDataUpdate = (data) => {
        currentCpuProgress = data.cpuProgress;
        currentRamProgress = data.ramProgress;
        cpuSection.valueLabel.set_text(`${Math.round(currentCpuProgress * PERCENTAGE_FACTOR)}%`);
        ramSection.valueLabel.set_text(`${Math.round(currentRamProgress * PERCENTAGE_FACTOR)}%`);
        cpuSection.canvas.queue_repaint();
        ramSection.canvas.queue_repaint();
    };

    cpuRamEngine.subscribe(onDataUpdate);
    container.connect('destroy', () => {
        cpuRamEngine.unsubscribe(onDataUpdate);
    });

    return container;
}
