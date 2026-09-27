import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile } from './widgetUtils.js';
import { getWidgetCacheFolder } from './widgetRegistry.js';

/** Bumped when a caller's payload shape changes, so old files are ignored rather than misread. */
const CACHE_VERSION = 1;

/** Bursts of successful fetches collapse into a single write. */
const SAVE_DEBOUNCE_MS = 4000;

/** Backstop against a runaway payload; real feeds sit far below this. */
const MAX_PAYLOAD_BYTES = 512 * 1024;

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/**
 * Last-good snapshots live under gridgets/archive so they stay separate from the folders
 * holding a user's own content (notes, clipboard, todos) and from github's username file.
 */
const ARCHIVE_DIR_NAME = 'archive';
const IMAGE_DIR_NAME = 'images';

/**
 * Thumbnails are cached as the bytes the CDN returned, so one file serves every widget
 * scale. Anything larger is skipped rather than stored: a handful of oversized hero images
 * would otherwise dominate the budget. Re-encoding to a scaled PNG is the way to tighten
 * this further if the real-world total proves too high.
 */
const MAX_CACHED_IMAGE_BYTES = 256 * 1024;

const writeStates = new Map();

function cacheFilePath(widgetType, widgetId) {
    const folder = getWidgetCacheFolder(widgetType);
    if (!folder || !widgetId)
        return null;
    return GLib.build_filenamev([
        getGridgetsDataDir(),
        ARCHIVE_DIR_NAME,
        folder,
        `${folder}-${widgetId}.json`,
    ]);
}

/**
 * saveJsonToFile asks widgetUtils to create the parent, but that helper memoises every
 * path it has seen, so a stale memo entry makes a nested archive folder silently absent
 * and the write fails with NOT_FOUND. Creating it here keeps the archive tree independent
 * of that shared cache, the same way the thumbnail folder is handled below.
 */
function ensureCacheFolder(widgetType) {
    const folder = getWidgetCacheFolder(widgetType);
    if (!folder)
        return;
    const dir = Gio.File.new_for_path(GLib.build_filenamev([getGridgetsDataDir(), ARCHIVE_DIR_NAME, folder]));
    if (dir.query_exists(null))
        return;
    try {
        dir.make_directory_with_parents(null);
    } catch (error) {
        console.error('Gridgets: could not create cache folder:', error.message);
    }
}

function envelopeFor(payload, savedAtMs) {
    return { version: CACHE_VERSION, savedAtMs, payload };
}

/**
 * Reads the last successfully fetched payload for a widget. Calls back with
 * (null, 0) when nothing has ever been stored, which is how callers tell
 * "never fetched" apart from "fetched long ago".
 */
export function loadLastGoodCache(widgetType, widgetId, callback, maxAgeMs = 0) {
    const filePath = cacheFilePath(widgetType, widgetId);
    if (!filePath) {
        callback(null, 0);
        return;
    }
    loadJsonFromFileAsync(filePath, (data) => {
        const payload = data && data.version === CACHE_VERSION ? data.payload : null;
        if (!payload) {
            callback(null, 0);
            return;
        }
        const state = writeStates.get(filePath);
        if (state)
            state.lastJson = JSON.stringify(payload);
        const savedAtMs = Number(data.savedAtMs) || 0;
        // Weather expires rather than serving indefinitely: conditions and a multi-day
        // forecast both stop being representative long before news does.
        if (maxAgeMs > 0 && Date.now() - savedAtMs > maxAgeMs) {
            callback(null, 0);
            return;
        }
        callback(payload, savedAtMs);
    });
}

/**
 * Stores a payload as the widget's last good data, overwriting the previous file in
 * place so a widget never costs more than one file's worth of disk. Writes are skipped
 * entirely when the payload is unchanged, so a widget polling a static feed writes once
 * and then stays quiet. Callers must only pass genuinely successful, non-empty results:
 * a failed fetch that reached this would destroy good data.
 */
