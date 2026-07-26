/**
 * ============================================================================
 * DESKTOP GRID ENGINE
 * 
 * Manages the background desktop grid, canvas sizing, widget placement, drag/drop,
 * context menu actions, and GSettings dynamic updates for Gridgets.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import { createTimeNode } from './widgets/time.js';
import { createWeatherNode } from './widgets/weather/index.js';
import { createMusicNode } from './widgets/music/index.js';
import { createNotesNode } from './widgets/notes.js';
import { createClipboardNode } from './widgets/clipboard.js';
import { createCpuRamNode } from './widgets/cpuRam.js';
import { createNetworkSpeedNode } from './widgets/network.js';
import { createPomodoroNode } from './widgets/pomodoro.js';
import { createCommandNode } from './widgets/command.js';
import { createSlideshowNode } from './widgets/media/slideshow.js';
import { createAnimatedGifNode } from './widgets/media/gif.js';
import { createStaticImageNode, createColorBlockNode } from './widgets/media/image.js';
import { toggleWidgetResizeHandle } from './utils/widgetEditUtils.js';

import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    saveJsonToFile,
    checkOverlap,
    findEmptySpot,
    getMinRequiredCols,
    calculateResizedDimensions,
    getWidgets,
    saveWidgets
} from './utils/widgetUtils.js';

/** Clutter mouse button constants */
const BUTTON_PRIMARY = 1;
const BUTTON_SECONDARY = 3;

/** Motion threshold for drag detection */
const DRAG_MOTION_THRESHOLD_PX = 3;

/** Default screen dimension fallbacks */
const DEFAULT_STAGE_WIDTH = 1920;
const DEFAULT_STAGE_HEIGHT = 1080;

/** Default grid layout metrics */
const DEFAULT_PANEL_HEIGHT_PX = 32;


