/**
 * ============================================================================
 * CPU & RAM MONITOR WIDGET 
 * 
 * This module provides a visual gauge for real-time CPU and RAM usage.
 * It subscribes to the centralized SystemMonitorEngine to receive updates,
 * minimizing redundant system reads and improving battery efficiency.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import {
    parseHexColor, resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    drawCircularArc, createWidgetContainer
} from './widgetUIUtils.js';
import { cpuRamEngine } from './systemMonitorEngine.js';

const TICK_INTERVAL_MS = 2000;

const DEFAULT_CPU_COLOR = '#ff9e64';
const DEFAULT_RAM_COLOR = '#7aa2f7';

function createGaugeSection(fontFamily, textColor, titleText, titleColor) {
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 18px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: titleText,
        style: `font-family: ${fontFamily}; color: ${titleColor}; font-size: 12px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.CENTER,
    });

    labelBox.add_child(valueLabel);
    labelBox.add_child(titleLabel);
    gaugeBox.add_child(canvas);
    gaugeBox.add_child(labelBox);

    return { gaugeBox, canvas, valueLabel };
}

export function createCpuRamNode(config, width, height, xPosition, yPosition) {
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

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

    const cpuSection = createGaugeSection(fontFamily, textColor, 'CPU', DEFAULT_CPU_COLOR);
    cpuSection.canvas.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        drawCircularArc(ctx, canvasWidth, canvasHeight, currentCpuProgress, DEFAULT_CPU_COLOR);
    });

    const ramSection = createGaugeSection(fontFamily, textColor, 'RAM', DEFAULT_RAM_COLOR);
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
        cpuSection.valueLabel.set_text(`${Math.round(currentCpuProgress * 100)}%`);
        ramSection.valueLabel.set_text(`${Math.round(currentRamProgress * 100)}%`);
        cpuSection.canvas.queue_repaint();
        ramSection.canvas.queue_repaint();
    };

    cpuRamEngine.subscribe(onDataUpdate);

    container.connect('destroy', () => {
        cpuRamEngine.unsubscribe(onDataUpdate);
    });

    return container;
}
