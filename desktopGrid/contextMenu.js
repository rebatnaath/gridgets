import St from 'gi://St';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { toggleWidgetResizeHandle } from './widgetEditUtils.js';
import { onWidgetResized, onWidgetDeleted } from './dragDrop.js';
import { applySizePreset, applyWidgetGenre, pickWidgetSource } from './widgetActions.js';
import { copyDesktopIcon, cutDesktopIcon, startIconRename } from './iconActions.js';
import { COLUMNS_COUNT, getWidgets } from '../utils/widgetUtils.js';
import { DEFAULT_TOP_STORY_GENRE, SIZE_PRESET_TIERS, TOP_STORY_GENRE_LABELS, TOP_STORY_GENRE_NAMES, sizePresetTierCount, supportsSizePresets } from '../utils/widgetRegistry.js';
import {
    SHOW_DESKTOP_ICONS_KEY,
    SHOW_HIDDEN_DESKTOP_ICONS_KEY,
    dismissDesktopIcon,
    desktopFileFor,
    isAppLauncherEntry,
    isDesktopIcon,
} from '../desktopIcons/desktopIcons.js';
import { launchDesktopIcon } from '../desktopIcons/desktopIconWidget.js';
import {
    copyEntryTo,
    createDesktopFolder,
    isDirectoryEntry,
    launchTerminalFor,
    moveEntryTo,
    openEntryWith,
    showInFileManager,
    trashEntry,
} from '../desktopIcons/fileOperations.js';
import { showFileProperties } from '../desktopIcons/propertiesLauncher.js';
import { showAppChooserDialog } from '../desktopIcons/appChooserDialog.js';
import { promptForText } from '../desktopIcons/textPrompt.js';
import { pasteIntoDesktopFolder } from '../desktopIcons/clipboardPaste.js';
import { openPortalFileChooser } from '../utils/fileChooser.js';
import {
    createPopupMenuAt,
    launchSettingsPanel,
    openPreferences,
    presentMenu,
} from './menuPopup.js';

/**
 * Asks for a name, and refuses an unusable one without closing the dialog. The refusal
 * lands on the dialog's own subtitle with the text still there and selected, so correcting
 * a typo is typing the right name and pressing Return.
 */
function promptForEntryName({ title, subtitle, initialText = '', confirmLabel }, onAccepted) {
    promptForText({
        title,
        subtitle,
        initialText,
        confirmLabel,
        validate: onAccepted,
    }, () => {
        // null is a dismissed dialog, not a name. An accepted one has already been acted on.
    });
}

// The folder comes from the portal; null on dismiss or no backend.
function addTransferItem(menu, file, label, shouldMove) {
    const item = new PopupMenu.PopupMenuItem(label);
    item.connect('activate', () => {
        openPortalFileChooser({ title: label.replace('…', ''), chooseFolder: true }, folderPath => {

            if (!folderPath)
                return;
            const destination = Gio.File.new_for_path(folderPath);
            const result = shouldMove
                ? moveEntryTo(file, destination)
                : copyEntryTo(file, destination);
            if (!result.ok && result.message) {
                promptForText({ title: 'Could not transfer the file', subtitle: result.message }, () => {});
            }
        });
    });
    menu.addMenuItem(item);
}

// A submenu would only offer the applications registered for the content type, which is
// narrower than the chooser needs.
function openAppChooserFor(menu, file) {
    const item = new PopupMenu.PopupMenuItem('Open With…');
    item.connect('activate', () => {
        // Null when there is nothing to choose from: the menu item is then the only
        // thing that needs to say so, since a dialog would open on an empty list.
        if (!showAppChooserDialog({
            file,
            onChosen: app => {
                if (app)
                    openEntryWith(file, app);
            },
        })) {
            console.error(`Gridgets: no application is installed that could open ${file.get_uri()}`);
        }
    });
    menu.addMenuItem(item);
}

