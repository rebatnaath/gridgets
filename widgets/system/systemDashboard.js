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
    DEFAULT_CHILD_CORNER_RADIUS_PX } from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, traceRoundedRect } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, clampWidgetScale, createWidgetMetrics } from '../../utils/typography.js';
import { cpuRamEngine, networkEngine, systemStatsEngine } from '../../utils/systemMonitorEngine.js';
import { formatBytesPerSecond } from './network.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const PERCENTAGE_FACTOR = 100;
const CHART_MAX_SAMPLES = 90;
const CHART_LINE_WIDTH = 2;
const CHART_FILL_ALPHA = 0.16;
const CHART_PAD = 4;
const CPU_CHART_SMOOTHING = 0.15;
const MUTED_OPACITY = Math.round(255 * TEXT_OPACITY.secondary);
const SUBTLE_OPACITY = Math.round(255 * TEXT_OPACITY.metadata);
const CLUTTER_OPACITY_OPAQUE = 255;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const BYTES_PER_GIGABYTE = 1024 * 1024 * 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

// The mockup is a 540x360 logical card (1080x720 at 2x), so it is also the reference
// the scaler normalizes against: at the Medium preset the dashboard renders 1:1.
const BASE_CONTAINER_WIDTH_PX = 540;
const BASE_CONTAINER_HEIGHT_PX = 360;
const BASE_CONTENT_PADDING_PX = 13;
const BASE_CARD_GAP_PX = 8;
const BASE_CARD_PADDING_PX = 12;
const BASE_CARD_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const BASE_CARD_SPACING_PX = 6;
const BASE_VALUE_ROW_SPACING_PX = 2;
const BASE_SUBINFO_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const BASE_PROGRESS_HEIGHT_PX = 6;
const BASE_PROGRESS_RADIUS_PX = 999;
const BOTTOM_SECTION_HEIGHT_RATIO = 0.32;
const BADGE_RADIUS_PX = 999;
const BADGE_PADDING_Y_PX = 3;
const BADGE_PADDING_X_PX = 11;

const PROGRESS_COLORS = Object.freeze({
    memory: '#3584e4',
    gpu: '#2ec27e',
    disk: '#f5c211',
});
const CHART_COLOR = '#f66151';
const DOWNLOAD_COLOR = '#3584e4';
const UPLOAD_COLOR = '#c061cb';

const NETWORK_COLORS = Object.freeze({
    download: DOWNLOAD_COLOR,
    upload: UPLOAD_COLOR,
});

function formatByteCount(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes >= BYTES_PER_GIGABYTE) return formatUnit(bytes / BYTES_PER_GIGABYTE, 'GB');
    if (bytes >= BYTES_PER_MEGABYTE) return formatUnit(bytes / BYTES_PER_MEGABYTE, 'MB');
    return `${Math.round(bytes / 1024)} KB`;
}

function formatUnit(value, unit) {
    const decimals = value >= 10 ? 0 : 1;
    return `${value.toFixed(decimals)} ${unit}`;
}

// "9.8 / 16 GB" keeps a single unit for the pair, matching how a capacity readout is read.
function formatCapacityPair(usedBytes, totalBytes) {
    if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0)
        return '--';
    const used = usedBytes / BYTES_PER_GIGABYTE;
    const total = totalBytes / BYTES_PER_GIGABYTE;
    return `${used.toFixed(used >= 10 ? 0 : 1)} / ${total.toFixed(total >= 10 ? 0 : 1)} GB`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--';
    const days = Math.floor(seconds / SECONDS_PER_DAY);
    const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatBatteryFooter(battery) {
    if (battery === null) return '--';
    if (battery.status === 'Charging') return 'Charging';
    if (battery.status === 'Full') return 'Full';
    if (Number.isFinite(battery.secondsRemaining))
        return `${formatDuration(battery.secondsRemaining)} left`;
    return battery.status || '--';
}

