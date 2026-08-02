import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { createWidgetContainer } from '../../utils/widgetUIUtils.js';
import { networkEngine } from '../../utils/systemMonitorEngine.js';

const DOWNLOAD_COLOR = '#2ecc71';
const UPLOAD_COLOR = '#e74c3c';
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const BASE_CONTAINER_WIDTH = 180;
const BASE_CONTAINER_HEIGHT = 100;
const BASE_ICON_SIZE = 24;
const MIN_ICON_SIZE = 14;
const BASE_FONT_SIZE = 20;
const MIN_FONT_SIZE = 12;
const DEFAULT_MARGIN_RIGHT_PX = 12;
const DEFAULT_MARGIN_BOTTOM_PX = 8;
const MIN_MARGIN_RIGHT_PX = 6;
const MIN_MARGIN_BOTTOM_PX = 4;
export function formatBytesPerSecond(bytesPerSec) {
    if (bytesPerSec < BYTES_PER_KILOBYTE)
        return `${Math.round(bytesPerSec)} B/s`;
    if (bytesPerSec < BYTES_PER_MEGABYTE)
        return `${(bytesPerSec / BYTES_PER_KILOBYTE).toFixed(1)} KB/s`;
    return `${(bytesPerSec / BYTES_PER_MEGABYTE).toFixed(1)} MB/s`;
}

function createSpeedRow(iconName, iconColor, { fontFamily, textColor, iconSize, fontSize, marginRight }, marginBottom = 0) {
    const rowBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        style: marginBottom > 0 ? `margin-bottom: ${marginBottom}px;` : '',
    });

    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        style: `color: ${iconColor}; margin-right: ${marginRight}px;`,
    });

    const speedLabel = new St.Label({
        text: '0 B/s',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${fontSize}px; font-weight: bold; text-align: left;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    rowBox.add_child(icon);
    rowBox.add_child(speedLabel);

    return { rowBox, speedLabel };
}

export function createNetworkSpeedNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const iconSize = Math.max(MIN_ICON_SIZE, Math.round(BASE_ICON_SIZE * scale));
    const fontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * scale));
    const marginRight = Math.max(MIN_MARGIN_RIGHT_PX, Math.round(DEFAULT_MARGIN_RIGHT_PX * scale));
    const marginBottom = Math.max(MIN_MARGIN_BOTTOM_PX, Math.round(DEFAULT_MARGIN_BOTTOM_PX * scale));

    const styleOptions = { fontFamily, textColor, iconSize, fontSize, marginRight };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const downloadRow = createSpeedRow('go-down-symbolic', DOWNLOAD_COLOR, styleOptions, marginBottom);
    const uploadRow = createSpeedRow('go-up-symbolic', UPLOAD_COLOR, styleOptions);

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
