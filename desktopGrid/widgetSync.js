/**
 * Creating and retiring widget nodes. A rebuild and an incremental apply share this file;
 * `keepUnchanged` separates them, leaving an untouched node alone so a widget whose content
 * arrives over the network does not refetch on every unrelated settings change.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveWidgetOverrides, readGlobalSettings } from '../utils/widgetUtils.js';
import { createWidgetNode } from './widgetFactory.js';
import { watchActorLifecycle } from '../utils/actorLifecycle.js';
import { toggleAllGridOverlays } from './overlays.js';
import {
    applyGridLayout,
    detachNode,
    gridGeometry,
    layoutWidgetsOnGrid,
    resolveActiveWidgets,
    resolveGridLayout,
    saveLocalWidgets,
} from './layout.js';

function createAndAttachWidget(grid, widgetData, cellSize, cellTotalWidth, cellTotalHeight, globalSettings) {
    const { width: widgetWidth, height: widgetHeight, x: posX, y: posY } = gridGeometry(
        widgetData.width, widgetData.height, widgetData.x, widgetData.y,
        cellSize, cellTotalWidth, cellTotalHeight);

    const resolvedData = Object.assign({}, resolveWidgetOverrides(widgetData, globalSettings), {
        globalAnimateGif: globalSettings.globalAnimateGif,
        globalImageShowCaption: globalSettings.globalImageShowCaption,
        globalSlideshowShowCaption: globalSettings.globalSlideshowShowCaption,
        globalCaptionScrim: globalSettings.globalCaptionScrim,
        globalCaptionColor: globalSettings.globalCaptionColor,
        globalUseFahrenheit: globalSettings.globalUseFahrenheit,
        globalWeatherDynamicColor: globalSettings.globalWeatherDynamicColor,
        globalWeatherDynamicImage: globalSettings.globalWeatherDynamicImage,
        globalUse24h: globalSettings.globalUse24h,
        globalAccentColor: globalSettings.globalAccentColor,
        globalUseCustomFont: globalSettings.globalUseCustomFont,
        extensionPath: grid.extensionPath,
        settings: grid.settings,
    });

    const node = createWidgetNode(resolvedData, widgetWidth, widgetHeight, posX, posY);
    if (!node)
        return;

    watchActorLifecycle(node);
    node.widgetData = widgetData;
    node.gridOverlayCallback = toggleAllGridOverlays;
    grid._wireNode(node, widgetData);
    grid.add_child(node);
    grid.widgetNodes.set(widgetData.id, node);
    grid._nodeConfigs.set(widgetData.id, JSON.stringify(widgetData));
}

/** Node creator that keeps one broken widget constructor from aborting the batch. */
export function createNodeFactory(grid, layout, globalSettings) {
    return (widgetData) => {
        try {
            createAndAttachWidget(grid, widgetData, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight, globalSettings);
        } catch (error) {
            console.error(`Failed to create widget ${widgetData.id} (${widgetData.type}):`, error);
        }
    };
}

export function syncNodes(grid, keepUnchanged) {
    const { widgets, activeWidgets } = resolveActiveWidgets(grid);
    const layout = resolveGridLayout(grid);
    applyGridLayout(grid, layout);

    const globalSettings = readGlobalSettings(grid.settings, grid.interfaceSettings);
    const createNode = createNodeFactory(grid, layout, globalSettings);

    const isAlreadyPlaced = widgetData => grid.widgetNodes.has(widgetData.id);
    const { sortedWidgets, modified, unplaced } = layoutWidgetsOnGrid(
        activeWidgets, layout.gridCols, layout.gridRows, isAlreadyPlaced);

    // Not added at all: keeping it would list it in the settings with nothing on the desktop.
    const rejected = unplaced.filter(widgetData => !isAlreadyPlaced(widgetData));
    notifyGridIsFull(grid, rejected);

    // Left off the grid, and anything already shown is detached with them.
    const unplacedIds = new Set(unplaced.map(widget => widget.id));
    const placeable = sortedWidgets.filter(widgetData => !unplacedIds.has(widgetData.id));

    placeable.forEach(widgetData => {
        if (keepUnchanged && grid.widgetNodes.has(widgetData.id) &&
            grid._nodeConfigs.get(widgetData.id) === JSON.stringify(widgetData))
            return;
        detachNode(grid, widgetData.id);
        createNode(widgetData);
    });

    for (const widgetId of [...grid.widgetNodes.keys()]) {
        if (!placeable.some(widgetData => widgetData.id === widgetId))
            detachNode(grid, widgetId);
    }

    if (rejected.length > 0) {
        const rejectedIds = new Set(rejected.map(widgetData => widgetData.id));
        saveLocalWidgets(grid, widgets.filter(widgetData => !rejectedIds.has(widgetData.id)));
    } else if (modified) {
        saveLocalWidgets(grid, widgets);
    }
}

/**
 * Says the grid has no room, once per set of widgets that could not be placed. A rebuild
 * runs on every settings change, so the marker keeps it from re-announcing; it clears as
 * soon as everything fits, so a later overflow is announced.
 */
function notifyGridIsFull(grid, unplaced) {
    if (unplaced.length === 0) {
        grid._lastFullGridNotice = '';
        return;
    }

    const ids = unplaced.map(widget => widget.id).sort().join(',');
    if (ids === grid._lastFullGridNotice)
        return;
    grid._lastFullGridNotice = ids;

    const what = unplaced.length === 1
        ? 'A widget was not added.'
        : `${unplaced.length} widgets were not added.`;
    Main.notify('No space left on the grid',
        `${what} Free up some room, then add it again.`);
}

export function rebuildGrid(grid) {
    grid._lastAppliedWidgetsJson = grid.settings.get_string('widgets');

    // Everything the grid holds is a child of it: the widget nodes, the persistent
    // grid-line canvas and any edit overlay still up.
    grid.destroy_all_children();
    grid.widgetNodes.clear();
    grid._nodeConfigs.clear();
    grid._gridLineCanvas = null;
    grid.editOverlayCanvases = [];

    grid._updateStageSize();
    syncNodes(grid, false);
}

/**
 * Applies widget settings changes incrementally. A size change hands over to a rebuild,
 * since resizing while children are alive causes allocation issues. Monitor geometry
 * changes arrive via 'monitors-changed'.
 */
export function applyWidgetChanges(grid) {
    grid._lastAppliedWidgetsJson = grid.settings.get_string('widgets');

    const layout = resolveGridLayout(grid);
    if (layout.cellTotalWidth !== grid.cellTotalWidth || layout.cellTotalHeight !== grid.cellTotalHeight) {
        rebuildGrid(grid);
        return;
    }

    syncNodes(grid, true);
}

export { createAndAttachWidget };
