import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import { createTimeNode } from './widgets/time/index.js';
import { createWeatherNode } from './widgets/weather/index.js';
import { createMusicNode } from './widgets/music/index.js';
import { createNotesNode } from './widgets/notes.js';
import { createClipboardNode } from './widgets/clipboard.js';
import { createCalendarNode } from './widgets/calendar.js';
import { createQuotesNode } from './widgets/quotes.js';
import {
    createCpuRamNode,
    createNetworkSpeedNode,
    createSystemDashboardNode
} from './widgets/system/index.js';
import { createPomodoroNode } from './widgets/pomodoro.js';
import { createCommandNode } from './widgets/command.js';
import { createAppLauncherNode } from './widgets/appLauncher.js';
import {
    createStaticImageNode,
    createColorBlockNode,
    createAnimatedImageNode,
    createSlideshowNode
} from './widgets/media/index.js';
import { toggleWidgetResizeHandle } from './utils/widgetEditUtils.js';
import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    checkOverlap,
    findEmptySpot,
    getMinRequiredCols,
    calculateResizedDimensions,
    getWidgets,
    saveWidgets,
    deleteCacheFile,
    isAnimatedImageFile,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER
} from './utils/widgetUtils.js';

const BUTTON_PRIMARY = 1;
const BUTTON_SECONDARY = 3;
const DRAG_MOTION_THRESHOLD_PX = 3;
const DEFAULT_STAGE_WIDTH = 1920;
const DEFAULT_STAGE_HEIGHT = 1080;
const DEFAULT_PANEL_HEIGHT_PX = 32;

/**
 * Filters widgets belonging to a specific monitor grid canvas.
 *
 * Widget monitor assignment rules:
 * - `null/undefined/'global'`: In 'each' mode, these belong to the primary
 *   monitor's grid only (to avoid duplicating them across all grids). In all
 *   other modes there is one grid, so they always belong to it.
 * - `'primary'`: Shown only on the primary monitor's grid.
 * - Numeric string (e.g. `'0'`, `'1'`): Shown only on that monitor index's grid.
 */
function getWidgetsForMonitor(widgets, effectiveMonitorIndex, isEachMode = false) {
    if (effectiveMonitorIndex === null || effectiveMonitorIndex === undefined) return widgets;

    const monitors = Main.layoutManager.monitors || [];
    const primaryMon = Main.layoutManager.primaryMonitor;
    const primaryIndex = primaryMon && monitors.length ? Math.max(0, monitors.indexOf(primaryMon)) : 0;
    const isTargetingPrimaryMonitor = (effectiveMonitorIndex === primaryIndex);

    return widgets.filter(widget => {
        if (!widget.monitor || widget.monitor === 'global') {
            // In 'each' mode, global widgets live on the primary monitor's grid only.
            // In single-grid modes the grid IS the target, so always include them.
            return isEachMode ? isTargetingPrimaryMonitor : true;
        }
        if (widget.monitor === 'primary') {
            return isTargetingPrimaryMonitor;
        }
        const monitorIndex = parseInt(widget.monitor, 10);
        if (!isNaN(monitorIndex)) {
            return monitorIndex === effectiveMonitorIndex;
        }
        return true;
    });
}


