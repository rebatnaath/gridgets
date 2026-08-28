import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { cpuRamEngine, networkEngine } from '../../utils/systemMonitorEngine.js';
import { formatBytesPerSecond } from './network.js';

const PERCENTAGE_FACTOR = 100;
const CHART_MAX_SAMPLES = 90;
const CHART_LINE_WIDTH = 2;
const CHART_FILL_ALPHA = 0.16;
const CHART_PAD = 4;
const LABEL_OPACITY = 0.65;
const BASE_CONTAINER_WIDTH_PX = 240;
const BASE_CONTAINER_HEIGHT_PX = 260;
const BASE_CARD_PADDING_PX = 14;
const BASE_CARD_RADIUS_PX = 16;
const BASE_CARD_GAP_PX = 12;
const BASE_TITLE_FONT_SIZE_PX = 16;
const BASE_BADGE_FONT_SIZE_PX = 15;
const BASE_NET_LABEL_FONT_SIZE_PX = 16;
const BASE_NET_VALUE_FONT_SIZE_PX = 26;
const BASE_NET_UNIT_FONT_SIZE_PX = 16;
const BORDER_ALPHA = 0.14;
const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

function drawTrendChart(ctx, w, h, samples, accentHex) {
    if (w === 0 || h === 0) return;

    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);

    if (samples.length < 2) return;

    const innerW = w - (CHART_PAD * 2);
    const innerH = h - (CHART_PAD * 2);

    const pointAt = (index) => {
        const ratio = index / (samples.length - 1);
        const value = Math.max(0, Math.min(1, samples[index]));
        return [
            CHART_PAD + ratio * innerW,
            CHART_PAD + (1 - value) * innerH,
        ];
    };

    const { r, g, b } = parseCssColor(accentHex);

    ctx.setLineWidth(CHART_LINE_WIDTH);
    ctx.setSourceRGBA(r, g, b, 1);
    ctx.newPath();
    const [startX, startY] = pointAt(0);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w - CHART_PAD, CHART_PAD + innerH);
    ctx.lineTo(CHART_PAD, CHART_PAD + innerH);
    ctx.closePath();
    ctx.setSourceRGBA(r, g, b, CHART_FILL_ALPHA);
    ctx.fill();
}

function createValueUnitRow(fontCss, textColor, valueFontSize, unitFontSize) {
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
    });
    const valueLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 300;`,
    });
    const unitLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-size: ${unitFontSize}px; opacity: ${LABEL_OPACITY};`,
    });
    row.add_child(valueLabel);
    row.add_child(unitLabel);
    return { row, valueLabel, unitLabel };
}

export function createSystemDashboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const scale = Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX);
    const cardPadding = Math.round(BASE_CARD_PADDING_PX * scale);
    const cardRadius = Math.round(BASE_CARD_RADIUS_PX * scale);
    const cardGap = Math.round(BASE_CARD_GAP_PX * scale);
    const titleFontSize = Math.round(BASE_TITLE_FONT_SIZE_PX * scale);
    const badgeFontSize = Math.round(BASE_BADGE_FONT_SIZE_PX * scale);
    const netLabelFontSize = Math.round(BASE_NET_LABEL_FONT_SIZE_PX * scale);
    const netValueFontSize = Math.round(BASE_NET_VALUE_FONT_SIZE_PX * scale);
    const netUnitFontSize = Math.round(BASE_NET_UNIT_FONT_SIZE_PX * scale);
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;
    const cardStyle = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPadding}px;`;

    const createChartArea = () => new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });

    const createBadge = () => new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-size: ${badgeFontSize}px; background-color: ${cssColorToRgba(textColor, 0.08)}; border-radius: 999px; padding: 2px 10px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const createCardHeader = (titleText, badge) => {
        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: `margin-bottom: ${Math.round(8 * scale)}px;`,
        });
        const titleLabel = new St.Label({
            text: titleText,
            style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: ${LABEL_OPACITY};`,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        header.add_child(titleLabel);
        if (badge) {
            header.add_child(badge);
        }
        return { header, titleLabel };
    };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.round(10 * scale)}px; spacing: ${Math.round(10 * scale)}px;`,
    });

    const processorCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: cardStyle,
    });

    const processorBadge = createBadge();
    processorCard.add_child(createCardHeader('Processor', processorBadge).header);
    const cpuChartArea = createChartArea();
    processorCard.add_child(cpuChartArea);

    const networkCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style: cardStyle,
    });

    const networkGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `spacing: ${cardGap * 2}px;`,
    });

    const createNetworkStat = (labelText) => {
        const stat = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: `spacing: ${Math.round(4 * scale)}px;`,
        });
        const label = new St.Label({
            text: labelText,
            style: `${fontCss}color: ${textColor}; font-size: ${netLabelFontSize}px; opacity: ${LABEL_OPACITY};`,
        });
        const valueRow = createValueUnitRow(fontCss, textColor, netValueFontSize, netUnitFontSize);
        stat.add_child(label);
        stat.add_child(valueRow.row);
        return { stat, valueLabel: valueRow.valueLabel, unitLabel: valueRow.unitLabel };
    };

    const downloadStat = createNetworkStat('Download');
    const uploadStat = createNetworkStat('Upload');

    networkGrid.add_child(downloadStat.stat);
    networkGrid.add_child(uploadStat.stat);
    networkCard.add_child(networkGrid);

    contentBox.add_child(processorCard);
    contentBox.add_child(networkCard);
    container.add_child(contentBox);

    let cpuSamples = [];

    cpuChartArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        drawTrendChart(ctx, w, h, cpuSamples, accentHex);
        ctx.$dispose();
    });

    const onCpuRamUpdate = (data) => {
        cpuSamples.push(data.cpuProgress);
        if (cpuSamples.length > CHART_MAX_SAMPLES) {
            cpuSamples.shift();
        }
        processorBadge.set_text(`${Math.round(data.cpuProgress * PERCENTAGE_FACTOR)}%`);
        cpuChartArea.queue_repaint();
    };

    const onNetworkUpdate = (data) => {
        const setNetworkValue = (valueLabel, unitLabel, bytesPerSec) => {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            valueLabel.set_text(value);
            unitLabel.set_text(` ${unit}`);
        };
        setNetworkValue(downloadStat.valueLabel, downloadStat.unitLabel, data.downloadSpeed);
        setNetworkValue(uploadStat.valueLabel, uploadStat.unitLabel, data.uploadSpeed);
    };

    const releaseCpuRam = cpuRamEngine.subscribe(onCpuRamUpdate);
    const releaseNetwork = networkEngine.subscribe(onNetworkUpdate);

    registerWidgetCleanup(container, () => {
        releaseCpuRam();
        releaseNetwork();
    });

    return container;
}
