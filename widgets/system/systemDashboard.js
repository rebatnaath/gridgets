import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    resolveWidgetSurfaces,
    resolveChildCornerRadius,
    DEFAULT_CHILD_CORNER_RADIUS_PX,
    resolveAccentColor } from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { cpuRamEngine, networkEngine } from '../../utils/systemMonitorEngine.js';
import { formatBytesPerSecond } from './network.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const PERCENTAGE_FACTOR = 100;
const CHART_MAX_SAMPLES = 90;
const CHART_LINE_WIDTH = 2;
const CHART_FILL_ALPHA = 0.16;
const CHART_PAD = 4;
const LABEL_OPACITY = TEXT_OPACITY.secondary;
const BASE_CONTAINER_WIDTH_PX = 240;
const BASE_CONTAINER_HEIGHT_PX = 260;
const BASE_CARD_PADDING_PX = 14;
const BASE_CARD_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const BASE_CARD_GAP_PX = 12;
const BASE_SECONDARY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const BASE_BADGE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const BASE_NET_VALUE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.displayMD;
const BASE_CARD_HEADER_MARGIN_BOTTOM_PX = 8;
const BASE_CONTENT_BOX_PADDING_PX = 10;
const BASE_CONTENT_BOX_SPACING_PX = 10;
const NETWORK_GRID_SPACING_MULTIPLIER = 2;
const BASE_NETWORK_STAT_SPACING_PX = 4;
const BADGE_RADIUS_PX = 999;
const BADGE_PADDING_Y_PX = 2;
const BADGE_PADDING_X_PX = 10;

function drawTrendChart(ctx, width, height, samples, accentHex) {
    if (width === 0 || height === 0) return;

    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);

    if (samples.length < 2) return;

    const innerWidth = width - (CHART_PAD * 2);
    const innerHeight = height - (CHART_PAD * 2);

    const pointAt = (index) => {
        const ratio = index / (samples.length - 1);
        const value = Math.max(0, Math.min(1, samples[index]));
            return [
                CHART_PAD + ratio * innerWidth,
                CHART_PAD + (1 - value) * innerHeight,
            ];
    };

    const { r, g, b } = parseCssColor(accentHex);

    ctx.setLineWidth(CHART_LINE_WIDTH);
    ctx.setSourceRGBA(r, g, b, 1);
    ctx.newPath();
    const [startX, startY] = pointAt(0);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < samples.length; i++) {
        const [xPosition, yPosition] = pointAt(i);
        ctx.lineTo(xPosition, yPosition);
    }
    ctx.stroke();
    ctx.lineTo(width - CHART_PAD, CHART_PAD + innerHeight);
    ctx.lineTo(CHART_PAD, CHART_PAD + innerHeight);
    ctx.closePath();
    ctx.setSourceRGBA(r, g, b, CHART_FILL_ALPHA);
    ctx.fill();
}

function createValueUnitRow(bindRole) {
    const valueLabel = new St.Label({ text: '--' });
    const unitLabel = new St.Label({ text: '' });
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
    });
    row.add_child(valueLabel);
    row.add_child(unitLabel);
    bindRole('value', valueLabel);
    bindRole('unit', unitLabel);
    return { row, valueLabel, unitLabel };
}

