import Gio from 'gi://Gio';
import { launcherFile, selectedLaunchers } from './appLaunchers.js';
import GLib from 'gi://GLib';
import {
    COLUMNS_COUNT,
    findEmptySpot,
    getWidgets,
    nextWidgetIdFromList,
    saveWidgets,
} from '../utils/widgetUtils.js';

const DESKTOP_ICON_TYPE = 'desktop-icon';
export const SHOW_DESKTOP_ICONS_KEY = 'show-desktop-icons';
export const SHOW_HIDDEN_DESKTOP_ICONS_KEY = 'show-hidden-desktop-icons';
export const DISMISSED_DESKTOP_ICONS_KEY = 'dismissed-desktop-icons';

/**
 * Footprint on the grid, in cells. A desktop icon is a single glyph with one label, so
 * this is sized to hold both at the reference scale rather than to hold content.
 */
const DESKTOP_ICON_SIZE_CELLS = 3;

export const DESKTOP_ENTRY_SUFFIX = '.desktop';
const GENERIC_FILE_ICON_NAME = 'text-x-generic';
const DESKTOP_ENTRY_ATTRIBUTES = 'standard::display-name,standard::icon';

// A directory monitor reports a single save as a write, a rename and an attribute change,
// and a file manager can produce all three before the user has finished renaming one file.
const RESYNC_DEBOUNCE_MS = 500;

let directoryMonitor = null;
let monitorSignalId = 0;
let resyncSourceId = 0;

export function isDesktopIcon(widgetData) {
    return widgetData.type === DESKTOP_ICON_TYPE;
}

export function desktopDirectoryPath() {
    const configured = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
    return configured || `${GLib.get_home_dir()}/Desktop`;
}

/**
 * Whether the desktop folder is there to read.
 *
 * A missing folder is not an error to log and carry on from. Nothing can bring the icons
 * back while it is gone, so a switch left on would promise a desktop that is not there and
 * draw nothing for it. Callers turn the setting off instead and the user is asked to
 * create the folder again the next time they try.
 */
export function desktopDirectoryExists(path = desktopDirectoryPath()) {
    return Gio.File.new_for_path(path).query_exists(null);
}

export function desktopFileFor(widgetData) {
    // A launcher is not in the desktop folder, so its file is found by desktop ID instead.
    // The null case is an id that no longer resolves, which the next sync drops.
    if (widgetData.isAppLauncher)
        return launcherFile(widgetData.fileName);
    return Gio.File.new_for_path(`${desktopDirectoryPath()}/${widgetData.fileName}`);
}



export function isAppLauncherEntry(widgetData) {
    return widgetData.isAppLauncher === true;
}

/**
 * Whether a saved entry should be drawn right now.
 *
 * Dismissed entries stay in the saved layout rather than being deleted, so an icon the
 * user took off the grid comes back where it was rather than at the next free spot.
 * That makes this the one place that decides what a grid shows.
 */
export function isDesktopIconVisible(widgetData, settings) {
    if (!isDesktopIcon(widgetData))
        return true;
    if (!settings.get_boolean(SHOW_DESKTOP_ICONS_KEY))
        return false;
    return !settings.get_strv(DISMISSED_DESKTOP_ICONS_KEY).includes(widgetData.fileName);
}

function genericFileIcon() {
    return Gio.ThemedIcon.new(GENERIC_FILE_ICON_NAME);
}

/**
 * The label and icon one desktop entry should paint.
 *
 * A .desktop file's own display name is its filename, so the launcher's name and icon are
 * used whenever the launcher loads. Read from the file rather than from the saved entry,
 * which is why a rename needs no separate step to update what the icon says.
 */
export function resolveDesktopEntry(file) {
    const basename = file.get_basename();

    if (basename.endsWith(DESKTOP_ENTRY_SUFFIX)) {
        const appInfo = Gio.DesktopAppInfo.new_from_filename(file.get_path());
        if (appInfo)
            return { label: appInfo.get_name() || basename, icon: appInfo.get_icon() || genericFileIcon() };
    }

    const info = queryFileInfo(file);
    if (!info)
        return { label: basename, icon: genericFileIcon() };
    return { label: info.get_display_name() || basename, icon: info.get_icon() || genericFileIcon() };
}

function queryFileInfo(file) {
    try {
        return file.query_info(DESKTOP_ENTRY_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null);
    } catch (error) {
        // The entry was removed between the layout being read and its icon being painted.
        // The next resync drops the widget, so a fallback icon is the whole fix here.
        console.error(`Gridgets: ${file.get_uri()} could not be read:`, error);
        return null;
    }
}



function listDesktopEntries(showHidden, path) {
    const entries = [];
    const directory = Gio.File.new_for_path(path);

    try {
        const enumerator = directory.enumerate_children(DESKTOP_ENTRY_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            const name = fileInfo.get_name();
            if (!showHidden && name.startsWith('.'))
                continue;
            entries.push({ name, file: directory.get_child(name) });
        }
        enumerator.close(null);
    } catch (error) {
        console.error(`Gridgets: ${directory.get_path()} could not be listed:`, error);
        return null;
    }

    return entries;
}

/**
 * Brings the saved layout in line with the desktop folder and reports whether it wrote.
 *
 * Runs whether or not icons are being shown, so a file deleted while they are switched off
 * does not leave an entry behind that nothing will ever remove. Only entries whose file is
 * gone are dropped: a dismissed entry is kept so its position survives.
 */
/**
 * The desktop folder's files, plus the chosen launchers.
 *
 * A launcher already present in the folder is left out: the folder copy is a real file with
 * the full set of actions, and two entries sharing a name would collide on one grid cell.
 */
