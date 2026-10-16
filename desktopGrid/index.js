import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import { COLUMNS_COUNT, readGlobalSettings, parseCssColor } from '../utils/widgetUtils.js';
import { clearIconSelection, selectIcon, setIconHovered } from '../desktopIcons/desktopIconWidget.js';
import {
    DEFAULT_STAGE_WIDTH,
    DEFAULT_STAGE_HEIGHT,
    BUTTON_PRIMARY,
    BUTTON_SECONDARY,
} from './constants.js';
import { getPanelHeight, getTargetMonitor } from './helpers.js';
import { applyGridLayout } from './layout.js';
import { applyWidgetChanges, rebuildGrid } from './widgetSync.js';
import {
    createGridOverlay,
    registerGrid,
    unregisterGrid,
} from './overlays.js';
import { DISMISSED_DESKTOP_ICONS_KEY } from '../desktopIcons/desktopIcons.js';
import { openContextMenu, openWidgetContextMenu } from './contextMenu.js';
import { attachDragHandlers } from './dragDrop.js';
import { removeContextMenu } from './menuPopup.js';

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
            this.interfaceSettings = interfaceSettings || Gio.Settings.new('org.gnome.desktop.interface');
            this.targetMonitorIndex = targetMonitorIndex;
            this.signalIds = [];
            this.widgetNodes = new Map();
            this._nodeConfigs = new Map();
            this._gridLineCanvas = null;
            this.editOverlayCanvases = [];
            this.contextMenu = null;
            this._lastAppliedWidgetsJson = null;
            this._lastFullGridNotice = '';

            this.cellTotalWidth = 0;
            this.cellTotalHeight = 0;
            this.gridMargin = 0;
            this.gridCols = 0;
            this.gridRows = 0;
            this._layout = null;

            registerGrid(this);

            this._pressOnWidget = false;
            this._setupSettingsListeners();
            this._initialLayout();
            rebuildGrid(this);

            this._backgroundPressId = this.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === BUTTON_SECONDARY) {
                    openContextMenu(this, event);
                    return Clutter.EVENT_STOP;
                }
                // A press on an icon bubbles up here as well as landing on the grid, so the
                // two have to be told apart. _pressOnWidget is the only reliable
                // discriminator: the source is the grid for the drag overlay and the icon's
                // own child for the icon, so matching the source reads as a background press.
                const wasOnWidget = this._pressOnWidget;
                this._pressOnWidget = false;
                if (event.get_button() === BUTTON_PRIMARY && !wasOnWidget) {
                    clearIconSelection();
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        destroy() {
            unregisterGrid(this);

            if (this.signalIds && this.settings) {
                this.signalIds.forEach(id => this.settings.disconnect(id));
                this.signalIds = [];
            }

            this.interfaceSettings = null;

            // Releases the open menu, its anchor and the pending close idle, all three of
            // which that module created.
            removeContextMenu(this);

            if (this._backgroundPressId) {
                this.disconnect(this._backgroundPressId);
                this._backgroundPressId = 0;
            }

            this.editOverlayCanvases.forEach(box => box.destroy());
            this.editOverlayCanvases = [];

            this.widgetNodes.forEach(node => node.destroy());
            this.widgetNodes.clear();
            this._nodeConfigs.clear();
            this._gridLineCanvas = null;

            this.destroy_all_children();

            super.destroy();
        }

        /** Seeds the cell metrics from the placeholder stage size, before the first measure. */
        _initialLayout() {
            const layout = {
                cellSize: 0,
                cellTotalWidth: this.width,
                cellTotalHeight: this.height,
                gridCols: COLUMNS_COUNT,
                gridRows: 1,
            };
            applyGridLayout(this, layout);
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
                applyWidgetChanges(this);
            });
            // Global style keys are baked at construction, so a change rebuilds.
            connectSetting('global-background-color', () => rebuildGrid(this));
            connectSetting('global-foreground-color', () => rebuildGrid(this));
            connectSetting('global-card-color', () => rebuildGrid(this));
            connectSetting('global-highlight-color', () => rebuildGrid(this));
            connectSetting('global-font-family', () => rebuildGrid(this));
            connectSetting('global-use-custom-font', () => rebuildGrid(this));
            // accent-color-override is deliberately absent: the extension watches that
            // one and rebuilds every grid, so a handler here would rebuild twice.
            connectSetting('image-animate-gif', () => rebuildGrid(this));
            connectSetting('image-show-caption', () => rebuildGrid(this));
            connectSetting('slideshow-show-caption', () => rebuildGrid(this));
            connectSetting('image-caption-scrim', () => rebuildGrid(this));
            connectSetting('global-caption-color', () => rebuildGrid(this));
            connectSetting('weather-use-fahrenheit', () => rebuildGrid(this));
            connectSetting('time-format-24h', () => rebuildGrid(this));
            connectSetting('weather-dynamic-color', () => rebuildGrid(this));
            connectSetting('weather-dynamic-image', () => rebuildGrid(this));
            connectSetting('show-grid', () => this._syncGridLines());
            // Written by the preferences window as well as by the grid's own context menu,
            // and it changes no entry in the layout, so the widgets signal never arrives.
            connectSetting(DISMISSED_DESKTOP_ICONS_KEY, () => rebuildGrid(this));
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

        _syncGridLines() {
            if (this._gridLineCanvas) {
                this._gridLineCanvas.destroy();
                this._gridLineCanvas = null;
            }

            if (this.settings.get_boolean('show-grid')) {
                const accentColor = readGlobalSettings(this.settings, this.interfaceSettings).globalAccentColor;
                const accent = parseCssColor(accentColor);
                this._gridLineCanvas = createGridOverlay(
                    this.gridCols,
                    this.gridRows,
                    this.cellTotalWidth,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, GRID_LINE_ALPHA
                );
                // Index 0 paints first, so the lines stay under the widgets.
                this.insert_child_at_index(this._gridLineCanvas, 0);
            }
        }

        /**
         * Connects a widget node's three handlers in the order they have to be. Selection
         * first: the drag handlers' secondary-press branch returns EVENT_STOP, and Clutter
         * stops calling further handlers on a signal once one does, so a selection handler
         * connected after them would never see a right click.
         */
        _wireNode(node, widgetData) {
            this._connectIconSelection(node, widgetData);
            attachDragHandlers(this, node, widgetData, openWidgetContextMenu);
        }

        _connectIconSelection(node, widgetData) {
            node.connect('button-press-event', (_actor, event) => {
                // Only a primary press reaches the grid to read this flag: the drag handlers
                // stop a secondary press on its way up, so a right-click that left it set
                // made the next click on empty desktop read it stale.
                this._pressOnWidget = (event.get_button() === BUTTON_PRIMARY);
                // Both buttons, as a file manager does: right-clicking selects and opens the
                // menu together, so the thing being acted on is the thing that lights up.
                if (event.get_button() === BUTTON_PRIMARY || event.get_button() === BUTTON_SECONDARY) {
                    selectIcon(this, node, widgetData);
                }
                return Clutter.EVENT_PROPAGATE;
            });
            node.connect('enter-event', () => {
                setIconHovered(node, true);
                return Clutter.EVENT_PROPAGATE;
            });
            node.connect('leave-event', () => {
                setIconHovered(node, false);
                return Clutter.EVENT_PROPAGATE;
            });
        }

        _toggleGridOverlay(show) {
            if (show) {
                if (this.editOverlayCanvases.length > 0) return;

                const accentColor = readGlobalSettings(this.settings, this.interfaceSettings).globalAccentColor;
                const accent = parseCssColor(accentColor);
                const canvas = createGridOverlay(
                    this.gridCols,
                    this.gridRows,
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
    });