export const DesktopGrid = GObject.registerClass(
class DesktopGrid extends St.Widget {
    _init(extensionPath, settings, metadata) {
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
        this.signalIds = [];
        this.widgetNodes = new Map();
        this.dragState = null;
        this.editOverlayBoxes = [];
        this.contextMenu = null;
        this._menuManager = null;

        this._setupSettingsListeners();

        this.connect('destroy', () => {
            this._cleanup();
        });

        this._rebuildGrid();
    }

    _cleanup() {
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

    _updateCanvasSize() {
        const primaryMonitor = Main.layoutManager.primaryMonitor;
        const panelHeight = this._getPanelHeight();

        if (primaryMonitor) {
            this.set_position(primaryMonitor.x, primaryMonitor.y + panelHeight);
            this.set_size(primaryMonitor.width, primaryMonitor.height - panelHeight);
        } else {
            this.set_position(0, panelHeight);
            this.set_size(global.stage.width || DEFAULT_STAGE_WIDTH, (global.stage.height || DEFAULT_STAGE_HEIGHT) - panelHeight);
        }
    }

    _rebuildGrid() {
        this.widgetNodes.forEach(node => node.destroy());
        this.widgetNodes.clear();
        this.destroy_all_children();

        this._updateCanvasSize();

        const widgets = getWidgets(this.settings);
        const minColsNeeded = getMinRequiredCols(widgets, this.width, this.height);

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

        const sortedWidgets = widgets.slice().sort((a, b) => {
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

            const resolvedData = Object.assign({}, widgetData, {
                appliedBorderRadius: (widgetData.overrideBorderRadius || widgetData.overrideRadius) ? widgetData.borderRadius : globalRadius,
                appliedBorderWidth: (widgetData.overrideBorderWidth || widgetData.overrideBorder) ? widgetData.borderWidth : globalBorderWidth,
                appliedBorderColor: (widgetData.overrideBorderWidth || widgetData.overrideBorder) ? widgetData.borderColor : globalBorderColor,
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
                node.gridOverlayCallback = (showOverlay) => this._toggleGridOverlay(showOverlay);
                this._attachDragHandlers(node, widgetData);
                this.add_child(node);
                this.widgetNodes.set(widgetData.id, node);
            }
        });

        if (modified) {
            saveWidgets(this.settings, widgets);
        }
    }

    _drawGridLines(cols, rows, cellSize) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellX = GRID_MARGIN_PX + (c * (cellSize + GRID_GAP_PX));
                const cellY = GRID_MARGIN_PX + (r * (cellSize + GRID_GAP_PX));
                const cellBox = new St.Widget({
                    style: 'border: 1px dashed rgba(255, 255, 255, 0.15); background-color: rgba(255, 255, 255, 0.02);',
                    x: cellX,
                    y: cellY,
                    width: cellSize,
                    height: cellSize,
                });
                this.add_child(cellBox);
            }
        }
    }

    _createWidgetNode(data, width, height, x, y) {
        const use24h = data.use24h !== undefined ? data.use24h : (data.globalUse24h !== false);
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
            case 'pomodoro':
                return createPomodoroNode(data, width, height, x, y);
            case 'command':
                return createCommandNode(data, width, height, x, y);
            case 'slideshow':
                return createSlideshowNode(data, width, height, x, y);
            case 'color_block':
                return createColorBlockNode(data, width, height, x, y);
            case 'image':
                if (data.imagePath && data.imagePath.toLowerCase().endsWith('.gif')) {
                    const shouldAnimate = data.animateGif !== undefined ? data.animateGif : (data.globalAnimateGif !== false);
                    return createAnimatedGifNode(data, width, height, x, y, shouldAnimate);
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

        node.connect('button-press-event', (actor, event) => {
            if (event.get_button() === BUTTON_SECONDARY) {
                this._openWidgetContextMenu(event, node, widgetData);
                return Clutter.EVENT_STOP;
            }

            if (event.get_button() === BUTTON_PRIMARY) {
                [pressX, pressY] = event.get_coords();
                const [startX, startY] = [node.x, node.y];

                if (dragMotionId) { global.stage.disconnect(dragMotionId); dragMotionId = 0; }
                if (dragReleaseId) { global.stage.disconnect(dragReleaseId); dragReleaseId = 0; }

                dragMotionId = global.stage.connect('motion-event', (stage, ev) => {
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
                        this._toggleGridOverlay(true);
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
                        this._toggleGridOverlay(false);

                        const gridCols = this.gridCols || COLUMNS_COUNT;
                        const gridRows = this.gridRows || ROWS_COUNT;

                        const widgets = getWidgets(this.settings);
                        const targetWidget = widgets.find(w => w.id === widgetData.id);
                        const otherWidgets = widgets.filter(w => w.id !== widgetData.id);

                        if (targetWidget) {
                            const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((node.x - GRID_MARGIN_PX) / this.cellTotalWidth)));
                            const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((node.y - GRID_MARGIN_PX) / this.cellTotalHeight)));

                            if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgets)) {
                                targetWidget.x = targetCol;
                                targetWidget.y = targetRow;
                                saveWidgets(this.settings, widgets);
                            }
                        }
                        this._rebuildGrid();
                    }
                };

                dragReleaseId = global.stage.connect('button-release-event', (stage, ev) => {
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
        const widgets = getWidgets(this.settings);
        const widget = widgets.find(w => w.id === widgetId);
        if (!widget) return;

        const otherWidgets = widgets.filter(w => w.id !== widgetId);
        const gridCols = this.gridCols || COLUMNS_COUNT;
        const gridRows = this.gridRows || ROWS_COUNT;
        const { validCols, validRows, validX } = calculateResizedDimensions(widget, newCols, newRows, newX, otherWidgets, gridCols, gridRows);

        if (!checkOverlap(validX, widget.y, validCols, validRows, otherWidgets)) {
            widget.width = validCols;
            widget.height = validRows;
            widget.x = validX;
            saveWidgets(this.settings, widgets);
        }
        this._rebuildGrid();
    }

    _onWidgetDeleted(widgetId) {
        const widgets = getWidgets(this.settings);
        const filtered = widgets.filter(w => w.id !== widgetId);
        saveWidgets(this.settings, filtered);
    }

    _toggleGridOverlay(show) {
        if (show) {
            if (this.editOverlayBoxes.length > 0) return;
            const gridCols = this.gridCols || COLUMNS_COUNT;
            const gridRows = this.gridRows || ROWS_COUNT;
            const gridGap = GRID_GAP_PX;
            const cellWidth = this.cellTotalWidth - gridGap;
            const cellHeight = this.cellTotalHeight - gridGap;

            for (let r = 0; r < gridRows; r++) {
                for (let c = 0; c < gridCols; c++) {
                    const cellX = this.gridMargin + (c * this.cellTotalWidth);
                    const cellY = this.gridMargin + (r * this.cellTotalHeight);
                    const box = new St.Widget({
                        style: 'background-color: rgba(64, 160, 255, 0.15); border: 1px dashed rgba(64, 160, 255, 0.5);',
                        x: cellX,
                        y: cellY,
                        width: cellWidth,
                        height: cellHeight,
                    });
                    this.add_child(box);
                    this.editOverlayBoxes.push(box);
                }
            }
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
        this.contextMenu.connect('open-state-changed', (menu, isOpen) => {
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
        if (Main.extensionManager && typeof Main.extensionManager.openExtensionPreferences === 'function') {
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

        if (widgetData.type !== 'weather') {
            const isResizing = !!node.actionOverlay;
            const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize Widget');
            resizeItem.connect('activate', () => {
                const allWidgets = getWidgets(this.settings);
                toggleWidgetResizeHandle(
                    node,
                    widgetData,
                    this.cellTotalWidth,
                    this.cellTotalHeight,
                    this.extensionPath,
                    (newCols, newRows, newX) => this._onWidgetResized(widgetData.id, newCols, newRows, newX),
                    allWidgets
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
