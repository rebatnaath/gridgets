import Gio from 'gi://Gio';
import St from 'gi://St';
import { desktopDirectoryPath } from './desktopIcons.js';
import { pasteUrisIntoDirectory } from './fileOperations.js';

const URI_LIST_MIMETYPE = 'text/uri-list';
const GNOME_COPIED_FILES_MIMETYPE = 'x-special/gnome-copied-files';
const GNOME_COPIED_FILES_CUT = 'cut';
const GNOME_COPIED_FILES_COPY = 'copy';

// Puts files on the clipboard for another application to paste.
//
// One call: set_content offers a single payload and each call replaces the clipboard, so
// two calls would leave the cut flag and no files. gnome-copied-files carries both facts,
// being the URI list with "cut" or "copy" as its first line. text/uri-list must not be
// advertised alongside it, or a reader asking for it gets the "cut" line as a path.
export function setClipboardFiles(uris, isCut) {
    // No trailing newline: gnome-copied-files is split on newlines and a trailing one
    // reads as an empty line, which Nautilus refuses.
    const payload = [isCut ? GNOME_COPIED_FILES_CUT : GNOME_COPIED_FILES_COPY, ...uris].join('\n');
    St.Clipboard.get_default().set_content(
        St.ClipboardType.CLIPBOARD,
        GNOME_COPIED_FILES_MIMETYPE,
        new TextEncoder().encode(payload));
}

// St hands the callback a GBytes, which GJS maps straight to a Uint8Array, so there is
// nothing to unwrap. The write above relies on the same mapping in the other direction.
function decodeContent(content) {
    return new TextDecoder().decode(content);
}

function readClipboardUris(callback) {
    const clipboard = St.Clipboard.get_default();

    // The GNOME format first, because that is what carries whether this was a cut. A bare
    // URI list from anywhere else still pastes, it just cannot say which it was.
    clipboard.get_content(St.ClipboardType.CLIPBOARD, GNOME_COPIED_FILES_MIMETYPE, (_clipboard, copied) => {
        if (copied !== null) {
            const lines = decodeContent(copied)
                .split('\n')
                .map(line => line.trim())
                .filter(line => line !== '' && !line.startsWith('#'));
            const shouldMove = lines[0] === GNOME_COPIED_FILES_CUT;
            callback(lines.slice(1), shouldMove);
            return;
        }

        clipboard.get_content(St.ClipboardType.CLIPBOARD, URI_LIST_MIMETYPE, (_clipboard, uriList) => {
            if (!uriList) {
                callback([], false);
                return;
            }
            const uris = decodeContent(uriList)
                .split('\n')
                .map(line => line.trim())
                .filter(line => line !== '' && !line.startsWith('#'));
            callback(uris, false);
        });
    });
}

/**
 * Pastes the clipboard into a folder. `callback` receives how many landed and, if none did,
 * why. A cut moves and a copy duplicates, because that is what the clipboard asked for.
 */
function pasteIntoFolder(directory, callback) {
    readClipboardUris((uris, shouldMove) => {
        if (uris.length === 0) {
            callback(0, 'There are no files on the clipboard to paste.');
            return;
        }
        callback(pasteUrisIntoDirectory(uris, shouldMove, directory));
    });
}

export function pasteIntoDesktopFolder(callback) {
    pasteIntoFolder(Gio.File.new_for_path(desktopDirectoryPath()), callback);
}

/**
 * Whether any of these entries is on the clipboard, and whether it was cut.
 *
 * `callback` receives `(onClipboard, isCut)`. A desktop icon asks this so it can be drawn
 * faded while it is waiting to be pasted, since the grid never hears that the clipboard
 * changed.
 */
export function isOnClipboard(uris, callback) {
    readClipboardUris((clipboardUris, isCut) => {
        callback(uris.some(uri => clipboardUris.includes(uri)), isCut);
    });
}