export const DesktopGrid = GObject.registerClass(
    class DesktopGrid extends St.Widget {
        _init(extensionPath, settings, metadata, targetMonitorIndex = null) {
            super._init({
                name: 'desktopGrid',
                reactive: true,
                x: 0,
                y: 0,
                width: DEFAULT_STAGE_WIDTH,
                height: DEFAULT_STAGE_HEIGHT,
            });

            this.extensionPath = extensionPath;
            this.settings = settings;
            this.metadata = metadata;
            this.targetMonitorIndex = targetMonitorIndex;
            this.signalIds = [];
            this.widgetNodes = new Map();
            this.dragState = null;
            this.editOverlayBoxes = [];
            this.contextMenu = null;
            this._menuManager = null;

            if (!DesktopGrid.activeInstances) {
                DesktopGrid.activeInstances = new Set();
            }
            DesktopGrid.activeInstances.add(this);

            this._setupSettingsListeners();
            this._rebuildGrid();
        }

        static toggleAllGridOverlays(show) {
            if (DesktopGrid.activeInstances) {
                DesktopGrid.activeInstances.forEach(grid => grid._toggleGridOverlay(show));
            }
        }

        destroy() {
            if (DesktopGrid.activeInstances) {
                DesktopGrid.activeInstances.delete(this);
            }

            if (this.signalIds && this.settings) {
                this.signalIds.forEach(id => this.settings.disconnect(id));
                this.signalIds = [];
            }

            if (this.contextMenu) {
                this.contextMenu.destroy();
                this.contextMenu = null;
            }

            if (this._menuManager) {
                this._menuManager = null;
            }

            this.editOverlayBoxes.forEach(box => box.destroy());
            this.editOverlayBoxes = [];

            this.widgetNodes.forEach(node => node.destroy());
            this.widgetNodes.clear();
            this.destroy_all_children();

            super.destroy();
        }

        _setupSettingsListeners() {
            const connectSetting = (key, callback) => {
                const id = this.settings.connect(`changed::${key}`, callback);
                this.signalIds.push(id);
            };

            connectSetting('widgets', () => this._rebuildGrid());
            connectSetting('grid-custom-size', () => this._rebuildGrid());
            connectSetting('grid-columns', () => this._rebuildGrid());
            connectSetting('show-grid', () => this._rebuildGrid());
            connectSetting('border-radius', () => this._rebuildGrid());
            connectSetting('global-border-width', () => this._rebuildGrid());
            connectSetting('global-border-color', () => this._rebuildGrid());
            connectSetting('global-background-color', () => this._rebuildGrid());
            connectSetting('global-foreground-color', () => this._rebuildGrid());
            connectSetting('global-font-family', () => this._rebuildGrid());
            connectSetting('image-animate-gif', () => this._rebuildGrid());
            connectSetting('image-show-caption', () => this._rebuildGrid());
            connectSetting('slideshow-show-caption', () => this._rebuildGrid());
            connectSetting('weather-use-fahrenheit', () => this._rebuildGrid());
            connectSetting('weather-dynamic-color', () => this._rebuildGrid());
            connectSetting('weather-dynamic-image', () => this._rebuildGrid());
            connectSetting('weather-city', () => this._rebuildGrid());
            connectSetting('time-format-24h', () => this._rebuildGrid());
        }

        _getPanelHeight() {
            if (Main.panel && typeof Main.panel.height === 'number' && Main.panel.height > 0)
                return Main.panel.height;
            if (Main.panel && Main.panel.actor && typeof Main.panel.actor.height === 'number' && Main.panel.actor.height > 0)
                return Main.panel.actor.height;
            if (Main.layoutManager && Main.layoutManager.panelBox && typeof Main.layoutManager.panelBox.height === 'number' && Main.layoutManager.panelBox.height > 0)
                return Main.layoutManager.panelBox.height;
            return DEFAULT_PANEL_HEIGHT_PX;
        }

        _getTargetMonitor() {
            const nMonitors = global.display.get_n_monitors();
            if (nMonitors === 0) return null;

            if (this.targetMonitorIndex !== null && typeof this.targetMonitorIndex === 'number') {
                if (this.targetMonitorIndex >= 0 && this.targetMonitorIndex < nMonitors) {
                    return { geom: global.display.get_monitor_geometry(this.targetMonitorIndex), index: this.targetMonitorIndex };
                }
            }

            const monitorSetting = this.settings.get_string('global-monitor') || 'primary';

            if (monitorSetting === 'all') return null;

            if (monitorSetting === 'primary') {
                const primaryIdx = global.display.get_primary_monitor();
                return { geom: global.display.get_monitor_geometry(primaryIdx), index: primaryIdx };
            }

            const monitorIndex = parseInt(monitorSetting, 10);
            if (!isNaN(monitorIndex) && monitorIndex >= 0 && monitorIndex < nMonitors) {
                return { geom: global.display.get_monitor_geometry(monitorIndex), index: monitorIndex };
            }

            const primaryIdx = global.display.get_primary_monitor();
            return { geom: global.display.get_monitor_geometry(primaryIdx), index: primaryIdx };
        }

        _getEffectiveMonitorIndex() {
            if (this.targetMonitorIndex !== null && typeof this.targetMonitorIndex === 'number') {
                return this.targetMonitorIndex;
            }

            const monitorSetting = this.settings.get_string('global-monitor') || 'primary';
            const nMonitors = global.display.get_n_monitors();

            if (monitorSetting === 'all') return null;

            if (monitorSetting === 'primary') {
                return global.display.get_primary_monitor();
            }

            const monitorIndex = parseInt(monitorSetting, 10);
            if (!isNaN(monitorIndex) && monitorIndex >= 0 && monitorIndex < nMonitors) {
                return monitorIndex;
            }

            return global.display.get_primary_monitor();
        }

        _updateCanvasSize() {
            const target = this._getTargetMonitor();
            const panelHeight = this._getPanelHeight();

            if (target) {
                const primaryIdx = global.display.get_primary_monitor();
                const topOffset = (target.index === primaryIdx) ? panelHeight : 0;
                this.set_position(target.geom.x, target.geom.y + topOffset);
                this.set_size(target.geom.width, target.geom.height - topOffset);
            } else {
                this.set_position(0, panelHeight);
                this.set_size(
                    global.stage.width || DEFAULT_STAGE_WIDTH,
                    (global.stage.height || DEFAULT_STAGE_HEIGHT) - panelHeight
                );
            }
        }

        _rebuildGrid() {
            this.widgetNodes.forEach(node => node.destroy());
            this.widgetNodes.clear();
            this.destroy_all_children();

            this._updateCanvasSize();

            const monitorMode = this.settings.get_string('global-monitor') || 'primary';
            const isEachMode = (monitorMode === 'each');

            const widgets = getWidgets(this.settings);
            const activeWidgets = getWidgetsForMonitor(widgets, this._getEffectiveMonitorIndex(), isEachMode);

            const minColsNeeded = getMinRequiredCols(activeWidgets, this.width, this.height);

            const isCustomSize = this.settings.get_boolean('grid-custom-size');
            const gridCols = isCustomSize ? Math.max(minColsNeeded, Math.max(4, this.settings.get_int('grid-columns'))) : COLUMNS_COUNT;
            const showLines = this.settings.get_boolean('show-grid');

            const availableWidth = this.width - (GRID_MARGIN_PX * 2) - (GRID_GAP_PX * (gridCols - 1));
            const cellSize = Math.max(1, Math.floor(availableWidth / gridCols));

            const availableHeight = this.height - (GRID_MARGIN_PX * 2);
            const gridRows = Math.max(1, Math.floor((availableHeight + GRID_GAP_PX) / (cellSize + GRID_GAP_PX)));

            this.cellTotalWidth = cellSize + GRID_GAP_PX;
            this.cellTotalHeight = cellSize + GRID_GAP_PX;
            this.gridMargin = GRID_MARGIN_PX;
            this.gridCols = gridCols;
            this.gridRows = gridRows;

            if (showLines) {
                this._drawGridLines(gridCols, gridRows, cellSize);
            }

            const globalRadius = this.settings.get_int('border-radius');
            const globalBorderWidth = this.settings.get_int('global-border-width');
            const globalBorderColor = this.settings.get_string('global-border-color');
            const globalBgColor = this.settings.get_string('global-background-color');
            const globalFgColor = this.settings.get_string('global-foreground-color');
            const globalFontFamily = this.settings.get_string('global-font-family');
            const globalAnimateGif = this.settings.get_boolean('image-animate-gif');
            const globalImageShowCaption = this.settings.get_boolean('image-show-caption');
            const globalSlideshowShowCaption = this.settings.get_boolean('slideshow-show-caption');
            const globalUseFahrenheit = this.settings.get_boolean('weather-use-fahrenheit');
            const globalWeatherDynamicColor = this.settings.get_boolean('weather-dynamic-color');
            const globalWeatherDynamicImage = this.settings.get_boolean('weather-dynamic-image');
            const globalWeatherCity = this.settings.get_string('weather-city');
            const globalUse24h = this.settings.get_boolean('time-format-24h');

            let modified = false;
            const placedWidgets = [];

            const sortedWidgets = activeWidgets.slice().sort((a, b) => {
                const posA = ((a.y || 0) * gridCols) + (a.x || 0);
                const posB = ((b.y || 0) * gridCols) + (b.x || 0);
                return posA - posB;
            });

            sortedWidgets.forEach(widgetData => {
                const effectiveWidth = Math.max(1, Math.min(widgetData.width || 2, gridCols));
                const effectiveHeight = Math.max(1, Math.min(widgetData.height || 2, gridRows));

                let effectiveX = Math.max(0, Math.min(widgetData.x || 0, gridCols - effectiveWidth));
                let effectiveY = Math.max(0, Math.min(widgetData.y || 0, gridRows - effectiveHeight));

                if (checkOverlap(effectiveX, effectiveY, effectiveWidth, effectiveHeight, placedWidgets)) {
                    const freeSpot = findEmptySpot(placedWidgets, effectiveWidth, effectiveHeight, gridCols, gridRows);
                    if (freeSpot) {
                        effectiveX = freeSpot.x;
                        effectiveY = freeSpot.y;
                    }
                }

                if (effectiveX !== widgetData.x || effectiveY !== widgetData.y || effectiveWidth !== widgetData.width || effectiveHeight !== widgetData.height) {
                    widgetData.x = effectiveX;
                    widgetData.y = effectiveY;
                    widgetData.width = effectiveWidth;
                    widgetData.height = effectiveHeight;
                    modified = true;
                }

                placedWidgets.push(widgetData);

                const widgetWidth = (effectiveWidth * cellSize) + ((effectiveWidth - 1) * GRID_GAP_PX);
                const widgetHeight = (effectiveHeight * cellSize) + ((effectiveHeight - 1) * GRID_GAP_PX);
                const posX = GRID_MARGIN_PX + (effectiveX * (cellSize + GRID_GAP_PX));
                const posY = GRID_MARGIN_PX + (effectiveY * (cellSize + GRID_GAP_PX));

                const isBorderRadiusOverridden = Boolean(widgetData.overrideBorderRadius ?? widgetData.overrideRadius);
                const isBorderWidthOverridden = Boolean(widgetData.overrideBorderWidth ?? widgetData.overrideBorder);

                const resolvedData = Object.assign({}, widgetData, {
                    appliedBorderRadius: isBorderRadiusOverridden ? widgetData.borderRadius : globalRadius,
                    appliedBorderWidth: isBorderWidthOverridden ? widgetData.borderWidth : globalBorderWidth,
                    appliedBorderColor: isBorderWidthOverridden ? widgetData.borderColor : globalBorderColor,
                    globalBackgroundColor: globalBgColor,
                    globalForegroundColor: globalFgColor,
                    globalFontFamily: globalFontFamily,
                    globalAnimateGif: globalAnimateGif,
                    globalImageShowCaption: globalImageShowCaption,
                    globalSlideshowShowCaption: globalSlideshowShowCaption,
                    globalUseFahrenheit: globalUseFahrenheit,
                    globalWeatherDynamicColor: globalWeatherDynamicColor,
                    globalWeatherDynamicImage: globalWeatherDynamicImage,
                    globalWeatherCity: globalWeatherCity,
                    globalUse24h: globalUse24h,
                    extensionPath: this.extensionPath,
                });

                const node = this._createWidgetNode(resolvedData, widgetWidth, widgetHeight, posX, posY);
                if (node) {
                    node.widgetData = widgetData;
                    node.gridOverlayCallback = (showOverlay) => DesktopGrid.toggleAllGridOverlays(showOverlay);
                    this._attachDragHandlers(node, widgetData);
                    this.add_child(node);
                    this.widgetNodes.set(widgetData.id, node);
                }
            });

            if (modified) {
                saveWidgets(this.settings, widgets);
            }
        }

        _drawRoundedRect(ctx, x, y, w, h, r) {
            const deg = Math.PI / 180;
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arc(x + w - r, y + r, r, -90 * deg, 0 * deg);
            ctx.lineTo(x + w, y + h - r);
            ctx.arc(x + w - r, y + h - r, r, 0 * deg, 90 * deg);
            ctx.lineTo(x + r, y + h);
            ctx.arc(x + r, y + h - r, r, 90 * deg, 180 * deg);
            ctx.lineTo(x, y + r);
            ctx.arc(x + r, y + r, r, 180 * deg, -90 * deg);
            ctx.closePath();
        }

        _createGridOverlay(red, green, blue, alpha) {
            const gridCols = this.gridCols || COLUMNS_COUNT;
            const gridRows = this.gridRows || ROWS_COUNT;
            const step = this.cellTotalWidth;
            const cellSize = step - GRID_GAP_PX;
            const overlayWidth = gridCols * step + GRID_GAP_PX;
            const overlayHeight = gridRows * step + GRID_GAP_PX;
            const cornerRadius = Math.min(GRID_GAP_PX, cellSize / 2);

            const canvas = new St.DrawingArea({
                x: this.gridMargin - GRID_GAP_PX,
                y: this.gridMargin - GRID_GAP_PX,
                width: overlayWidth,
                height: overlayHeight,
            });

            canvas.connect('repaint', area => {
                const ctx = area.get_context();
                const [w, h] = area.get_surface_size();

                ctx.setOperator(CAIRO_OPERATOR_OVER);
                ctx.setSourceRGBA(red, green, blue, alpha);
                ctx.rectangle(0, 0, w, h);
                ctx.fill();

                ctx.setOperator(CAIRO_OPERATOR_CLEAR);
                for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        const cellX = GRID_GAP_PX + c * step;
                        const cellY = GRID_GAP_PX + r * step;
                        this._drawRoundedRect(ctx, cellX, cellY, cellSize, cellSize, cornerRadius);
                        ctx.fill();
                    }
                }

                ctx.$dispose();
            });

            canvas.queue_repaint();
            return canvas;
        }

        _drawGridLines() {
            const canvas = this._createGridOverlay(1, 1, 1, 0.1);
            this.add_child(canvas);
        }

        _createWidgetNode(data, width, height, x, y) {
            const use24h = (data.use24h === false) ? false : (data.globalUse24h !== false);
            const dynamicColor = data.dynamicColor !== undefined ? data.dynamicColor : (data.globalWeatherDynamicColor !== false);
            const dynamicImage = data.dynamicImage !== undefined ? data.dynamicImage : (data.globalWeatherDynamicImage !== false);

            switch (data.type) {
                case 'time':
                    return createTimeNode(data, width, height, x, y, use24h);
                case 'weather':
                    return createWeatherNode(data, width, height, x, y, dynamicColor, dynamicImage);
                case 'music':
                    return createMusicNode(data, width, height, x, y);
                case 'notes':
                    return createNotesNode(data, width, height, x, y);
                case 'clipboard':
                    return createClipboardNode(data, width, height, x, y);
                case 'cpu-ram':
                    return createCpuRamNode(data, width, height, x, y);
                case 'network-speed':
                    return createNetworkSpeedNode(data, width, height, x, y);
                case 'system-dashboard':
                    return createSystemDashboardNode(data, width, height, x, y);
                case 'pomodoro':
                    return createPomodoroNode(data, width, height, x, y);
                case 'command':
                    return createCommandNode(data, width, height, x, y);
                case 'app-launcher':
                    return createAppLauncherNode(data, width, height, x, y);
                case 'calendar':
                    return createCalendarNode(data, width, height, x, y);
                case 'quotes':
                    return createQuotesNode(data, width, height, x, y);
                case 'slideshow':
                    return createSlideshowNode(data, width, height, x, y);
                case 'color_block':
                    return createColorBlockNode(data, width, height, x, y);
                case 'image':
                    if (data.imagePath && isAnimatedImageFile(data.imagePath)) {
                        const shouldAnimate = data.animateGif !== undefined ? data.animateGif : (data.globalAnimateGif !== false);
                        return createAnimatedImageNode(data, width, height, x, y, shouldAnimate);
                    }
                    return createStaticImageNode(data, width, height, x, y);
                default:
                    console.error(`Unknown widget type: ${data.type}`);
                    return null;
            }
        }

        _attachDragHandlers(node, widgetData) {
            let pressX = 0;
            let pressY = 0;
            let isDragging = false;
            let dragMotionId = 0;
            let dragReleaseId = 0;

            node.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === BUTTON_SECONDARY) {
                    this._openWidgetContextMenu(event, node, widgetData);
                    return Clutter.EVENT_STOP;
                }

                if (event.get_button() === BUTTON_PRIMARY) {
                    [pressX, pressY] = event.get_coords();
                    const [startX, startY] = [node.x, node.y];

                    if (dragMotionId) { global.stage.disconnect(dragMotionId); dragMotionId = 0; }
                    if (dragReleaseId) { global.stage.disconnect(dragReleaseId); dragReleaseId = 0; }

                    dragMotionId = global.stage.connect('motion-event', (_stage, ev) => {
                        const state = ev.get_state();
                        if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                            endDrag();
                            return Clutter.EVENT_PROPAGATE;
                        }

                        const [curX, curY] = ev.get_coords();
                        const dx = curX - pressX;
                        const dy = curY - pressY;

                        if (!isDragging && (Math.abs(dx) > DRAG_MOTION_THRESHOLD_PX || Math.abs(dy) > DRAG_MOTION_THRESHOLD_PX)) {
                            isDragging = true;
                            DesktopGrid.toggleAllGridOverlays(true);
                        }

                        if (isDragging) {
                            node.set_position(startX + dx, startY + dy);
                            return Clutter.EVENT_STOP;
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });

                    const endDrag = () => {
                        if (dragMotionId) { global.stage.disconnect(dragMotionId); dragMotionId = 0; }
                        if (dragReleaseId) { global.stage.disconnect(dragReleaseId); dragReleaseId = 0; }

                        if (isDragging) {
                            isDragging = false;
                            DesktopGrid.toggleAllGridOverlays(false);

                            const widgets = getWidgets(this.settings);
                            const targetWidget = widgets.find(w => w.id === widgetData.id);

                            if (targetWidget) {
                                const monitorSetting = this.settings.get_string('global-monitor') || 'primary';
                                const monitors = Main.layoutManager.monitors || [];

                                // Absolute stage position of the widget's top-left corner and center
                                const widgetStageX = this.x + node.x;
                                const widgetStageY = this.y + node.y;
                                const widgetCenterX = widgetStageX + (node.width / 2);
                                const widgetCenterY = widgetStageY + (node.height / 2);

                                let targetMonitorIndex = null;
                                let targetMonitor = null;

                                if (monitorSetting === 'each' && monitors.length > 1) {
                                    for (let i = 0; i < monitors.length; i++) {
                                        const mon = monitors[i];
                                        if (widgetCenterX >= mon.x && widgetCenterX < mon.x + mon.width &&
                                            widgetCenterY >= mon.y && widgetCenterY < mon.y + mon.height) {
                                            targetMonitorIndex = i;
                                            targetMonitor = mon;
                                            break;
                                        }
                                    }
                                }

                                if (targetMonitorIndex !== null && targetMonitor) {
                                    const primaryMon = Main.layoutManager.primaryMonitor;
                                    const isPrimary = primaryMon ? (targetMonitor === primaryMon) : (targetMonitorIndex === 0);
                                    const topOffset = isPrimary ? this._getPanelHeight() : 0;

                                    const localX = widgetStageX - targetMonitor.x;
                                    const localY = widgetStageY - (targetMonitor.y + topOffset);

                                    const targetMonWidgets = getWidgetsForMonitor(widgets, targetMonitorIndex, true);
                                    const otherWidgetsOnTargetMon = targetMonWidgets.filter(widget => widget.id !== widgetData.id);

                                    const isCustomSize = this.settings.get_boolean('grid-custom-size');
                                    const minColsNeeded = getMinRequiredCols(targetMonWidgets, targetMonitor.width, targetMonitor.height - topOffset);
                                    const gridCols = isCustomSize ? Math.max(minColsNeeded, Math.max(4, this.settings.get_int('grid-columns'))) : COLUMNS_COUNT;

                                    const availableWidth = targetMonitor.width - (GRID_MARGIN_PX * 2) - (GRID_GAP_PX * (gridCols - 1));
                                    const cellSize = Math.max(1, Math.floor(availableWidth / gridCols));
                                    const cellTotalWidth = cellSize + GRID_GAP_PX;
                                    const cellTotalHeight = cellTotalWidth;

                                    const availableHeight = (targetMonitor.height - topOffset) - (GRID_MARGIN_PX * 2);
                                    const gridRows = Math.max(1, Math.floor((availableHeight + GRID_GAP_PX) / cellTotalWidth));

                                    const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((localX - GRID_MARGIN_PX) / cellTotalWidth)));
                                    const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((localY - GRID_MARGIN_PX) / cellTotalHeight)));

                                    if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgetsOnTargetMon)) {
                                        targetWidget.x = targetCol;
                                        targetWidget.y = targetRow;
                                        targetWidget.monitor = isPrimary ? 'primary' : String(targetMonitorIndex);
                                        saveWidgets(this.settings, widgets);
                                    }
                                } else {
                                    const activeWidgets = getWidgetsForMonitor(widgets, this.targetMonitorIndex, true);
                                    const gridCols = this.gridCols || COLUMNS_COUNT;
                                    const gridRows = this.gridRows || ROWS_COUNT;
                                    const otherWidgets = activeWidgets.filter(widget => widget.id !== widgetData.id);

                                    const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((node.x - GRID_MARGIN_PX) / this.cellTotalWidth)));
                                    const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((node.y - GRID_MARGIN_PX) / this.cellTotalHeight)));

                                    if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgets)) {
                                        targetWidget.x = targetCol;
                                        targetWidget.y = targetRow;
                                        saveWidgets(this.settings, widgets);
                                    }
                                }
                            }
                            this._rebuildGrid();
                        }
                    };

                    dragReleaseId = global.stage.connect('button-release-event', (_stage, ev) => {
                        if (ev.get_button() === BUTTON_PRIMARY) {
                            endDrag();
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                }
                return Clutter.EVENT_PROPAGATE;
            });

            node.connect('destroy', () => {
                if (dragMotionId) global.stage.disconnect(dragMotionId);
                if (dragReleaseId) global.stage.disconnect(dragReleaseId);
            });
        }

        _onWidgetResized(widgetId, newCols, newRows, newX) {
            const allWidgets = getWidgets(this.settings);
            const monitorMode = this.settings.get_string('global-monitor') || 'primary';
            const isEachMode = (monitorMode === 'each');
            const activeWidgets = getWidgetsForMonitor(allWidgets, this._getEffectiveMonitorIndex(), isEachMode);
            const widget = activeWidgets.find(activeWidget => activeWidget.id === widgetId);
            if (!widget) return;

            const otherWidgets = activeWidgets.filter(activeWidget => activeWidget.id !== widgetId);
            const gridCols = this.gridCols || COLUMNS_COUNT;
            const gridRows = this.gridRows || ROWS_COUNT;
            const { validCols, validRows, validX } = calculateResizedDimensions(widget, newCols, newRows, newX, otherWidgets, gridCols, gridRows);

            if (!checkOverlap(validX, widget.y, validCols, validRows, otherWidgets)) {
                const targetWidget = allWidgets.find(existingWidget => existingWidget.id === widgetId);
                if (targetWidget) {
                    targetWidget.width = validCols;
                    targetWidget.height = validRows;
                    targetWidget.x = validX;
                    saveWidgets(this.settings, allWidgets);
                }
            }
            this._rebuildGrid();
        }

        _onWidgetDeleted(widgetId) {
            const widgets = getWidgets(this.settings);
            const targetWidget = widgets.find(widget => widget.id === widgetId);
            if (targetWidget) {
                if (targetWidget.type === 'notes') {
                    deleteCacheFile('notes', widgetId);
                } else if (targetWidget.type === 'clipboard') {
                    deleteCacheFile('clipboard', widgetId);
                }
            }
            const remainingWidgets = widgets.filter(widget => widget.id !== widgetId);
            saveWidgets(this.settings, remainingWidgets);
        }

        _toggleGridOverlay(show) {
            if (show) {
                if (this.editOverlayBoxes.length > 0) return;
                if (this.settings.get_boolean('show-grid')) return;

                const canvas = this._createGridOverlay(1, 1, 1, 0.1);
                this.insert_child_at_index(canvas, 0);
                this.editOverlayBoxes.push(canvas);
            } else {
                this.editOverlayBoxes.forEach(box => box.destroy());
                this.editOverlayBoxes = [];
            }
        }

        _createPopupMenuAt(event) {
            if (this.contextMenu) {
                this.contextMenu.destroy();
                this.contextMenu = null;
            }

            const [stageX, stageY] = event.get_coords();
            const dummyActor = new St.Widget({ x: stageX, y: stageY, width: 1, height: 1 });
            Main.uiGroup.add_child(dummyActor);

            this.contextMenu = new PopupMenu.PopupMenu(dummyActor, 0.0, St.Side.TOP);
            this.contextMenu.connect('open-state-changed', (_menu, isOpen) => {
                if (!isOpen) {
                    dummyActor.destroy();
                    this.contextMenu = null;
                }
            });

            if (!this._menuManager) {
                this._menuManager = new PopupMenu.PopupMenuManager(this);
            }
            this._menuManager.addMenu(this.contextMenu);

            return this.contextMenu;
        }

        _openPreferences(targetWidgetId = null) {
            const extensionUuid = this.metadata?.uuid || 'gridgets@rebatnaath.github.com';
            if (targetWidgetId) {
                this.settings.set_string('open-edit-widget-id', targetWidgetId);
            }
            if (Main.extensionManager) {
                Main.extensionManager.openExtensionPreferences(extensionUuid);
            } else {
                Gio.Subprocess.new(['gnome-extensions', 'prefs', extensionUuid], Gio.SubprocessFlags.NONE);
            }
        }

        _launchSubprocess(args) {
            try {
                Gio.Subprocess.new(args, Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.error(`Failed to launch ${args[0]}:`, e);
            }
        }

        _openWidgetContextMenu(event, node, widgetData) {
            const menu = this._createPopupMenuAt(event);

            const isWeather = widgetData.type === 'weather';
            const weatherLayout = widgetData.layout || 'standard';
            const isResizeable = !isWeather || (weatherLayout === 'simple');
            if (isResizeable) {
                const isResizing = !!node.actionOverlay;
                const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize Widget');
                resizeItem.connect('activate', () => {
                    const allWidgets = getWidgets(this.settings);
                    const gridCols = this.gridCols || COLUMNS_COUNT;
                    const gridRows = this.gridRows || ROWS_COUNT;
                    toggleWidgetResizeHandle(
                        node,
                        widgetData,
                        this.cellTotalWidth,
                        this.cellTotalHeight,
                        this.extensionPath,
                        (newCols, newRows, newX) => this._onWidgetResized(widgetData.id, newCols, newRows, newX),
                        allWidgets,
                        gridCols,
                        gridRows
                    );
                });
                menu.addMenuItem(resizeItem);
            }

            const configItem = new PopupMenu.PopupMenuItem('Configure Widget...');
            configItem.connect('activate', () => this._openPreferences(widgetData.id));
            menu.addMenuItem(configItem);

            const deleteItem = new PopupMenu.PopupMenuItem('Delete Widget');
            deleteItem.connect('activate', () => this._onWidgetDeleted(widgetData.id));
            menu.addMenuItem(deleteItem);

            Main.uiGroup.add_child(menu.actor);
            menu.open(BoxPointer.PopupAnimation.FULL);
        }

        vfunc_button_press_event(event) {
            if (event.get_button() === BUTTON_SECONDARY) {
                this._openContextMenu(event);
                return Clutter.EVENT_STOP;
            }
            return super.vfunc_button_press_event(event);
        }

        _openContextMenu(event) {
            const menu = this._createPopupMenuAt(event);

            const bgItem = new PopupMenu.PopupMenuItem('Change Background...');
            bgItem.connect('activate', () => this._launchSubprocess(['gnome-control-center', 'background']));
            menu.addMenuItem(bgItem);

            const displayItem = new PopupMenu.PopupMenuItem('Display Settings');
            displayItem.connect('activate', () => this._launchSubprocess(['gnome-control-center', 'display']));
            menu.addMenuItem(displayItem);

            const settingsItem = new PopupMenu.PopupMenuItem('GNOME Settings');
            settingsItem.connect('activate', () => this._launchSubprocess(['gnome-control-center']));
            menu.addMenuItem(settingsItem);

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const prefsItem = new PopupMenu.PopupMenuItem('Gridgets Preferences...');
            prefsItem.connect('activate', () => this._openPreferences());
            menu.addMenuItem(prefsItem);

            const toggleLinesItem = new PopupMenu.PopupMenuItem('Toggle Grid Lines');
            toggleLinesItem.connect('activate', () => {
                const current = this.settings.get_boolean('show-grid');
                this.settings.set_boolean('show-grid', !current);
            });
            menu.addMenuItem(toggleLinesItem);

            Main.uiGroup.add_child(menu.actor);
            menu.open(BoxPointer.PopupAnimation.FULL);
        }
    });
