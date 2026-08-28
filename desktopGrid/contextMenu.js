import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { toggleWidgetResizeHandle } from './widgetEditUtils.js';
import { onWidgetResized, onWidgetDeleted } from './dragDrop.js';
import { COLUMNS_COUNT, ROWS_COUNT, getWidgets, supportsSizePresets, SIZE_PRESET_TIERS } from '../utils/widgetUtils.js';

export function createPopupMenuAt(grid, event) {
    if (grid._contextMenuCloseIdleId) {
        GLib.Source.remove(grid._contextMenuCloseIdleId);
        grid._contextMenuCloseIdleId = null;
    }
    if (grid.contextMenu) {
        removeContextMenu(grid);
    }

    const [stageX, stageY] = event.get_coords();
    const dummyActor = new St.Widget({ x: stageX, y: stageY, width: 1, height: 1 });
    Main.uiGroup.add_child(dummyActor);
    grid._contextMenuDummyActor = dummyActor;

    grid.contextMenu = new PopupMenu.PopupMenu(dummyActor, 0.0, St.Side.TOP);
    const openedMenu = grid.contextMenu;
    openedMenu.connect('open-state-changed', (_menu, isOpen) => {
        if (isOpen || grid.contextMenu !== openedMenu)
            return;
        const closedMenu = openedMenu;
        grid._contextMenuCloseIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            grid._contextMenuCloseIdleId = null;
            if (grid.contextMenu === closedMenu)
                removeContextMenu(grid);
            return GLib.SOURCE_REMOVE;
        });
    });

    if (!grid._menuManager) {
        grid._menuManager = new PopupMenu.PopupMenuManager(grid);
    }
    grid._menuManager.addMenu(grid.contextMenu);

    return grid.contextMenu;
}

export function removeContextMenu(grid) {
    if (grid.contextMenu) {
        const menu = grid.contextMenu;
        grid.contextMenu = null;
        if (grid._menuManager) {
            grid._menuManager.removeMenu(menu);
        }
        menu.destroy();
    }
    if (grid._contextMenuDummyActor) {
        const parent = grid._contextMenuDummyActor.get_parent();
        if (parent) parent.remove_child(grid._contextMenuDummyActor);
        grid._contextMenuDummyActor = null;
    }
}

export function openPreferences(grid, targetWidgetId = null) {
    if (targetWidgetId) {
        grid.settings.set_string('open-edit-widget-id', targetWidgetId);
    }
    const extension = Extension.lookupByUUID(grid.metadata.uuid);
    if (!extension) return;
    extension.openPreferences();
}

/** Opens a GNOME Settings panel through GIO's app launcher instead of a raw fork/exec. */
export function launchSettingsPanel(panelName = null) {
    const args = panelName ? ['gnome-control-center', panelName] : ['gnome-control-center'];
    try {
        const appInfo = Gio.AppInfo.create_from_commandline(
            args, 'GNOME Settings', Gio.AppInfoCreateFlags.SUPPORT_STARTUP_NOTIFICATION);
        appInfo.launch([], null);
    } catch (e) {
        console.error('Failed to launch GNOME Settings:', e);
    }
}

export function openWidgetContextMenu(grid, event, node, widgetData) {
    const menu = createPopupMenuAt(grid, event);

    if (supportsSizePresets(widgetData)) {
        const sizeMenu = new PopupMenu.PopupSubMenuMenuItem('Size');
        SIZE_PRESET_TIERS.forEach((label, sizeIndex) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => grid.applySizePreset(widgetData.id, sizeIndex));
            sizeMenu.menu.addMenuItem(item);
        });
        menu.addMenuItem(sizeMenu);
    } else {
        const isResizing = !!node.actionOverlay;
        const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize Widget');
        resizeItem.connect('activate', () => {
            const allWidgets = getWidgets(grid.settings);
            const gridCols = grid.gridCols || COLUMNS_COUNT;
            const gridRows = grid.gridRows || ROWS_COUNT;
            toggleWidgetResizeHandle(
                node,
                widgetData,
                grid.cellTotalWidth,
                grid.cellTotalHeight,
                grid.extensionPath,
                (newCols, newRows, newX) => onWidgetResized(grid, widgetData.id, newCols, newRows, newX),
                allWidgets,
                gridCols,
                gridRows
            );
        });
        menu.addMenuItem(resizeItem);
    }

    const configItem = new PopupMenu.PopupMenuItem('Configure Widget...');
    configItem.connect('activate', () => openPreferences(grid, widgetData.id));
    menu.addMenuItem(configItem);

    const deleteItem = new PopupMenu.PopupMenuItem('Delete Widget');
    deleteItem.connect('activate', () => onWidgetDeleted(grid, widgetData.id));
    menu.addMenuItem(deleteItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
}

export function openContextMenu(grid, event) {
    const menu = createPopupMenuAt(grid, event);

    const bgItem = new PopupMenu.PopupMenuItem('Change Background...');
    bgItem.connect('activate', () => launchSettingsPanel('background'));
    menu.addMenuItem(bgItem);

    const displayItem = new PopupMenu.PopupMenuItem('Display Settings');
    displayItem.connect('activate', () => launchSettingsPanel('display'));
    menu.addMenuItem(displayItem);

    const settingsItem = new PopupMenu.PopupMenuItem('GNOME Settings');
    settingsItem.connect('activate', () => launchSettingsPanel());
    menu.addMenuItem(settingsItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const prefsItem = new PopupMenu.PopupMenuItem('Gridgets Preferences...');
    prefsItem.connect('activate', () => openPreferences(grid));
    menu.addMenuItem(prefsItem);

    const toggleLinesItem = new PopupMenu.PopupMenuItem('Toggle Grid Lines');
    toggleLinesItem.connect('activate', () => {
        const current = grid.settings.get_boolean('show-grid');
        grid.settings.set_boolean('show-grid', !current);
    });
    menu.addMenuItem(toggleLinesItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
}
