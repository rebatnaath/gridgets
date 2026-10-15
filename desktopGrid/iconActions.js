/**
 * Cut, Copy and Rename for the selected desktop icon, reached from both a menu item and a
 * shortcut. Each resolves the entry's file first and returns without one, which is what
 * keeps these off the other widget types sharing the grid: desktopFileFor() is null for
 * anything that is not a desktop icon.
 */
import { desktopFileFor, renameDesktopIconEntry } from '../desktopIcons/desktopIcons.js';
import { beginInlineRename, setClipboardEmphasis } from '../desktopIcons/desktopIconWidget.js';
import { describeUnusableName, renameEntry } from '../desktopIcons/fileOperations.js';
import { setClipboardFiles } from '../desktopIcons/clipboardPaste.js';

/** Shared with Ctrl+X: the clipboard write and the dimming are one action. */
export function cutDesktopIcon(node, widgetData) {
    const file = desktopFileFor(widgetData);
    if (!file)
        return;
    setClipboardFiles([file.get_uri()], true);
    setClipboardEmphasis(node, true);
}

/** Shared with Ctrl+C. */
export function copyDesktopIcon(node, widgetData) {
    const file = desktopFileFor(widgetData);
    if (!file)
        return;
    setClipboardFiles([file.get_uri()], false);
    setClipboardEmphasis(node, false);
}

/** Shared with the Rename item and F2, which must validate and rename identically. */
export function startIconRename(grid, node, widgetData) {
    const file = desktopFileFor(widgetData);
    if (!file)
        return;
    beginInlineRename(node, {
        initialText: file.get_basename(),
        validate: name => describeUnusableName(name, { short: true }),
        onAccepted: name => {
            const result = renameEntry(file, name);
            // Only after the file moved, and with the name that came back: an entry
            // repointed at a name that does not exist yet is dropped as missing on the
            // next resync.
            if (result.ok)
                renameDesktopIconEntry(grid.settings, widgetData.fileName, result.name);
            return result;
        },
    });
}
