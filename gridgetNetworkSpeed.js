/**
 * ============================================================================
 * NETWORK SPEED MONITOR WIDGET
 * 
 * This module provides a visual readout of current upload and download speeds.
 * It subscribes to the centralized SystemMonitorEngine to receive parsed
 * data from /proc/net/dev, ensuring optimal performance.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import {
    resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    createWidgetContainer
} from './widgetUIUtils.js';
import { networkEngine } from './systemMonitorEngine.js';

const DOWNLOAD_COLOR = '#2ecc71';
const UPLOAD_COLOR = '#e74c3c';

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;

function formatBytesPerSecond(bytesPerSec) {
    if (bytesPerSec < BYTES_PER_KILOBYTE)
        return `${Math.round(bytesPerSec)} B/s`;
    if (bytesPerSec < BYTES_PER_MEGABYTE)
        return `${(bytesPerSec / BYTES_PER_KILOBYTE).toFixed(1)} KB/s`;
    return `${(bytesPerSec / BYTES_PER_MEGABYTE).toFixed(1)} MB/s`;
}

function createSpeedRow(iconName, iconColor, fontFamily, textColor, marginBottom = '') {
    const rowBox = new St.BoxLayout({
        vertical: false,
        x_align: Clutter.ActorAlign.START,
        style: marginBottom ? `margin-bottom: ${marginBottom};` : '',
    });

    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: 24,
        style: `color: ${iconColor}; margin-right: 12px;`,
    });

    const speedLabel = new St.Label({
        text: '0 B/s',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 20px; font-weight: bold; width: 100px; text-align: left;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    rowBox.add_child(icon);
    rowBox.add_child(speedLabel);

    return { rowBox, speedLabel };
}

export function createNetworkSpeedNode(config, width, height, xPosition, yPosition) {
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const downloadRow = createSpeedRow('go-down-symbolic', DOWNLOAD_COLOR, fontFamily, textColor, '8px');
    const uploadRow = createSpeedRow('go-up-symbolic', UPLOAD_COLOR, fontFamily, textColor);

    contentBox.add_child(downloadRow.rowBox);
    contentBox.add_child(uploadRow.rowBox);
    container.add_child(contentBox);

    const onDataUpdate = (data) => {
        downloadRow.speedLabel.set_text(formatBytesPerSecond(data.downloadSpeed));
        uploadRow.speedLabel.set_text(formatBytesPerSecond(data.uploadSpeed));
    };

    networkEngine.subscribe(onDataUpdate);

    container.connect('destroy', () => {
        networkEngine.unsubscribe(onDataUpdate);
    });

    return container;
}
