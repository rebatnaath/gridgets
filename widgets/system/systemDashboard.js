import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { createWidgetContainer } from '../../utils/widgetUIUtils.js';
import { cpuRamEngine, networkEngine } from '../../utils/systemMonitorEngine.js';
import { formatBytesPerSecond } from './network.js';

const CYAN_ACCENT_COLOR = '#00d2ff';
const ORANGE_ACCENT_COLOR = '#f97316';
const PERCENTAGE_FACTOR = 100;
const BASE_CONTAINER_WIDTH_PX = 260;
const BASE_CONTAINER_HEIGHT_PX = 240;
const BASE_TITLE_FONT_SIZE_PX = 13;
const BASE_SUBTEXT_FONT_SIZE_PX = 11;
const BASE_VALUE_FONT_SIZE_PX = 14;
const BASE_ICON_SIZE_PX = 16;
const BASE_CARD_PADDING_PX = 10;
const BASE_PROGRESS_BAR_HEIGHT_PX = 8;
export function createSystemDashboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const titleFontSize = Math.max(9, Math.round(BASE_TITLE_FONT_SIZE_PX * scale));
    const subtextFontSize = Math.max(8, Math.round(BASE_SUBTEXT_FONT_SIZE_PX * scale));
    const valueFontSize = Math.max(10, Math.round(BASE_VALUE_FONT_SIZE_PX * scale));
    const iconSize = Math.max(12, Math.round(BASE_ICON_SIZE_PX * scale));
    const cardPadding = Math.max(6, Math.round(BASE_CARD_PADDING_PX * scale));
    const progressBarHeight = Math.max(6, Math.round(BASE_PROGRESS_BAR_HEIGHT_PX * scale));

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: `padding: ${cardPadding}px;`,
    });

    const cpuCardBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
        style: `background-color: rgba(255, 255, 255, 0.07); border-radius: ${Math.round(10 * scale)}px; padding: ${Math.round(10 * scale)}px; margin-bottom: ${Math.round(8 * scale)}px;`,
    });

    const cpuHeaderRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        style: `margin-bottom: ${Math.round(4 * scale)}px;`,
    });

    const cpuTitleBox = new St.BoxLayout({
        vertical: false,
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });

    const cpuIcon = new St.Icon({
        icon_name: 'processor-symbolic',
        icon_size: iconSize,
        style: `color: ${textColor}; margin-right: ${Math.round(6 * scale)}px;`,
    });

    const cpuTitleLabel = new St.Label({
        text: 'CPU: -- GHz',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    cpuTitleBox.add_child(cpuIcon);
    cpuTitleBox.add_child(cpuTitleLabel);

    const cpuTempLabel = new St.Label({
        text: '--°C',
        style: `font-family: ${fontFamily}; color: ${CYAN_ACCENT_COLOR}; font-size: ${titleFontSize}px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    cpuHeaderRow.add_child(cpuTitleBox);
    cpuHeaderRow.add_child(cpuTempLabel);

    const cpuSubRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
    });

    const cpuUtilLabel = new St.Label({
        text: 'Utilization: --%',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${subtextFontSize}px; opacity: 0.8;`,
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });

    const cpuTasksLabel = new St.Label({
        text: '-- Tasks',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${subtextFontSize}px; opacity: 0.8;`,
        x_align: Clutter.ActorAlign.END,
    });

    cpuSubRow.add_child(cpuUtilLabel);
    cpuSubRow.add_child(cpuTasksLabel);

    cpuCardBox.add_child(cpuHeaderRow);
    cpuCardBox.add_child(cpuSubRow);

    const networkCardBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
        style: `background-color: rgba(255, 255, 255, 0.05); border-radius: ${Math.round(10 * scale)}px; padding: ${Math.round(10 * scale)}px; margin-bottom: ${Math.round(8 * scale)}px;`,
    });

    function createNetworkRow(iconName, iconColor, labelText) {
        const rowBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: `margin-bottom: ${Math.round(4 * scale)}px;`,
        });

        const leftBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });

        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: iconSize,
            style: `color: ${iconColor}; margin-right: ${Math.round(6 * scale)}px;`,
        });

        const label = new St.Label({
            text: labelText,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${subtextFontSize}px; opacity: 0.8;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        leftBox.add_child(icon);
        leftBox.add_child(label);

        const valueLabel = new St.Label({
            text: '0 B/s',
            style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${valueFontSize}px; font-weight: bold;`,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        rowBox.add_child(leftBox);
        rowBox.add_child(valueLabel);

        return { rowBox, valueLabel };
    }

    const downloadRow = createNetworkRow('go-down-symbolic', CYAN_ACCENT_COLOR, 'Download');
    const uploadRow = createNetworkRow('go-up-symbolic', ORANGE_ACCENT_COLOR, 'Upload');

    networkCardBox.add_child(downloadRow.rowBox);
    networkCardBox.add_child(uploadRow.rowBox);

    const ramCardBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
        style: `background-color: rgba(255, 255, 255, 0.07); border-radius: ${Math.round(10 * scale)}px; padding: ${Math.round(10 * scale)}px;`,
    });

    const ramHeaderRow = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        style: `margin-bottom: ${Math.round(6 * scale)}px;`,
    });

    const ramTitleBox = new St.BoxLayout({
        vertical: false,
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });

    const ramIcon = new St.Icon({
        icon_name: 'resources-symbolic',
        icon_size: iconSize,
        style: `color: ${textColor}; margin-right: ${Math.round(6 * scale)}px;`,
    });

    const ramTitleLabel = new St.Label({
        text: 'Memory',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    ramTitleBox.add_child(ramIcon);
    ramTitleBox.add_child(ramTitleLabel);

    const ramPercentLabel = new St.Label({
        text: '--%',
        style: `font-family: ${fontFamily}; color: ${CYAN_ACCENT_COLOR}; font-size: ${titleFontSize}px; font-weight: bold;`,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    ramHeaderRow.add_child(ramTitleBox);
    ramHeaderRow.add_child(ramPercentLabel);

    const ramTrackBox = new St.Widget({
        style: `background-color: rgba(255, 255, 255, 0.15); border-radius: ${Math.round(progressBarHeight / 2)}px; height: ${progressBarHeight}px; min-height: ${progressBarHeight}px; width: 100%;`,
        x_expand: true,
    });

    const ramFillBox = new St.Widget({
        style: `background-color: ${CYAN_ACCENT_COLOR}; border-radius: ${Math.round(progressBarHeight / 2)}px; height: ${progressBarHeight}px; min-height: ${progressBarHeight}px; width: 10px;`,
    });

    ramTrackBox.add_child(ramFillBox);

    let lastRamProgressRatio = 0.5;

    const updateRamProgressBarWidth = (progressRatio) => {
        lastRamProgressRatio = progressRatio;
        const trackWidth = ramTrackBox.get_width() || Math.max(100, Math.round(width - cardPadding * 4));
        const fillWidth = Math.max(progressBarHeight, Math.round(trackWidth * Math.max(0.02, Math.min(1.0, progressRatio))));
        ramFillBox.set_width(fillWidth);
    };

    ramCardBox.add_child(ramHeaderRow);
    ramCardBox.add_child(ramTrackBox);

    contentBox.add_child(cpuCardBox);
    contentBox.add_child(networkCardBox);
    contentBox.add_child(ramCardBox);
    container.add_child(contentBox);

    const onCpuRamUpdate = (data) => {
        const cpuPercent = Math.round(data.cpuProgress * PERCENTAGE_FACTOR);
        const ramPercent = Math.round(data.ramProgress * PERCENTAGE_FACTOR);

        cpuTitleLabel.set_text(`CPU: ${data.cpuFreqGhz} GHz`);
        cpuTempLabel.set_text(`${data.cpuTempC}°C`);
        cpuUtilLabel.set_text(`Utilization: ${cpuPercent}%`);
        cpuTasksLabel.set_text(`${data.taskCount} Tasks`);
        ramPercentLabel.set_text(`${ramPercent}%`);

        updateRamProgressBarWidth(data.ramProgress);
    };

    const onNetworkUpdate = (data) => {
        downloadRow.valueLabel.set_text(formatBytesPerSecond(data.downloadSpeed));
        uploadRow.valueLabel.set_text(formatBytesPerSecond(data.uploadSpeed));
    };

    container.connect('notify::width', () => updateRamProgressBarWidth(lastRamProgressRatio));

    cpuRamEngine.subscribe(onCpuRamUpdate);
    networkEngine.subscribe(onNetworkUpdate);

    container.connect('destroy', () => {
        cpuRamEngine.unsubscribe(onCpuRamUpdate);
        networkEngine.unsubscribe(onNetworkUpdate);
    });

    return container;
}