function listGridEntries(settings, showHidden, path) {
    const files = listDesktopEntries(showHidden, path);
    if (!files)
        return null;

    const inFolder = new Set();
    for (const file of files) {
        if (file.name.endsWith(DESKTOP_ENTRY_SUFFIX))
            inFolder.add(desktopIdOf(file.file));
    }

    const entries = [...files];
    for (const launcher of selectedLaunchers(settings)) {
        if (inFolder.has(launcher.id))
            continue;
        entries.push({ name: launcher.id, file: launcher.file, isAppLauncher: true });
    }
    return entries;
}



function desktopIdOf(file) {
    try {
        return Gio.DesktopAppInfo.new_from_filename(file.get_path())?.get_id() ?? null;
    } catch (error) {
        return null;
    }
}

export function syncDesktopIcons(settings, path = desktopDirectoryPath()) {
    if (!desktopDirectoryExists(path)) {
        if (settings.get_boolean(SHOW_DESKTOP_ICONS_KEY)) {
            console.error('Gridgets: the desktop folder is gone, so desktop icons are switched off');
            settings.set_boolean(SHOW_DESKTOP_ICONS_KEY, false);
        }
        return false;
    }

    const entries = listGridEntries(settings, settings.get_boolean(SHOW_HIDDEN_DESKTOP_ICONS_KEY), path);
    if (!entries)
        return false;

    const liveNames = new Set(entries.map(entry => entry.name));

    const widgets = getWidgets(settings);
    const retained = [];
    const presentNames = new Set();
    let modified = false;

    for (const widget of widgets) {
        if (!isDesktopIcon(widget)) {
            retained.push(widget);
            continue;
        }
        if (!liveNames.has(widget.fileName)) {
            modified = true;
            continue;
        }
        presentNames.add(widget.fileName);
        retained.push(widget);
    }

    for (const entry of entries) {
        if (presentNames.has(entry.name))
            continue;
        const spot = findEmptySpot(retained, DESKTOP_ICON_SIZE_CELLS, DESKTOP_ICON_SIZE_CELLS, COLUMNS_COUNT);
        retained.push({
            id: nextWidgetIdFromList(retained, DESKTOP_ICON_TYPE),
            type: DESKTOP_ICON_TYPE,
            fileName: entry.name,
            // Only written when true: an absent key is what every saved layout already has,
            // and adding a false to each would rewrite every icon the user owns.
            ...(entry.isAppLauncher ? { isAppLauncher: true } : {}),
            x: spot ? spot.x : 0,
            y: spot ? spot.y : 0,
            width: DESKTOP_ICON_SIZE_CELLS,
            height: DESKTOP_ICON_SIZE_CELLS,
        });
        presentNames.add(entry.name);
        modified = true;
    }

    if (modified)
        saveWidgets(settings, retained);
    return modified;
}

/**
 * Starts one directory monitor for the session.
 *
 * Writes reach the layout rather than a callback, because every grid already reacts to
 * `changed::widgets` and re-derives only the nodes that changed. Handing grids a second
 * way to hear about the same edit is how the two start disagreeing.
 */
export function startDesktopIconWatch(settings) {
    if (directoryMonitor)
        return;

    const directory = Gio.File.new_for_path(desktopDirectoryPath());
    try {
        directoryMonitor = directory.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
    } catch (error) {
        console.error(`Gridgets: ${directory.get_path()} cannot be watched for changes:`, error);
        return;
    }

    monitorSignalId = directoryMonitor.connect('changed', () => {
        scheduleResync(settings);
    });
}

export function stopDesktopIconWatch() {
    if (resyncSourceId) {
        GLib.Source.remove(resyncSourceId);
        resyncSourceId = 0;
    }
    if (!directoryMonitor)
        return;
    if (monitorSignalId) {
        directoryMonitor.disconnect(monitorSignalId);
        monitorSignalId = 0;
    }
    directoryMonitor.cancel();
    directoryMonitor = null;
}

function scheduleResync(settings) {
    if (resyncSourceId)
        GLib.Source.remove(resyncSourceId);
    resyncSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESYNC_DEBOUNCE_MS, () => {
        resyncSourceId = 0;
        syncDesktopIcons(settings);
        return GLib.SOURCE_REMOVE;
    });
}

// Without this a rename reconciles as two unrelated events and the entry loses its place.

export function renameDesktopIconEntry(settings, fileName, newName) {
    if (fileName === newName)
        return false;

    const widgets = getWidgets(settings);
    const target = widgets.find(widget => isDesktopIcon(widget) && widget.fileName === fileName);
    if (!target)
        return false;

    target.fileName = newName;
    saveWidgets(settings, widgets);
    return true;
}

/**
 * Takes one entry off the grid. The file is left exactly as it is on disk, and the entry
 * keeps its place in the layout so restoring it puts it back where it was.
 */
export function dismissDesktopIcon(settings, widgetId) {
    const target = getWidgets(settings).find(widget => widget.id === widgetId);
    if (!target || !isDesktopIcon(target))
        return false;

    const dismissed = settings.get_strv(DISMISSED_DESKTOP_ICONS_KEY);
    if (dismissed.includes(target.fileName))
        return false;

    settings.set_strv(DISMISSED_DESKTOP_ICONS_KEY, [...dismissed, target.fileName]);
    return true;
}

export function restoreDismissedDesktopIcons(settings) {
    if (settings.get_strv(DISMISSED_DESKTOP_ICONS_KEY).length === 0)
        return false;
    settings.set_strv(DISMISSED_DESKTOP_ICONS_KEY, []);
    return true;
}