function openDesktopIconMenu(grid, menu, node, widgetData) {
    const file = desktopFileFor(widgetData);

    // Nothing can be done with an entry whose file has gone, other than get rid of it.
    if (!file) {
        const dismissItem = new PopupMenu.PopupMenuItem('Remove from Desktop');
        dismissItem.connect('activate', () => dismissDesktopIcon(grid.settings, widgetData.id));
        menu.addMenuItem(dismissItem);
        return;
    }

    // Open in Files and Show in Files both landed in Files for the same entry, so they
    // are one item.
    const isDirectory = isDirectoryEntry(file);
    const isLauncher = isAppLauncherEntry(widgetData);

    // A launcher has no Open With: it is an application, not a document something else opens.
    if (!isLauncher)
        openAppChooserFor(menu, file);

    if (!isDirectory) {
        const openItem = new PopupMenu.PopupMenuItem('Open');
        openItem.connect('activate', () => launchDesktopIcon(widgetData));
        menu.addMenuItem(openItem);
    }

    // Everything below acts on the file itself, so a launcher gets none of it.
    if (!isLauncher) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const cutItem = new PopupMenu.PopupMenuItem('Cut');
        cutItem.connect('activate', () => cutDesktopIcon(node, widgetData));
        menu.addMenuItem(cutItem);

        const copyItem = new PopupMenu.PopupMenuItem('Copy');
        copyItem.connect('activate', () => copyDesktopIcon(node, widgetData));
        menu.addMenuItem(copyItem);

        addTransferItem(menu, file, 'Move to…', true);
        addTransferItem(menu, file, 'Copy to…', false);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // Reveals the entry itself, not its parent folder.
    const showInFilesItem = new PopupMenu.PopupMenuItem('Show in Files');
    showInFilesItem.connect('activate', () => showInFileManager(file));
    menu.addMenuItem(showInFilesItem);

    if (!isLauncher) {
        // A folder only. A file has no folder of its own, so there is nowhere better to
        // open the console than where the file already is.
        if (isDirectory) {
            const consoleItem = new PopupMenu.PopupMenuItem('Open in Console');
            consoleItem.connect('activate', () => launchTerminalFor(file));
            menu.addMenuItem(consoleItem);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const renameItem = new PopupMenu.PopupMenuItem('Rename…');
        renameItem.connect('activate', () => startIconRename(grid, node, widgetData));
        menu.addMenuItem(renameItem);

        const trashItem = new PopupMenu.PopupMenuItem('Move to Trash');
        trashItem.connect('activate', () => trashEntry(file));
        menu.addMenuItem(trashItem);
    }

    const propertiesItem = new PopupMenu.PopupMenuItem('Properties');
    propertiesItem.connect('activate', () => showFileProperties(file));
    menu.addMenuItem(propertiesItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const dismissItem = new PopupMenu.PopupMenuItem('Remove from Desktop');
    dismissItem.connect('activate', () => dismissDesktopIcon(grid.settings, widgetData.id));
    menu.addMenuItem(dismissItem);
}

export function openWidgetContextMenu(grid, event, node, widgetData) {
    const menu = createPopupMenuAt(grid, event);

    // An icon has no settings, genre or size, so it gets its own menu.
    if (isDesktopIcon(widgetData)) {
        openDesktopIconMenu(grid, menu, node, widgetData);
        presentMenu(menu);
        return;
    }

    if (widgetData.type === 'top-stories') {
        const genreMenu = new PopupMenu.PopupSubMenuMenuItem('Genre');
        for (const genre of TOP_STORY_GENRE_NAMES) {
            const item = new PopupMenu.PopupMenuItem(TOP_STORY_GENRE_LABELS[genre] || genre);
            if ((widgetData.genre || DEFAULT_TOP_STORY_GENRE) === genre)
                item.add_style_class_name('selected');
            item.connect('activate', () => applyWidgetGenre(grid, widgetData.id, genre));
            genreMenu.menu.addMenuItem(item);
        }
        menu.addMenuItem(genreMenu);
    }

    const sizeTiers = supportsSizePresets(widgetData) ? sizePresetTierCount(widgetData) : 0;
    if (sizeTiers > 0) {
        const sizeMenu = new PopupMenu.PopupSubMenuMenuItem('Size');
        SIZE_PRESET_TIERS.slice(0, sizeTiers).forEach((label, sizeIndex) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => applySizePreset(grid, widgetData.id, sizeIndex));
            sizeMenu.menu.addMenuItem(item);
        });
        menu.addMenuItem(sizeMenu);
    } else {
        const isResizing = !!node.actionOverlay;
        const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize Widget');
        resizeItem.connect('activate', () => {
            const allWidgets = getWidgets(grid.settings);
            const gridCols = grid.gridCols || COLUMNS_COUNT;
            const gridRows = grid.gridRows;
            toggleWidgetResizeHandle(
                node,
                widgetData,
                grid.cellTotalWidth,
                grid.cellTotalHeight,
                (newCols, newRows, newX) => onWidgetResized(grid, widgetData.id, newCols, newRows, newX),
                allWidgets,
                gridCols,
                gridRows
            );
        });
        menu.addMenuItem(resizeItem);
    }

    if (widgetData.type === 'image' || widgetData.type === 'slideshow') {
        const isSlideshow = widgetData.type === 'slideshow';
        const sourceItem = new PopupMenu.PopupMenuItem(
            isSlideshow ? 'Change Folder...' : 'Change Image...');
        sourceItem.connect('activate', () => pickWidgetSource(grid, widgetData.id));
        menu.addMenuItem(sourceItem);
    }

    const configItem = new PopupMenu.PopupMenuItem('Configure Widget...');
    configItem.connect('activate', () => openPreferences(grid, widgetData.id));
    menu.addMenuItem(configItem);

    const deleteItem = new PopupMenu.PopupMenuItem('Delete Widget');
    deleteItem.connect('activate', () => onWidgetDeleted(grid, widgetData.id));
    menu.addMenuItem(deleteItem);

    presentMenu(menu);
}

export function openContextMenu(grid, event) {
    const menu = createPopupMenuAt(grid, event);

    // These act on the icon layer, so a folder created with them hidden would sit on the
    // desktop with nothing to reach it.
    if (grid.settings.get_boolean(SHOW_DESKTOP_ICONS_KEY)) {
        const newFolderItem = new PopupMenu.PopupMenuItem('New Folder');
        newFolderItem.connect('activate', () => {
            promptForEntryName({
                title: 'New Folder',
                subtitle: 'Created on the desktop.',
                confirmLabel: 'Create',
            }, name => createDesktopFolder(name));
        });
        menu.addMenuItem(newFolderItem);

        const pasteItem = new PopupMenu.PopupMenuItem('Paste');
        pasteItem.connect('activate', () => {
            pasteIntoDesktopFolder((pasted, failure) => {
                if (pasted > 0)
                    return;
                promptForText({ title: 'Nothing pasted', subtitle: failure }, () => {});
            });
        });
        menu.addMenuItem(pasteItem);

        const showHiddenItem = new PopupMenu.PopupMenuItem(
            grid.settings.get_boolean(SHOW_HIDDEN_DESKTOP_ICONS_KEY) ? 'Hide Hidden Files' : 'Show Hidden Files');
        showHiddenItem.connect('activate', () => {
            const settings = grid.settings;
            settings.set_boolean(SHOW_HIDDEN_DESKTOP_ICONS_KEY, !settings.get_boolean(SHOW_HIDDEN_DESKTOP_ICONS_KEY));
        });
        menu.addMenuItem(showHiddenItem);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

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

    presentMenu(menu);
}
