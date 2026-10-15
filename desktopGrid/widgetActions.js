/**
 * The three things a user can ask of a widget from its context menu: its genre, its size
 * preset, and its picture or folder. Each recreates only the node it changed, because a
 * replacement measured before its allocation lands sits at the wrong scale until a resize.
 */
import { readGlobalSettings } from '../utils/widgetUtils.js';
import { resolveWidgetSizePreset } from '../utils/widgetRegistry.js';
import { resolveWeatherLayoutVariant } from '../widgets/weather/weatherCommon.js';
import { openPortalFileChooser } from '../utils/fileChooser.js';
import { getOtherWidgets, placeInFreeSpot, resolveActiveWidgets, saveLocalWidgets } from './layout.js';
import { detachNode } from './layout.js';
import { createNodeFactory, rebuildGrid } from './widgetSync.js';

export function applyWidgetGenre(grid, widgetId, genre) {
    const { widgets } = resolveActiveWidgets(grid);
    const target = widgets.find(widget => widget.id === widgetId);
    if (!target)
        return;
    target.genre = genre;

    detachNode(grid, widgetId);
    saveLocalWidgets(grid, widgets);

    const globalSettings = readGlobalSettings(grid.settings, grid.interfaceSettings);
    createNodeFactory(grid, grid._layout, globalSettings)(target);
}

/** Repositions if the new footprint collides. */
export function applySizePreset(grid, widgetId, sizeIndex) {
    const { widgets } = resolveActiveWidgets(grid);
    const target = widgets.find(widget => widget.id === widgetId);
    if (!target)
        return;

    const size = resolveWidgetSizePreset(target, sizeIndex);
    if (!size)
        return;

    const others = getOtherWidgets(grid, widgets, widgetId);
    // Pin weather variant before resize so it doesn't silently flip.
    if (target.type === 'weather')
        target.layout = resolveWeatherLayoutVariant(target);
    target.width = size.width;
    target.height = size.height;
    placeInFreeSpot(target, others, grid.gridCols, grid.gridRows);

    detachNode(grid, widgetId);
    saveLocalWidgets(grid, widgets);

    const globalSettings = readGlobalSettings(grid.settings, grid.interfaceSettings);
    createNodeFactory(grid, grid._layout, globalSettings)(target);
}

/** Picks a new picture, or a new folder for a slideshow. Writes the field prefs edits. */
export function pickWidgetSource(grid, widgetId) {
    const { widgets } = resolveActiveWidgets(grid);
    const target = widgets.find(widget => widget.id === widgetId);
    if (!target)
        return;
    const isSlideshow = target.type === 'slideshow';
    openPortalFileChooser({
        title: isSlideshow ? 'Select Image Folder' : 'Select Image',
        chooseFolder: isSlideshow,
    }, path => {
        // Null on cancel or a missing portal backend: leave the widget alone.
        if (!path)
            return;
        // Re-resolved: the chooser is open for as long as the user takes, and the
        // widget may have been deleted meanwhile.
        const currentWidgets = resolveActiveWidgets(grid).widgets;
        const current = currentWidgets.find(widget => widget.id === widgetId);
        if (!current)
            return;
        if (isSlideshow)
            current.slideshowFolder = path;
        else
            current.imagePath = path;
        saveLocalWidgets(grid, currentWidgets);
        // The picked file may be a different aspect or size, so the node is rebuilt.
        rebuildGrid(grid);
    });
}