export function saveLastGoodCache(widgetType, widgetId, payload) {
    const filePath = cacheFilePath(widgetType, widgetId);
    if (!filePath || payload === null || payload === undefined)
        return;

    let json;
    try {
        json = JSON.stringify(payload);
    } catch (err) {
        console.error('Gridgets: could not serialise last-good payload:', err.message);
        return;
    }
    if (json === undefined)
        return;
    if (json.length > MAX_PAYLOAD_BYTES) {
        console.warn(`Gridgets: last-good payload for ${widgetType} is ${json.length} bytes, not caching`);
        return;
    }

    const state = writeStates.get(filePath) || { timerId: 0, lastJson: null, payload: null, savedAtMs: 0 };
    if (state.lastJson === json)
        return;

    state.lastJson = json;
    state.payload = payload;
    state.savedAtMs = Date.now();
    writeStates.set(filePath, state);
    if (state.timerId)
        return;

    // The closure reads state.payload rather than capturing it, so a newer result that
    // lands mid-debounce is the one that reaches disk.
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
        state.timerId = 0;
        ensureCacheFolder(widgetType);
        saveJsonToFile(filePath, envelopeFor(state.payload, state.savedAtMs));
        return GLib.SOURCE_REMOVE;
    });
}

function imageDirPath(widgetType, widgetId) {
    if (!widgetType || !widgetId)
        return null;
    return GLib.build_filenamev([getGridgetsDataDir(), ARCHIVE_DIR_NAME, IMAGE_DIR_NAME, `${widgetType}-${widgetId}`]);
}

function imageFileName(imageUrl) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, imageUrl, -1);
}

function imageFilePath(widgetType, widgetId, imageUrl) {
    const dirPath = imageDirPath(widgetType, widgetId);
    if (!dirPath || !imageUrl)
        return null;
    return GLib.build_filenamev([dirPath, imageFileName(imageUrl)]);
}

/**
 * Reads a stored thumbnail so a widget restored from its snapshot can paint images with
 * no network at all. Calls back with null when the image was never stored or the read
 * failed, which is the same signal fetchImageBytes uses for "no image".
 */
export function readCachedImageBytes(widgetType, widgetId, imageUrl, callback) {
    const filePath = imageFilePath(widgetType, widgetId, imageUrl);
    if (!filePath) {
        callback(null);
        return;
    }
    const file = Gio.File.new_for_path(filePath);
    file.load_contents_async(null, (source, result) => {
        let bytes = null;
        try {
            const [success, contents] = source.load_contents_finish(result);
            // GJS hands back a Uint8Array here rather than a GLib.Bytes, so it is
            // rewrapped before it can feed a GdkPixbuf input stream.
            if (success && contents.length > 0)
                bytes = new GLib.Bytes(contents);
        } catch (err) {
            if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error('Gridgets: thumbnail read failed:', err.message);
        }
        callback(bytes);
    });
}

/**
 * The `file://` URI a given key maps to, for callers that want to hand the picture to a
 * stylesheet rather than decode it themselves. Empty when the key or the widget is
 * unusable. Pairs with writeCachedImageBytes, so the path is derived once and in one
 * place, and the URI is stable across restarts - which matters because St caches CSS by
 * URL and would otherwise keep showing the first image ever written under that name.
 */
export function cachedImageUri(widgetType, widgetId, imageKey) {
    const filePath = imageFilePath(widgetType, widgetId, imageKey);
    return filePath ? GLib.filename_to_uri(filePath, null) : '';
}

/**
 * Stores a thumbnail against the widget about to display it. `onWritten` runs once the
 * bytes are on disk: a stylesheet pointed at the path earlier shows nothing, silently.
 */
export function writeCachedImageBytes(widgetType, widgetId, imageUrl, bytes, onWritten = null) {
    const filePath = imageFilePath(widgetType, widgetId, imageUrl);
    if (!filePath || !bytes || bytes.get_size() === 0)
        return;
    if (bytes.get_size() > MAX_CACHED_IMAGE_BYTES)
        return;

    const dirPath = imageDirPath(widgetType, widgetId);
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null)) {
        try {
            dir.make_directory_with_parents(null);
        } catch (err) {
            console.error('Gridgets: could not create thumbnail folder:', err.message);
            return;
        }
    }

    Gio.File.new_for_path(filePath).replace_contents_bytes_async(
        bytes, null, false, Gio.FileCreateFlags.NONE, null, (file, res) => {
            try {
                file.replace_contents_finish(res);
            } catch (err) {
                console.error('Gridgets: thumbnail write failed:', err.message);
                return;
            }
            if (onWritten)
                onWritten();
        });
}