export function createSystemDashboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = resolveAccentColor(config);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const styleBindings = [];
    let metrics = null;

    const computeMetrics = (scale) => ({
        scale,
        cardPadding: Math.round(BASE_CARD_PADDING_PX * scale),
        cardRadius: resolveChildCornerRadius(BASE_CARD_RADIUS_PX, scale),
        cardGap: Math.round(BASE_CARD_GAP_PX * scale),
        cardHeaderMarginBottom: Math.round(BASE_CARD_HEADER_MARGIN_BOTTOM_PX * scale),
        contentBoxPadding: Math.round(BASE_CONTENT_BOX_PADDING_PX * scale),
        contentBoxSpacing: Math.round(BASE_CONTENT_BOX_SPACING_PX * scale),
        networkStatSpacing: Math.round(BASE_NETWORK_STAT_SPACING_PX * scale),
        secondaryFontSize: scaleFontSize(BASE_SECONDARY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle),
        badgeFontSize: scaleFontSize(BASE_BADGE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label),
        netValueFontSize: scaleFontSize(BASE_NET_VALUE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary),
    });

    const secondaryLabelStyle = m =>
        `${fontCss}color: ${textColor}; font-size: ${m.secondaryFontSize}px; opacity: ${LABEL_OPACITY};`;

    const roleStyle = (role, m) => ({
        title: () => secondaryLabelStyle(m),
        badge: () => `${fontCss}color: ${textColor}; font-size: ${m.badgeFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; background-color: ${highlight}; border-radius: ${BADGE_RADIUS_PX}px; padding: ${BADGE_PADDING_Y_PX}px ${BADGE_PADDING_X_PX}px;`,
        networkLabel: () => secondaryLabelStyle(m),
        value: () => `${fontCss}color: ${textColor}; font-size: ${m.netValueFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
        unit: () => secondaryLabelStyle(m),
    }[role]());

    const cardStyle = m => `background-color: ${card}; border-radius: ${m.cardRadius}px; padding: ${m.cardPadding}px;`;
    const headerStyle = m => `margin-bottom: ${m.cardHeaderMarginBottom}px;`;
    const contentBoxStyle = m => `padding: ${m.contentBoxPadding}px; spacing: ${m.contentBoxSpacing}px;`;
    const networkGridStyle = m => `spacing: ${m.cardGap * NETWORK_GRID_SPACING_MULTIPLIER}px;`;
    const networkStatStyle = m => `spacing: ${m.networkStatSpacing}px;`;

    function bindRole(role, actor) {
        styleBindings.push({ actor, role });
        actor.style = roleStyle(role, metrics);
    }

    function bindGeometry(actor, build) {
        styleBindings.push({ actor, build });
        actor.style = build(metrics);
    }

    metrics = computeMetrics(Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const createChartArea = () => new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });

    const createBadge = () => {
        const badge = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
        bindRole('badge', badge);
        return badge;
    };

    const createCardHeader = (titleText, badge) => {
        const header = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        bindGeometry(header, headerStyle);
        const titleLabel = new St.Label({
            text: titleText,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        bindRole('title', titleLabel);
        header.add_child(titleLabel);
        if (badge) {
            header.add_child(badge);
        }
        return header;
    };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(contentBox, contentBoxStyle);

    const processorCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(processorCard, cardStyle);

    const processorBadge = createBadge();
    processorCard.add_child(createCardHeader('Processor', processorBadge));
    const cpuChartArea = createChartArea();
    processorCard.add_child(cpuChartArea);

    const networkCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    bindGeometry(networkCard, cardStyle);

    const networkGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    bindGeometry(networkGrid, networkGridStyle);

    const createNetworkStat = (labelText) => {
        const stat = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        bindGeometry(stat, networkStatStyle);
        const label = new St.Label({ text: labelText });
        bindRole('networkLabel', label);
        const valueRow = createValueUnitRow(bindRole);
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
        if (isActorDestroyed(container)) return;
        cpuSamples.push(data.cpuProgress);
        if (cpuSamples.length > CHART_MAX_SAMPLES) {
            cpuSamples.shift();
        }
        processorBadge.set_text(`${Math.round(data.cpuProgress * PERCENTAGE_FACTOR)}%`);
        cpuChartArea.queue_repaint();
    };

    const onNetworkUpdate = (data) => {
        if (isActorDestroyed(container)) return;
        const setNetworkValue = (valueLabel, unitLabel, bytesPerSec) => {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            valueLabel.set_text(value);
            unitLabel.set_text(` ${unit}`);
        };
        setNetworkValue(downloadStat.valueLabel, downloadStat.unitLabel, data.downloadSpeed);
        setNetworkValue(uploadStat.valueLabel, uploadStat.unitLabel, data.uploadSpeed);
    };

    function applyMetrics(nextScale) {
        if (!nextScale || !Number.isFinite(nextScale) || nextScale <= 0) return;
        metrics = computeMetrics(nextScale);
        styleBindings.forEach(binding => {
            binding.actor.style = binding.build
                ? binding.build(metrics)
                : roleStyle(binding.role, metrics);
        });
    }

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (scale) => {
        if (!isActorDestroyed(container)) applyMetrics(scale);
    });

    const releaseCpuRam = cpuRamEngine.subscribe(onCpuRamUpdate);
    const releaseNetwork = networkEngine.subscribe(onNetworkUpdate);

    registerWidgetCleanup(container, () => {
        releaseCpuRam();
        releaseNetwork();
    });

    return container;
}