function drawTrendChart(ctx, width, height, samples, lineHex) {
    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);

    if (width === 0 || height === 0) return;

    const innerWidth = width - (CHART_PAD * 2);
    const innerHeight = height - (CHART_PAD * 2);

    if (samples.length < 2) return;

    const pointAt = (index) => {
        const ratio = index / (samples.length - 1);
        const value = Math.max(0, Math.min(1, samples[index]));
        return [
            CHART_PAD + ratio * innerWidth,
            CHART_PAD + (1 - value) * innerHeight,
        ];
    };

    const { r, g, b } = parseCssColor(lineHex);

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

function drawProgressBar(ctx, width, height, fraction, trackRgba, fillRgb) {
    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);

    if (width <= 0 || height <= 0) return;

    const radius = height / 2;
    traceRoundedRect(ctx, 0, 0, width, height, radius);
    ctx.setSourceRGBA(trackRgba.r, trackRgba.g, trackRgba.b, GRAPHICS_OPACITY.arcTrack);
    ctx.fill();

    const fillWidth = Math.max(0, Math.min(width, width * fraction));
    if (fillWidth <= 0) return;
    traceRoundedRect(ctx, 0, 0, fillWidth, height, radius);
    ctx.setSourceRGBA(fillRgb.r, fillRgb.g, fillRgb.b, 1);
    ctx.fill();
}