/**
 * Drops thumbnails for articles the widget no longer shows, so a widget costs a bounded
 * number of files no matter how long it runs. Call with the full set of image URLs the
 * widget is currently displaying; anything else in the folder is removed.
 */
export function pruneCachedImages(widgetType, widgetId, keepImageUrls) {
    const dirPath = imageDirPath(widgetType, widgetId);
    if (!dirPath)
        return;
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null))
        return;

    const keep = new Set();
    for (const url of keepImageUrls || []) {
        if (url)
            keep.add(imageFileName(url));
    }

    const doomed = [];
    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const name = info.get_name();
        if (!keep.has(name))
            doomed.push(GLib.build_filenamev([dirPath, name]));
    }

    for (const path of doomed)
        deleteFileQuietly(path);
}

/** "just now" / "12m ago" / "3h ago" / "2d ago", for the freshness stamp. */
export function formatSnapshotAge(savedAtMs) {
    if (!savedAtMs)
        return '';
    const elapsed = Date.now() - savedAtMs;
    if (elapsed < MILLISECONDS_PER_MINUTE)
        return 'just now';
    if (elapsed < MILLISECONDS_PER_HOUR)
        return `${Math.floor(elapsed / MILLISECONDS_PER_MINUTE)}m ago`;
    if (elapsed < 24 * MILLISECONDS_PER_HOUR)
        return `${Math.floor(elapsed / MILLISECONDS_PER_HOUR)}h ago`;
    return `${Math.floor(elapsed / (24 * MILLISECONDS_PER_HOUR))}d ago`;
}

/**
 * Removes a widget's snapshot and its thumbnails. Lives here rather than in
 * deleteCacheFile because only this module knows the archive layout, and the generic
 * helper has no business knowing it.
 */
export function deleteLastGoodCache(widgetType, widgetId) {
    const filePath = cacheFilePath(widgetType, widgetId);
    if (!filePath)
        return;
    const state = writeStates.get(filePath);
    if (state && state.timerId)
        GLib.Source.remove(state.timerId);
    writeStates.delete(filePath);
    deleteFileQuietly(filePath);

    deleteFolderQuietly(imageDirPath(widgetType, widgetId));
}

/** Empties a folder before removing it; GIO cannot delete a non-empty directory. */
function deleteFolderQuietly(dirPath) {
    if (!dirPath)
        return;
    const dir = Gio.File.new_for_path(dirPath);
    if (!dir.query_exists(null))
        return;

    const children = [];
    try {
        const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            children.push({
                path: GLib.build_filenamev([dirPath, info.get_name()]),
                isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
            });
        }
    } catch (err) {
        console.error('Gridgets: could not read thumbnail folder:', err.message);
        return;
    }

    for (const child of children) {
        // GIO cannot remove a directory that still has contents, and recursing here would
        // risk following a symlink out of the cache, so anything nested is left and the
        // NOT_EMPTY failure below is reported instead.
        if (child.isDir)
            continue;
        deleteFileQuietly(child.path);
    }

    dir.delete_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.delete_finish(result);
        } catch (err) {
            if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_EMPTY))
                console.error('Gridgets: thumbnail folder delete failed (non-critical):', err.message);
        }
    });
}

function deleteFileQuietly(filePath) {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null))
        return;
    file.delete_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.delete_finish(result);
        } catch (err) {
            console.error('Gridgets: last-good cache delete failed (non-critical):', err.message);
        }
    });
}

/** Drops pending debounced writes so a disable does not leave timers behind. */
export function clearLastGoodCaches() {
    for (const state of writeStates.values()) {
        if (state.timerId)
            GLib.Source.remove(state.timerId);
    }
    writeStates.clear();
}
