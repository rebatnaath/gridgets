import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_GAP_PX,
    GRID_MARGIN_PX,
    checkOverlap,
    findEmptySpot,
    getWidgets,
    saveWidgets,
    serializeWidgets,
    resolveWidgetOverrides,
    readGlobalSettings,
    calculateGridDimensions,
    parseCssColor,
    resolveWidgetSizePreset,
} from '../utils/widgetUtils.js';
import {
    DEFAULT_STAGE_WIDTH,
    DEFAULT_STAGE_HEIGHT,
    BUTTON_SECONDARY,
} from './constants.js';
import {
    getWidgetsForMonitor,
    getPanelHeight,
    getTargetMonitor,
    getEffectiveMonitorIndex,
} from './helpers.js';
import { createGridOverlay } from './gridRenderer.js';
import { createWidgetNode } from './widgetFactory.js';
import { attachDragHandlers } from './dragDrop.js';
import {
    openContextMenu,
} from './contextMenu.js';
import { isActorDestroyed, watchActorLifecycle } from '../utils/actorLifecycle.js';
import { resolveWeatherLayoutVariant } from '../widgets/weather/weatherCommon.js';

const GRID_LINE_ALPHA = 0.25;
const EDIT_OVERLAY_ALPHA = 0.3;

export const DesktopGrid = GObject.registerClass(
    class DesktopGrid extends St.Widget {
        _init(extensionPath, settings, metadata, targetMonitorIndex = null, interfaceSettings = null) {
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
            // Shared shell-side schema owned by the extension; created only as a fallback.
            this._ownInterfaceSettings = !interfaceSettings;
            this.interfaceSettings = interfaceSettings || Gio.Settings.new('org.gnome.desktop.interface');
            this.targetMonitorIndex = targetMonitorIndex;
            this.signalIds = [];
            this.widgetNodes = new Map();
            this._nodeConfigs = new Map();
            this._gridLineCanvas = null;
            this.editOverlayCanvases = [];
            this.contextMenu = null;
            this._menuManager = null;
            this._lastAppliedWidgetsJson = null;

            if (!DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances = new Set();
            }
            DesktopGrid._activeInstances.add(this);

            this._setupSettingsListeners();
            this._rebuildGrid();

            this._backgroundPressId = this.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === BUTTON_SECONDARY) {
                    openContextMenu(this, event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        static toggleAllGridOverlays(show) {
            if (DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances.forEach(grid => grid._toggleGridOverlay(show));
            }
        }

        destroy() {
            if (this._contextMenuCloseIdleId) {
                GLib.Source.remove(this._contextMenuCloseIdleId);
                this._contextMenuCloseIdleId = null;
            }

            if (DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances.delete(this);
            }

            if (this.signalIds && this.settings) {
                this.signalIds.forEach(id => this.settings.disconnect(id));
                this.signalIds = [];
            }

            this.interfaceSettings = null;

            if (this.contextMenu) {
                this.contextMenu.destroy();
                this.contextMenu = null;
            }

            if (this._contextMenuDummyActor) {
                const dummyParent = this._contextMenuDummyActor.get_parent();
                if (dummyParent) dummyParent.remove_child(this._contextMenuDummyActor);
                this._contextMenuDummyActor = null;
            }

            if (this._backgroundPressId) {
                this.disconnect(this._backgroundPressId);
                this._backgroundPressId = 0;
            }

            this._menuManager = null;

            this.editOverlayCanvases.forEach(box => box.destroy());
            this.editOverlayCanvases = [];

            this.widgetNodes.forEach(node => node.destroy());
            this.widgetNodes.clear();
            this._nodeConfigs.clear();
            this._gridLineCanvas = null;
            this.destroy_all_children();

            super.destroy();
        }

        _setupSettingsListeners() {
            const connectSetting = (key, callback) => {
                const id = this.settings.connect(`changed::${key}`, callback);
                this.signalIds.push(id);
            };

            connectSetting('widgets', () => {
                const widgetsJson = this.settings.get_string('widgets');
                if (widgetsJson === this._lastAppliedWidgetsJson)
                    return;
                this._applyWidgetChanges();
            });
            // Global style keys are baked at construction, so rebuild instead of patching.
            connectSetting('global-background-color', () => this._rebuildGrid());
            connectSetting('global-foreground-color', () => this._rebuildGrid());
            connectSetting('global-font-family', () => this._rebuildGrid());
            connectSetting('accent-color-override', () => this._rebuildGrid());
            connectSetting('image-animate-gif', () => this._rebuildGrid());
            connectSetting('image-show-caption', () => this._rebuildGrid());
            connectSetting('slideshow-show-caption', () => this._rebuildGrid());
            connectSetting('weather-use-fahrenheit', () => this._rebuildGrid());
            connectSetting('weather-dynamic-color', () => this._rebuildGrid());
            connectSetting('weather-dynamic-image', () => this._rebuildGrid());
            connectSetting('show-grid', () => this._toggleGridLines());
        }

        _updateStageSize() {
            const target = getTargetMonitor(this.targetMonitorIndex, this.settings);
            const panelHeight = getPanelHeight();

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

        _repositionNode(widgetId, newCols, newRows, newX, newY) {
            const node = this.widgetNodes.get(widgetId);
            if (!node || isActorDestroyed(node)) return;

            const cellSize = this.cellTotalWidth - GRID_GAP_PX;
            const widgetWidth = (newCols * cellSize) + ((newCols - 1) * GRID_GAP_PX);
            const widgetHeight = (newRows * cellSize) + ((newRows - 1) * GRID_GAP_PX);
            const posX = GRID_MARGIN_PX + (newX * this.cellTotalWidth);
            const posY = GRID_MARGIN_PX + (newY * this.cellTotalHeight);

            node.set_size(widgetWidth, widgetHeight);
            node.set_position(posX, posY);
        }

        _resolveGridLayout() {
            const { cellSize, cellTotalWidth, cellTotalHeight, gridRows } = calculateGridDimensions(this.width, this.height, COLUMNS_COUNT);
            return { gridCols: COLUMNS_COUNT, gridRows, cellSize, cellTotalWidth, cellTotalHeight };
        }

        _layoutWidgetsOnGrid(activeWidgets, gridCols, gridRows, cellSize, cellTotalWidth, cellTotalHeight) {
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
            });

            return { sortedWidgets, modified };
        }

        _createAndAttachWidget(widgetData, cellSize, cellTotalWidth, cellTotalHeight, globalSettings) {
            const widgetWidth = (widgetData.width * cellSize) + ((widgetData.width - 1) * GRID_GAP_PX);
            const widgetHeight = (widgetData.height * cellSize) + ((widgetData.height - 1) * GRID_GAP_PX);
            const posX = GRID_MARGIN_PX + (widgetData.x * cellTotalWidth);
            const posY = GRID_MARGIN_PX + (widgetData.y * cellTotalHeight);

            const resolvedData = Object.assign({}, resolveWidgetOverrides(widgetData, globalSettings), {
                globalAnimateGif: globalSettings.globalAnimateGif,
                globalImageShowCaption: globalSettings.globalImageShowCaption,
                globalSlideshowShowCaption: globalSettings.globalSlideshowShowCaption,
                globalUseFahrenheit: globalSettings.globalUseFahrenheit,
                globalWeatherDynamicColor: globalSettings.globalWeatherDynamicColor,
                globalWeatherDynamicImage: globalSettings.globalWeatherDynamicImage,
                globalWeatherCity: globalSettings.globalWeatherCity,
                globalUse24h: globalSettings.globalUse24h,
                globalAccentColor: globalSettings.globalAccentColor,
                extensionPath: this.extensionPath,
            });

            const node = createWidgetNode(resolvedData, widgetWidth, widgetHeight, posX, posY);
            if (node) {
                watchActorLifecycle(node);
                node.widgetData = widgetData;
                node.gridOverlayCallback = (showOverlay) => DesktopGrid.toggleAllGridOverlays(showOverlay);
                attachDragHandlers(this, node, widgetData);
                this.add_child(node);
                this.widgetNodes.set(widgetData.id, node);
                this._nodeConfigs.set(widgetData.id, JSON.stringify(widgetData));
            }
        }

        /**
         * Saves a widget layout change made locally by drag/resize so the settings
         * listener can recognize its own write and skip the redundant rebuild.
         */
        applyLocalWidgetLayout(widgets) {
            this._saveLocalWidgets(widgets);
        }

        _syncGridLines() {
            if (this._gridLineCanvas) {
                this._gridLineCanvas.destroy();
                this._gridLineCanvas = null;
            }

            if (this.settings.get_boolean('show-grid')) {
                const accentColor = readGlobalSettings(this.settings, this.interfaceSettings).globalAccentColor;
                const accent = parseCssColor(accentColor);
                this._gridLineCanvas = createGridOverlay(
                    this.gridCols || COLUMNS_COUNT,
                    this.gridRows || ROWS_COUNT,
                    this.cellTotalWidth,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, GRID_LINE_ALPHA
                );
                // Keep canvas at bottom so incremental updates don't stack above widgets.
                this.insert_child_at_index(this._gridLineCanvas, 0);
            }
        }

        // Saves widget configs and pre-seeds the echo guard so our own write's
        // settings echo is recognized as self-inflicted.
        _saveLocalWidgets(widgets) {
            this._lastAppliedWidgetsJson = serializeWidgets(widgets);
            saveWidgets(this.settings, widgets);
            // Sync node data so next drag/resize uses fresh geometry.
            this.widgetNodes.forEach((node, widgetId) => {
                const latest = widgets.find(widget => widget.id === widgetId);
                if (latest && node.widgetData) {
                    node.widgetData.x = latest.x;
                    node.widgetData.y = latest.y;
                    node.widgetData.width = latest.width;
                    node.widgetData.height = latest.height;
                    node.widgetData.monitor = latest.monitor;
                }
            });
        }

        /** Reads widget configs and resolves those active on this grid's monitor. */
        _resolveActiveWidgets() {
            const monitorMode = this.settings.get_string('global-monitor') || 'primary';
            const isEachMode = (monitorMode === 'each');

            const widgets = getWidgets(this.settings);
            const activeWidgets = getWidgetsForMonitor(widgets, getEffectiveMonitorIndex(this.targetMonitorIndex, this.settings), isEachMode);
            return { widgets, activeWidgets };
        }

        /** Stores layout metrics on the grid and refreshes the persistent overlay. */
        _applyGridLayout(layout) {
            this.cellTotalWidth = layout.cellTotalWidth;
            this.cellTotalHeight = layout.cellTotalHeight;
            this.cellSize = layout.cellSize;
            this._layout = layout;
            this.gridMargin = GRID_MARGIN_PX;
            this.gridCols = layout.gridCols;
            this.gridRows = layout.gridRows;

            this._syncGridLines();
        }

        /**
         * Applies an S/M/L preset: repositions if the new footprint collides,
         * then destroys and recreates the node so fonts/layout recompute.
         */
        applySizePreset(widgetId, sizeIndex) {
            const { widgets, activeWidgets } = this._resolveActiveWidgets();
            const target = widgets.find(widget => widget.id === widgetId);
            if (!target)
                return;

            const size = resolveWidgetSizePreset(target, sizeIndex);
            if (!size)
                return;

            const others = activeWidgets.filter(widget => widget.id !== widgetId);
            // Pin weather variant before resize so it doesn't silently flip.
            if (target.type === 'weather')
                target.layout = resolveWeatherLayoutVariant(target);
            target.width = size.width;
            target.height = size.height;
            target.x = Math.max(0, Math.min(target.x || 0, this.gridCols - size.width));
            target.y = Math.max(0, Math.min(target.y || 0, this.gridRows - size.height));
            if (checkOverlap(target.x, target.y, size.width, size.height, others)) {
                const spot = findEmptySpot(others, size.width, size.height, this.gridCols, this.gridRows);
                if (spot) {
                    target.x = spot.x;
                    target.y = spot.y;
                }
            }

            const node = this.widgetNodes.get(widgetId);
            if (node) {
                node.destroy();
                this.widgetNodes.delete(widgetId);
                this._nodeConfigs.delete(widgetId);
            }
            this._saveLocalWidgets(widgets);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            this._createNodeFactory(this._layout, globalSettings)(target);
        }

        /** Node creator that keeps one broken widget constructor from aborting the batch. */
        _createNodeFactory(layout, globalSettings) {
            return (widgetData) => {
                try {
                    this._createAndAttachWidget(widgetData, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight, globalSettings);
                } catch (error) {
                    console.error(`Failed to create widget ${widgetData.id} (${widgetData.type}):`, error);
                }
            };
        }

        // Applies widget settings changes incrementally: unchanged nodes are
        // left untouched (async widgets don't refetch). Deliberately does NOT
        // touch grid size — resizing while children are alive causes allocation
        // issues. Monitor geometry changes arrive via 'monitors-changed'.
        _applyWidgetChanges() {
            this._lastAppliedWidgetsJson = this.settings.get_string('widgets');

            const previousCellTotalWidth = this.cellTotalWidth;
            const previousCellTotalHeight = this.cellTotalHeight;

            const { widgets, activeWidgets } = this._resolveActiveWidgets();

            const layout = this._resolveGridLayout();
            if (layout.cellTotalWidth !== previousCellTotalWidth || layout.cellTotalHeight !== previousCellTotalHeight) {
                this._rebuildGrid();
                return;
            }

            this._applyGridLayout(layout);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            const createNode = this._createNodeFactory(layout, globalSettings);

            const { sortedWidgets, modified } = this._layoutWidgetsOnGrid(activeWidgets, layout.gridCols, layout.gridRows, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight);

            sortedWidgets.forEach(widgetData => {
                if (this.widgetNodes.has(widgetData.id) && this._nodeConfigs.get(widgetData.id) === JSON.stringify(widgetData))
                    return;

                const existingNode = this.widgetNodes.get(widgetData.id);
                if (existingNode) {
                    existingNode.destroy();
                    this.widgetNodes.delete(widgetData.id);
                    this._nodeConfigs.delete(widgetData.id);
                }
                createNode(widgetData);
            });

            for (const [widgetId, node] of [...this.widgetNodes]) {
                if (!sortedWidgets.some(widgetData => widgetData.id === widgetId)) {
                    node.destroy();
                    this.widgetNodes.delete(widgetId);
                    this._nodeConfigs.delete(widgetId);
                }
            }

            if (modified) {
                this._saveLocalWidgets(widgets);
            }
        }
        _rebuildGrid() {
            this._lastAppliedWidgetsJson = this.settings.get_string('widgets');

            this.widgetNodes.forEach(node => node.destroy());
            this.widgetNodes.clear();
            this._nodeConfigs.clear();
            this.destroy_all_children();
            this._gridLineCanvas = null;

            this.editOverlayCanvases.forEach(box => box.destroy());
            this.editOverlayCanvases = [];

            this._updateStageSize();

            const { widgets, activeWidgets } = this._resolveActiveWidgets();
            const layout = this._resolveGridLayout();

            this._applyGridLayout(layout);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            const createNode = this._createNodeFactory(layout, globalSettings);

            const { sortedWidgets, modified } = this._layoutWidgetsOnGrid(activeWidgets, layout.gridCols, layout.gridRows, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight);

            sortedWidgets.forEach(createNode);

            if (modified) {
                this._saveLocalWidgets(widgets);
            }
        }

        _toggleGridOverlay(show) {
            if (show) {
                if (this.editOverlayCanvases.length > 0) return;

                const accentColor = readGlobalSettings(this.settings, this.interfaceSettings).globalAccentColor;
                const accent = parseCssColor(accentColor);
                const canvas = createGridOverlay(
                    this.gridCols || COLUMNS_COUNT,
                    this.gridRows || ROWS_COUNT,
                    this.cellTotalWidth,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, EDIT_OVERLAY_ALPHA
                );
                this.insert_child_at_index(canvas, 0);
                this.editOverlayCanvases.push(canvas);
            } else {
                this.editOverlayCanvases.forEach(box => box.destroy());
                this.editOverlayCanvases = [];
            }
        }

        _toggleGridLines() {
            if (this._gridLineCanvas) {
                this._gridLineCanvas.destroy();
                this._gridLineCanvas = null;
            }

            if (this.settings.get_boolean('show-grid')) {
                const accentColor = readGlobalSettings(this.settings, this.interfaceSettings).globalAccentColor;
                const accent = parseCssColor(accentColor);
                this._gridLineCanvas = createGridOverlay(
                    this.gridCols || COLUMNS_COUNT,
                    this.gridRows || ROWS_COUNT,
                    this.cellTotalWidth,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, GRID_LINE_ALPHA
                );
                this.insert_child_at_index(this._gridLineCanvas, 0);
            }
        }
    });
