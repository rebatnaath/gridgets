/**
 * The popup a context menu is built on, and the two launchers that open something else.
 * One PopupMenuManager per grid: it has no destroy() and wires three handlers onto the grid
 * it is built for, so replacing one would strand the old handlers.
 */
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const MENU_MANAGERS = new WeakMap();

function getMenuManager(grid) {
    let menuManager = MENU_MANAGERS.get(grid);
    if (!menuManager) {
        menuManager = new PopupMenu.PopupMenuManager(grid);
        MENU_MANAGERS.set(grid, menuManager);
    }
    return menuManager;
}

export function createPopupMenuAt(grid, event) {
    removeContextMenu(grid);

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

    getMenuManager(grid).addMenu(grid.contextMenu);

    return grid.contextMenu;
}

export function removeContextMenu(grid) {
    if (grid._contextMenuCloseIdleId) {
        GLib.Source.remove(grid._contextMenuCloseIdleId);
        grid._contextMenuCloseIdleId = null;
    }
    if (grid.contextMenu) {
        const menu = grid.contextMenu;
        grid.contextMenu = null;
        // A plain lookup, because getMenuManager() would wire handlers onto a grid on its way out.
        const menuManager = MENU_MANAGERS.get(grid);
        if (menuManager)
            menuManager.removeMenu(menu);
        menu.destroy();
    }
    if (grid._contextMenuDummyActor) {
        // destroy(), not remove_child(): a menu anchor that is only detached stays
        // allocated and is rebuilt on every single menu close.
        grid._contextMenuDummyActor.destroy();
        grid._contextMenuDummyActor = null;
    }
}

export function presentMenu(menu) {
    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
}

export function openPreferences(grid, targetWidgetId = null) {
    if (targetWidgetId) {
        grid.settings.set_string('open-edit-widget-id', targetWidgetId);
    }
    const extension = Extension.lookupByUUID(grid.metadata.uuid);
    if (!extension) return;
    extension.openPreferences();
}

/** Opens a GNOME Settings panel through GIO's app launcher. */
export function launchSettingsPanel(panelName = null) {
    // create_from_commandline takes one commandline string, not an argv array, and the
    // flag is SUPPORTS_STARTUP_NOTIFICATION.
    const commandline = panelName
        ? `gnome-control-center ${panelName}`
        : 'gnome-control-center';
    try {
        const appInfo = Gio.AppInfo.create_from_commandline(
            commandline, 'GNOME Settings', Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION);
        appInfo.launch([], null);
    } catch (e) {
        console.error('Failed to launch GNOME Settings:', e);
    }
}