export function createSystemDashboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const textRgb = parseCssColor(textColor);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const styleBindings = [];
    const repaintAreas = [];
    let metrics = null;

    const computeMetrics = (rawScale) => {
        const { scale, px } = createWidgetMetrics(rawScale);
        return {
            scale,
            contentPadding: px(BASE_CONTENT_PADDING_PX),
            cardGap: px(BASE_CARD_GAP_PX),
            cardPadding: px(BASE_CARD_PADDING_PX),
            cardRadius: resolveChildCornerRadius(BASE_CARD_RADIUS_PX, scale),
            cardSpacing: px(BASE_CARD_SPACING_PX),
            valueRowSpacing: px(BASE_VALUE_ROW_SPACING_PX),
            progressHeight: px(BASE_PROGRESS_HEIGHT_PX),
            progressRadius: px(BASE_PROGRESS_RADIUS_PX),
            titleFontSize: px(TYPOGRAPHY_SIZE.body),
            subtitleFontSize: px(BASE_SUBINFO_FONT_SIZE_PX),
            valueFontSize: px(TYPOGRAPHY_SIZE.displayMD),
            unitFontSize: px(TYPOGRAPHY_SIZE.subtitle),
            badgeFontSize: px(TYPOGRAPHY_SIZE.label),
        };
    };

    const roleStyle = (role, m) => {
        const valueStyle = `${fontCss}color: ${textColor}; font-size: ${m.valueFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`;
        const unitStyle = `${fontCss}color: ${textColor}; font-size: ${m.unitFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`;
        const map = {
            title: `${fontCss}color: ${textColor}; font-size: ${m.titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`,
            subtitle: `${fontCss}color: ${textColor}; font-size: ${m.subtitleFontSize}px;`,
            footer: `${fontCss}color: ${textColor}; font-size: ${m.subtitleFontSize}px;`,
            value: valueStyle,
            unit: unitStyle,
            badge: `${fontCss}color: ${textColor}; font-size: ${m.badgeFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; background-color: ${highlight}; border-radius: ${BADGE_RADIUS_PX}px; padding: ${BADGE_PADDING_Y_PX}px ${BADGE_PADDING_X_PX}px;`,
        };
        return map[role];
    };

    const opacityForRole = (role) => {
        if (role === 'title' || role === 'unit' || role === 'subtitle')
            return MUTED_OPACITY;
        if (role === 'footer')
            return SUBTLE_OPACITY;
        return CLUTTER_OPACITY_OPAQUE;
    };

    const cardStyle = m => `background-color: ${card}; border-radius: ${m.cardRadius}px; padding: ${m.cardPadding}px; spacing: ${m.cardSpacing}px;`;

    function bindRole(role, actor) {
        styleBindings.push({ actor, role });
        actor.style = roleStyle(role, metrics);
        actor.opacity = opacityForRole(role);
    }

    function bindGeometry(actor, build) {
        styleBindings.push({ actor, build });
        actor.style = build(metrics);
    }

    metrics = computeMetrics(clampWidgetScale(Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX)));

    const createCard = () => {
        const cardActor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        bindGeometry(cardActor, cardStyle);
        return cardActor;
    };

    const createTitle = (text) => {
        const label = new St.Label({ text, x_align: Clutter.ActorAlign.START });
        bindRole('title', label);
        return label;
    };

    const createValueRow = (align) => {
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: align,
        });
        bindGeometry(row, m => `spacing: ${m.valueRowSpacing}px;`);
        const valueLabel = new St.Label({ text: '--', y_align: Clutter.ActorAlign.END });
        const unitLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.END });
        bindRole('value', valueLabel);
        bindRole('unit', unitLabel);
        row.add_child(valueLabel);
        row.add_child(unitLabel);
        return { row, valueLabel, unitLabel };
    };

    const createProgressBar = (fillHex) => {
        const area = new St.DrawingArea({ x_expand: true });
        bindGeometry(area, m => `height: ${m.progressHeight}px; border-radius: ${m.progressRadius}px;`);
        const fillRgb = parseCssColor(fillHex);
        let fraction = 0;
        area.connect('repaint', (drawingArea) => {
            const context = drawingArea.get_context();
            const [surfaceWidth, surfaceHeight] = drawingArea.get_surface_size();
            drawProgressBar(context, surfaceWidth, surfaceHeight, fraction, textRgb, fillRgb);
            context.$dispose();
        });
        repaintAreas.push(area);
        return {
            area,
            setFraction: (nextFraction) => {
                fraction = Math.max(0, Math.min(1, nextFraction));
                area.queue_repaint();
            },
        };
    };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(contentBox, m => `padding: ${m.contentPadding}px; spacing: ${m.cardGap}px;`);

    // ── Processor card ──────────────────────────────────────────────────────
    const processorCard = createCard();
    const processorHeader = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    const processorTitle = createTitle('Processor');
    processorTitle.x_expand = true;
    const processorBadge = new St.Label({ text: '--', y_align: Clutter.ActorAlign.CENTER });
    bindRole('badge', processorBadge);
    processorHeader.add_child(processorTitle);
    processorHeader.add_child(processorBadge);

    const processorSubtitle = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('subtitle', processorSubtitle);

    const cpuChartArea = new St.DrawingArea({ x_expand: true, y_expand: true });
    let cpuSamples = [];
    cpuChartArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawTrendChart(context, surfaceWidth, surfaceHeight, cpuSamples, CHART_COLOR);
        context.$dispose();
    });
    repaintAreas.push(cpuChartArea);

    processorCard.add_child(processorHeader);
    processorCard.add_child(processorSubtitle);
    processorCard.add_child(cpuChartArea);

    // ── Memory card ─────────────────────────────────────────────────────────
    const memoryCard = createCard();
    const memoryValue = createValueRow(Clutter.ActorAlign.START);
    const memoryBar = createProgressBar(PROGRESS_COLORS.memory);
    const memoryFooter = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('footer', memoryFooter);
    memoryCard.add_child(createTitle('RAM'));
    memoryCard.add_child(memoryValue.row);
    memoryCard.add_child(memoryBar.area);
    memoryCard.add_child(memoryFooter);

    // ── GPU card ────────────────────────────────────────────────────────────
    const gpuCard = createCard();
    const gpuValue = createValueRow(Clutter.ActorAlign.START);
    const gpuBar = createProgressBar(PROGRESS_COLORS.gpu);
    const gpuFooter = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('footer', gpuFooter);
    gpuCard.add_child(createTitle('GPU'));
    gpuCard.add_child(gpuValue.row);
    gpuCard.add_child(gpuBar.area);
    gpuCard.add_child(gpuFooter);

    const memGpuRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(memGpuRow, m => `spacing: ${m.cardGap}px;`);
    memGpuRow.add_child(memoryCard);
    memGpuRow.add_child(gpuCard);

    // ── Disk card ───────────────────────────────────────────────────────────
    const diskCard = createCard();
    const diskHeader = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    const diskTitle = createTitle('Disk');
    diskTitle.x_expand = true;
    const diskValue = new St.Label({ text: '--' });
    bindRole('value', diskValue);
    diskHeader.add_child(diskTitle);
    diskHeader.add_child(diskValue);

    const diskBar = createProgressBar(PROGRESS_COLORS.disk);

    const diskFooterRow = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    const diskUsageFooter = new St.Label({ text: '--', x_expand: true, x_align: Clutter.ActorAlign.START });
    const diskSpeedFooter = new St.Label({ text: '--', x_align: Clutter.ActorAlign.END });
    bindRole('footer', diskUsageFooter);
    bindRole('footer', diskSpeedFooter);
    diskFooterRow.add_child(diskUsageFooter);
    diskFooterRow.add_child(diskSpeedFooter);

    diskCard.add_child(diskHeader);
    diskCard.add_child(diskBar.area);
    diskCard.add_child(diskFooterRow);

    const rightColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(rightColumn, m => `spacing: ${m.cardGap}px;`);
    rightColumn.add_child(memGpuRow);
    rightColumn.add_child(diskCard);

    const topSection = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(topSection, m => `spacing: ${m.cardGap}px;`);
    topSection.add_child(processorCard);
    topSection.add_child(rightColumn);

    // ── Network card (Download / Upload) ────────────────────────────────────
    const networkCard = createCard();
    const networkRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    bindGeometry(networkRow, m => `spacing: ${m.cardGap * 2}px;`);

    const createNetworkColumn = (labelText, align) => {
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        bindGeometry(column, m => `spacing: ${m.cardSpacing}px;`);

        const label = new St.Label({ text: labelText, x_align: align, y_align: Clutter.ActorAlign.CENTER });
        styleBindings.push({ actor: label, build: m => `${fontCss}color: ${textColor}; font-size: ${m.titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};` });
        label.style = `${fontCss}color: ${textColor}; font-size: ${metrics.titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`;
        label.opacity = SUBTLE_OPACITY;

        const value = createValueRow(align);
        const sparkArea = new St.DrawingArea({ x_expand: true, y_expand: true });
        repaintAreas.push(sparkArea);

        column.add_child(label);
        column.add_child(value.row);
        column.add_child(sparkArea);
        return { column, label, valueRow: value, sparkArea };
    };

    const downloadColumn = createNetworkColumn('Download', Clutter.ActorAlign.START);
    const uploadColumn = createNetworkColumn('Upload', Clutter.ActorAlign.END);
    networkRow.add_child(downloadColumn.column);
    networkRow.add_child(uploadColumn.column);
    networkCard.add_child(networkRow);

    // ── Battery card ────────────────────────────────────────────────────────
    const batteryCard = createCard();
    const batteryValue = createValueRow(Clutter.ActorAlign.START);
    const batteryFooter = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('footer', batteryFooter);
    batteryCard.add_child(createTitle('Battery'));
    batteryCard.add_child(batteryValue.row);
    batteryCard.add_child(batteryFooter);

    // ── Uptime card ─────────────────────────────────────────────────────────
    const uptimeCard = createCard();
    const uptimeValue = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('value', uptimeValue);
    const uptimeFooter = new St.Label({ text: '--', x_align: Clutter.ActorAlign.START });
    bindRole('footer', uptimeFooter);
    uptimeCard.add_child(createTitle('Uptime'));
    uptimeCard.add_child(uptimeValue);
    uptimeCard.add_child(uptimeFooter);

    const bottomRight = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    bindGeometry(bottomRight, m => `spacing: ${m.cardGap}px;`);
    bottomRight.add_child(batteryCard);
    bottomRight.add_child(uptimeCard);

    const bottomSection = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    bottomSection.add_child(networkCard);
    bottomSection.add_child(bottomRight);

    contentBox.add_child(topSection);
    contentBox.add_child(bottomSection);
    container.add_child(contentBox);

    // ── Data wiring ─────────────────────────────────────────────────────────
    function formatNetworkValue(valueLabel, unitLabel, bytesPerSec) {
        const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
        valueLabel.set_text(value);
        unitLabel.set_text(` ${unit}`);
    }

    const onCpuRamUpdate = (data) => {
        if (isActorDestroyed(container)) return;

        // Ease each reading into the series instead of appending it raw, so the line
        // glides between samples rather than snapping into a jagged per-poll staircase.
        const previous = cpuSamples.length > 0 ? cpuSamples[cpuSamples.length - 1] : data.cpuProgress;
        const smoothed = previous + (data.cpuProgress - previous) * CPU_CHART_SMOOTHING;
        cpuSamples.push(smoothed);
        if (cpuSamples.length > CHART_MAX_SAMPLES)
            cpuSamples.shift();
        cpuChartArea.queue_repaint();

        processorBadge.set_text(`${Math.round(data.cpuProgress * PERCENTAGE_FACTOR)}%`);

        const parts = [];
        if (Number.isFinite(data.cpuTempC)) parts.push(`${Math.round(data.cpuTempC)}°C`);
        if (Number.isFinite(data.cpuFreqGhz)) parts.push(`${data.cpuFreqGhz.toFixed(1)} GHz`);
        if (Number.isFinite(data.cpuCores)) parts.push(`${data.cpuCores} cores`);
        processorSubtitle.set_text(parts.length > 0 ? parts.join(' · ') : '--');

        const ramPercent = Math.round(data.ramProgress * PERCENTAGE_FACTOR);
        memoryValue.valueLabel.set_text(String(ramPercent));
        memoryValue.unitLabel.set_text('%');
        memoryBar.setFraction(data.ramProgress);
        memoryFooter.set_text(formatCapacityPair(data.memUsedBytes, data.memTotalBytes));
    };

    const onNetworkUpdate = (data) => {
        if (isActorDestroyed(container)) return;
        formatNetworkValue(downloadColumn.valueRow.valueLabel, downloadColumn.valueRow.unitLabel, data.downloadSpeed);
        formatNetworkValue(uploadColumn.valueRow.valueLabel, uploadColumn.valueRow.unitLabel, data.uploadSpeed);
    };

    const onSystemStatsUpdate = (data) => {
        if (isActorDestroyed(container)) return;

        const diskPercent = data.diskTotalBytes > 0 ? data.diskUsedBytes / data.diskTotalBytes : 0;
        diskValue.set_text(`${Math.round(diskPercent * PERCENTAGE_FACTOR)}%`);
        diskBar.setFraction(diskPercent);
        diskUsageFooter.set_text(formatCapacityPair(data.diskUsedBytes, data.diskTotalBytes));
        diskSpeedFooter.set_text(`R ${formatBytesPerSecond(data.diskReadBytesPerSec)} · W ${formatBytesPerSecond(data.diskWriteBytesPerSec)}`);

        const gpu = data.gpu;
        if (gpu === null) {
            gpuValue.valueLabel.set_text('--');
            gpuValue.unitLabel.set_text('');
            gpuBar.setFraction(0);
            gpuFooter.set_text('--');
        } else {
            gpuValue.valueLabel.set_text(String(Math.round(gpu.gpuProgress * PERCENTAGE_FACTOR)));
            gpuValue.unitLabel.set_text('%');
            gpuBar.setFraction(gpu.gpuProgress);
            const gpuParts = [];
            if (Number.isFinite(gpu.tempC)) gpuParts.push(`${Math.round(gpu.tempC)}°C`);
            if (Number.isFinite(gpu.usedBytes)) gpuParts.push(formatByteCount(gpu.usedBytes));
            gpuFooter.set_text(gpuParts.length > 0 ? gpuParts.join(' · ') : '--');
        }

        const battery = data.battery;
        if (battery === null) {
            batteryValue.valueLabel.set_text('--');
            batteryValue.unitLabel.set_text('');
            batteryFooter.set_text('--');
        } else {
            batteryValue.valueLabel.set_text(String(Math.round(battery.percentage)));
            batteryValue.unitLabel.set_text('%');
            batteryFooter.set_text(formatBatteryFooter(battery));
        }

        uptimeValue.set_text(formatDuration(data.uptimeSeconds));
        uptimeFooter.set_text(`load ${data.loadAverage.toFixed(2)}`);
    };

    // Every sparkline is drawn from the raw samples the engine pushes, normalized to
    // each series' own peak, so the caller records them here rather than in the tile.
    const networkSamples = { download: [], upload: [] };
    const recordNetworkSample = (column, key, bytesPerSec) => {
        const samples = networkSamples[key];
        samples.push(bytesPerSec);
        if (samples.length > CHART_MAX_SAMPLES)
            samples.shift();
        column.sparkArea.queue_repaint();
    };

    const drawNetworkSparkline = (context, surfaceWidth, surfaceHeight, samples, colorHex) => {
        const peak = Math.max(1024, ...samples);
        const { r, g, b } = parseCssColor(colorHex);
        context.setOperator(CAIRO_OPERATOR_CLEAR);
        context.paint();
        context.setOperator(CAIRO_OPERATOR_OVER);
        if (samples.length < 2 || surfaceWidth <= 0 || surfaceHeight <= 0) return;
        const stepX = surfaceWidth / (CHART_MAX_SAMPLES - 1);
        const offsetX = surfaceWidth - ((samples.length - 1) * stepX);
        context.newPath();
        for (let i = 0; i < samples.length; i++) {
            const x = offsetX + (i * stepX);
            const y = surfaceHeight - 1 - ((samples[i] / peak) * (surfaceHeight - 2));
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.setSourceRGBA(r, g, b, 1);
        context.setLineWidth(1);
        context.stroke();
    };

    downloadColumn.sparkArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawNetworkSparkline(context, surfaceWidth, surfaceHeight, networkSamples.download, NETWORK_COLORS.download);
        context.$dispose();
    });
    uploadColumn.sparkArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawNetworkSparkline(context, surfaceWidth, surfaceHeight, networkSamples.upload, NETWORK_COLORS.upload);
        context.$dispose();
    });

    const onNetworkSample = (data) => {
        if (isActorDestroyed(container)) return;
        recordNetworkSample(downloadColumn, 'download', data.downloadSpeed);
        recordNetworkSample(uploadColumn, 'upload', data.uploadSpeed);
    };

    function applyMetrics(nextScale, currentHeight) {
        if (!nextScale || !Number.isFinite(nextScale) || nextScale <= 0) return;
        metrics = computeMetrics(nextScale);
        styleBindings.forEach(binding => {
            binding.actor.style = binding.build
                ? binding.build(metrics)
                : roleStyle(binding.role, metrics);
        });
        const availableHeight = currentHeight - (metrics.contentPadding * 2);
        const bottomHeight = Math.max(1, Math.round(availableHeight * BOTTOM_SECTION_HEIGHT_RATIO));
        bottomSection.style = `spacing: ${metrics.cardGap}px; height: ${bottomHeight}px;`;
        for (const area of repaintAreas)
            area.queue_repaint();
    }

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (scale, currentWidth, currentHeight) => {
        if (!isActorDestroyed(container)) applyMetrics(scale, currentHeight);
    });

    const releaseCpuRam = cpuRamEngine.subscribe(onCpuRamUpdate);
    const releaseNetwork = networkEngine.subscribe(data => {
        onNetworkUpdate(data);
        onNetworkSample(data);
    });
    const releaseSystemStats = systemStatsEngine.subscribe(onSystemStatsUpdate);

    registerWidgetCleanup(container, () => {
        releaseCpuRam();
        releaseNetwork();
        releaseSystemStats();
    });

    return container;
}
