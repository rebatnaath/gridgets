/**
 * ============================================================================
 * DESKTOP GRID 
 * 
 * This module is the core grid engine for the extension. It manages the
 * placement, synchronization, and interaction lifecycle of all widgets on the
 * desktop grid, enforcing boundaries and preventing overlaps.
 * ============================================================================
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import { deleteCacheFile, calculateResizedDimensions, checkOverlap, COLUMNS_COUNT, ROWS_COUNT } from './widgetUtils.js';
import { toggleWidgetEditMode, EDIT_MODE_NONE, EDIT_MODE_RESIZE, EDIT_MODE_DELETE } from './widgetEditUtils.js';
import { createStaticImageNode, createColorBlockNode } from './gridgetImage.js';
import { createAnimatedGifNode } from './gridgetGif.js';
import { createWeatherNode } from './gridgetWeather.js';
import { createTimeNode } from './gridgetTime.js';
import { createMusicNode } from './gridgetMusic.js';
import { createPomodoroNode } from './gridgetPomodoro.js';
import { createSlideshowNode } from './gridgetSlideshow.js';
import { createCpuRamNode } from './gridgetCpuRam.js';
import { createNetworkSpeedNode } from './gridgetNetworkSpeed.js';
import { createNotesNode } from './gridgetNotes.js';
import { createClipboardNode } from './gridgetClipboard.js';
import { createCommandNode } from './gridgetCommand.js';

const CELL_GAP = 4;
const BORDER_STYLE = 'border: 1px solid rgba(255, 0, 0, 0.5); background-color: rgba(255, 0, 0, 0.2);';
const CONTAINER_STYLE = 'background-color: rgba(0, 0, 0, 0);';
const DOUBLE_CLICK_THRESHOLD_MS = 400;
const ANIMATION_DURATION_MS = 250;

// Widget types that store persistent cache files on disk
const CACHE_FILE_WIDGET_TYPES = {
    notes: 'notes',
    clipboard: 'clipboard',
};

// Settings keys that trigger a full widget re-render when changed
const WIDGET_SYNC_SETTINGS = [
    'widgets',
    'border-radius',
    'global-border-width',
    'global-border-color',
    'global-background-color',
    'global-foreground-color',
    'weather-dynamic-color',
    'weather-dynamic-image',
    'image-animate-gif',
    'time-format-24h',
    'global-font-family',
    'image-show-caption',
    'slideshow-show-caption',
    'weather-use-fahrenheit',
];

export class DesktopGrid {
    constructor(settings, extensionPath) {
        this.settings = settings;
        this.extensionPath = extensionPath;
        this.signalIds = [];
        this.container = new St.Widget({
            style: CONTAINER_STYLE,
            reactive: false,
        });

        this.widgetsContainer = new St.Widget({
            style: 'background-color: transparent;',
            reactive: false,
        });

        this.buildGrid();
        this.connectSettings();
        this.syncWidgets();
    }

    connectSettings() {
        for (const key of WIDGET_SYNC_SETTINGS) {
            const id = this.settings.connect(`changed::${key}`, () => this.syncWidgets());
            this.signalIds.push(id);
        }

        const gridId = this.settings.connect('changed::show-grid', () => this.updateGridVisibility());
        this.signalIds.push(gridId);
    }

    buildGrid() {
        const gridDimensions = this.getGridDimensions();
        this.container.set_position(gridDimensions.x, gridDimensions.y);
        this.container.set_size(gridDimensions.width, gridDimensions.height);

        this.populateCells(gridDimensions.width, gridDimensions.height);

        this.widgetsContainer.set_size(gridDimensions.width, gridDimensions.height);
        this.container.add_child(this.widgetsContainer);
    }

    getGridDimensions() {
        const activeMonitor = this.getActiveMonitor();

        const panelHeight = Main.layoutManager.panelBox ? Main.layoutManager.panelBox.height : 0;

        return {
            x: activeMonitor.x + CELL_GAP,
            y: activeMonitor.y + panelHeight + CELL_GAP,
            width: activeMonitor.width - (CELL_GAP * 2),
            height: activeMonitor.height - panelHeight - (CELL_GAP * 2),
        };
    }

    getActiveMonitor() {
        const layoutManager = Main.layoutManager;

        if (layoutManager.primaryMonitor)
            return layoutManager.primaryMonitor;

        if (layoutManager.monitors && layoutManager.monitors.length > 0) {
            const primaryIndex = layoutManager.primaryIndex || 0;
            return layoutManager.monitors[primaryIndex] || layoutManager.monitors[0];
        }

        return {
            x: 0,
            y: 0,
            width: global.stage ? global.stage.width : 1920,
            height: global.stage ? global.stage.height : 1080,
        };
    }

    populateCells(containerWidth, containerHeight) {
        const totalGapWidth = CELL_GAP * (COLUMNS_COUNT - 1);
        const totalGapHeight = CELL_GAP * (ROWS_COUNT - 1);

        const cellWidth = (containerWidth - totalGapWidth) / COLUMNS_COUNT;
        const cellHeight = (containerHeight - totalGapHeight) / ROWS_COUNT;

        this.cells = [];
        for (let rowIndex = 0; rowIndex < ROWS_COUNT; rowIndex++) {
            for (let columnIndex = 0; columnIndex < COLUMNS_COUNT; columnIndex++) {
                const cell = this.createCell(columnIndex, rowIndex, cellWidth, cellHeight);
                this.cells.push(cell);
                this.container.add_child(cell);
            }
        }

        this.updateGridVisibility();
    }

    updateGridVisibility() {
        const showGrid = this.settings.get_boolean('show-grid');
        const style = showGrid ? BORDER_STYLE : 'background-color: transparent; border: none;';

        if (this.cells) {
            for (const cell of this.cells) {
                cell.style = style;
            }
        }
    }

    createCell(columnIndex, rowIndex, cellWidth, cellHeight) {
        const horizontalPosition = columnIndex * (cellWidth + CELL_GAP);
        const verticalPosition = rowIndex * (cellHeight + CELL_GAP);

        return new St.Widget({
            style: BORDER_STYLE,
            x: horizontalPosition,
            y: verticalPosition,
            width: cellWidth,
            height: cellHeight,
            reactive: false,
        });
    }

    readGlobalSettings() {
        return {
            borderRadius: this.settings.get_int('border-radius'),
            borderWidth: this.settings.get_int('global-border-width'),
            borderColor: this.settings.get_string('global-border-color'),
            globalBackgroundColor: this.settings.get_string('global-background-color'),
            globalForegroundColor: this.settings.get_string('global-foreground-color'),
            apiKey: this.settings.get_string('weather-api-key'),
            dynamicColor: this.settings.get_boolean('weather-dynamic-color'),
            dynamicImage: this.settings.get_boolean('weather-dynamic-image'),
            animateGif: this.settings.get_boolean('image-animate-gif'),
            timeFormat24h: this.settings.get_boolean('time-format-24h'),
            fontFamily: this.settings.get_string('global-font-family'),
            imageShowCaption: this.settings.get_boolean('image-show-caption'),
            slideshowShowCaption: this.settings.get_boolean('slideshow-show-caption'),
            useFahrenheit: this.settings.get_boolean('weather-use-fahrenheit'),
        };
    }

    applyGlobalDefaults(widgetData, globalSettings) {
        widgetData.appliedBorderRadius = widgetData.overrideRadius && widgetData.borderRadius !== undefined
            ? widgetData.borderRadius : globalSettings.borderRadius;
        widgetData.appliedBorderWidth = widgetData.overrideBorder && widgetData.borderWidth !== undefined
            ? widgetData.borderWidth : globalSettings.borderWidth;
        widgetData.appliedBorderColor = widgetData.overrideBorder && widgetData.borderColor !== undefined
            ? widgetData.borderColor : globalSettings.borderColor;
        widgetData.globalBackgroundColor = globalSettings.globalBackgroundColor;
        widgetData.globalForegroundColor = globalSettings.globalForegroundColor;
        widgetData.fontFamily = globalSettings.fontFamily;
        widgetData.extensionPath = this.extensionPath;

        if (widgetData.type === 'weather') {
            widgetData.apiKey = globalSettings.apiKey;
            widgetData.globalUseFahrenheit = globalSettings.useFahrenheit;
        }

        if (widgetData.type === 'slideshow') {
            widgetData.appliedShowText = widgetData.showText !== undefined ? widgetData.showText : globalSettings.slideshowShowCaption;
        } else if (widgetData.type === 'image' || widgetData.imagePath) {
            widgetData.appliedShowText = widgetData.showText !== undefined ? widgetData.showText : globalSettings.imageShowCaption;
        } else {
            widgetData.appliedShowText = widgetData.showText !== false;
        }
    }

    syncWidgets() {
        let widgets = [];
        try {
            widgets = JSON.parse(this.settings.get_string('widgets'));
        } catch (e) {
            console.error('Failed to parse widgets JSON:', e);
        }

        this.widgetsContainer.destroy_all_children();

        const gridDimensions = this.getGridDimensions();
        const totalGapWidth = CELL_GAP * (COLUMNS_COUNT - 1);
        const totalGapHeight = CELL_GAP * (ROWS_COUNT - 1);

        const cellWidth = (gridDimensions.width - totalGapWidth) / COLUMNS_COUNT;
        const cellHeight = (gridDimensions.height - totalGapHeight) / ROWS_COUNT;

        const globalSettings = this.readGlobalSettings();

        for (const widgetData of widgets) {
            this.applyGlobalDefaults(widgetData, globalSettings);

            const xPosition = widgetData.x * (cellWidth + CELL_GAP);
            const yPosition = widgetData.y * (cellHeight + CELL_GAP);

            const widgetWidth = widgetData.width * cellWidth + (widgetData.width - 1) * CELL_GAP;
            const widgetHeight = widgetData.height * cellHeight + (widgetData.height - 1) * CELL_GAP;

            const widgetNode = this.createWidgetNode(
                widgetData, widgetWidth, widgetHeight, xPosition, yPosition, globalSettings
            );

            const cellTotalWidth = cellWidth + CELL_GAP;
            const cellTotalHeight = cellHeight + CELL_GAP;

            this.setupWidgetInteractions(widgetNode, widgetData, cellTotalWidth, cellTotalHeight);

            this.widgetsContainer.add_child(widgetNode);
        }
    }

    createWidgetNode(widgetData, width, height, xPosition, yPosition, globalSettings) {
        if (widgetData.type === 'weather') {
            const widgetDynamicColor = widgetData.dynamicColor !== undefined
                ? widgetData.dynamicColor : globalSettings.dynamicColor;
            const widgetDynamicImage = widgetData.dynamicImage !== undefined
                ? widgetData.dynamicImage : globalSettings.dynamicImage;
            return createWeatherNode(widgetData, width, height, xPosition, yPosition, widgetDynamicColor, widgetDynamicImage);
        }

        if (widgetData.type === 'time')
            return createTimeNode(widgetData, width, height, xPosition, yPosition, globalSettings.timeFormat24h);

        if (widgetData.type === 'music')
            return createMusicNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'pomodoro')
            return createPomodoroNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'slideshow')
            return createSlideshowNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'cpu-ram')
            return createCpuRamNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'network-speed')
            return createNetworkSpeedNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'notes')
            return createNotesNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'clipboard')
            return createClipboardNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.type === 'command')
            return createCommandNode(widgetData, width, height, xPosition, yPosition);

        if (widgetData.imagePath) {
            if (widgetData.imagePath.toLowerCase().endsWith('.gif')) {
                const shouldAnimate = widgetData.animateGif !== undefined
                    ? widgetData.animateGif : globalSettings.animateGif;
                return createAnimatedGifNode(widgetData, width, height, xPosition, yPosition, shouldAnimate);
            }
            return createStaticImageNode(widgetData, width, height, xPosition, yPosition);
        }

        return createColorBlockNode(widgetData, width, height, xPosition, yPosition);
    }

    setupWidgetInteractions(widgetNode, widgetData, cellTotalWidth, cellTotalHeight) {
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let motionId = 0;
        let releaseId = 0;
        let lastClickTime = 0;

        widgetNode.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

            const source = event.get_source();
            if (source instanceof Clutter.Text) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentTime = event.get_time();
            const timeDiff = currentTime - lastClickTime;
            lastClickTime = currentTime;

            const isDoubleClick = timeDiff > 0 && timeDiff < DOUBLE_CLICK_THRESHOLD_MS;
            if (isDoubleClick) {
                isDragging = false;
                if (motionId) { global.stage.disconnect(motionId); motionId = 0; }
                if (releaseId) { global.stage.disconnect(releaseId); releaseId = 0; }

                actor.set_position(widgetData.x * cellTotalWidth, widgetData.y * cellTotalHeight);
                toggleWidgetEditMode(
                    actor,
                    widgetData,
                    cellTotalWidth,
                    cellTotalHeight,
                    this.extensionPath,
                    (newCols, newRows, newGridX) => {
                        this.handleResizeEnd(actor, widgetData, newCols, newRows, newGridX);
                    },
                    (widgetId) => {
                        this.deleteWidget(widgetId);
                    }
                );
                return Clutter.EVENT_STOP;
            }

            if (motionId) { global.stage.disconnect(motionId); motionId = 0; }
            if (releaseId) { global.stage.disconnect(releaseId); releaseId = 0; }
            isDragging = true;
            const [stageX, stageY] = event.get_coords();
            dragOffsetX = stageX - actor.x;
            dragOffsetY = stageY - actor.y;

            actor.get_parent().set_child_above_sibling(actor, null);

            motionId = global.stage.connect('motion-event', (stage, ev) => {
                const state = ev.get_state();
                if (!(state & Clutter.ModifierType.BUTTON1_MASK)) {
                    endDrag();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [x, y] = ev.get_coords();
                actor.set_position(x - dragOffsetX, y - dragOffsetY);
                return Clutter.EVENT_STOP;
            });

            const endDrag = () => {
                if (!isDragging) return;
                isDragging = false;
                if (motionId) { global.stage.disconnect(motionId); motionId = 0; }
                if (releaseId) { global.stage.disconnect(releaseId); releaseId = 0; }
                this.handleDragEnd(actor, widgetData, cellTotalWidth, cellTotalHeight);
            };

            releaseId = global.stage.connect('button-release-event', (stage, ev) => {
                if (ev.get_button() === 1) {
                    endDrag();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            return Clutter.EVENT_STOP;
        });

        widgetNode.connect('destroy', () => {
            if (motionId) global.stage.disconnect(motionId);
            if (releaseId) global.stage.disconnect(releaseId);
        });
    }

    handleDragEnd(actor, widgetData, cellTotalWidth, cellTotalHeight) {
        const newCol = Math.round(actor.x / cellTotalWidth);
        const newRow = Math.round(actor.y / cellTotalHeight);

        const validCol = Math.max(0, Math.min(newCol, COLUMNS_COUNT - widgetData.width));
        const validRow = Math.max(0, Math.min(newRow, ROWS_COUNT - widgetData.height));

        if (validCol === widgetData.x && validRow === widgetData.y) {
            actor.ease({
                x: widgetData.x * cellTotalWidth,
                y: widgetData.y * cellTotalHeight,
                duration: ANIMATION_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }

        let widgets = [];
        try {
            widgets = JSON.parse(this.settings.get_string('widgets'));
        } catch (e) {
            console.error('Failed to parse widgets JSON:', e);
            return;
        }

        const otherWidgets = widgets.filter(w => w.id !== widgetData.id);

        if (!checkOverlap(validCol, validRow, widgetData.width, widgetData.height, otherWidgets)) {
            const widgetIndex = widgets.findIndex(w => w.id === widgetData.id);
            if (widgetIndex !== -1) {
                widgets[widgetIndex].x = validCol;
                widgets[widgetIndex].y = validRow;
                this.settings.set_string('widgets', JSON.stringify(widgets));
                return;
            }
        }

        actor.ease({
            x: widgetData.x * cellTotalWidth,
            y: widgetData.y * cellTotalHeight,
            duration: ANIMATION_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }





    handleResizeEnd(widgetNode, widgetData, newCols, newRows, newGridX) {
        const { validCols, validRows, validX } = calculateResizedDimensions(
            widgetData, newCols, newRows, newGridX
        );

        let widgets = [];
        try {
            widgets = JSON.parse(this.settings.get_string('widgets'));
        } catch (e) {
            console.error('Failed to parse widgets JSON:', e);
            this.syncWidgets();
            return;
        }

        const otherWidgets = widgets.filter(w => w.id !== widgetData.id);

        if (!checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            const widgetIndex = widgets.findIndex(w => w.id === widgetData.id);
            if (widgetIndex !== -1) {
                widgets[widgetIndex].width = validCols;
                widgets[widgetIndex].height = validRows;
                widgets[widgetIndex].x = validX;
                this.settings.set_string('widgets', JSON.stringify(widgets));
            }
        }

        this.syncWidgets();
    }

    deleteWidget(widgetId) {
        let widgets = [];
        try {
            widgets = JSON.parse(this.settings.get_string('widgets'));
        } catch (e) {
            console.error('Failed to parse widgets JSON:', e);
            return;
        }

        const widget = widgets.find(w => w.id === widgetId);
        if (widget) {
            const cachePrefix = CACHE_FILE_WIDGET_TYPES[widget.type];
            if (cachePrefix)
                deleteCacheFile(this.extensionPath, cachePrefix, widget.id);
        }

        const filtered = widgets.filter(w => w.id !== widgetId);
        this.settings.set_string('widgets', JSON.stringify(filtered));
    }

    destroy() {
        for (const id of this.signalIds) {
            this.settings.disconnect(id);
        }
        this.signalIds = [];
        this.container.destroy();
    }
}
