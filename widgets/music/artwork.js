import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const DOMINANT_COLOR_SAMPLE_SIZE = 64;
const DOMINANT_COLOR_BUCKET_QUANTUM = 16;
const DOMINANT_COLOR_MIN_BRIGHTNESS = 30;

const DOMINANT_COLOR_CACHE_LIMIT = 50;

const dominantColorCache = new Map();

const artworkFileCache = new Map();
const ARTWORK_FILE_CACHE_LIMIT = 50;

const artworkDownloadQueue = new Map();

/** In-flight artwork downloads keyed by URL, so disable() can cancel pending transfers. */
const activeArtworkDownloads = new Map();

/** Failed remote-download attempts per URL, so dead URLs are not retried forever by the MPRIS poll. */
const failedArtworkDownloadAttempts = new Map();

const MUSIC_ART_CACHE_DIR = `${GLib.get_user_cache_dir()}/gridgets/music-art`;

export async function extractDominantColor(filePath, state) {
    if (dominantColorCache.has(filePath)) return dominantColorCache.get(filePath);

    let color = null;
    try {
        const pixbuf = await loadScaledPixbuf(filePath, state.artworkCancellable);
        color = computeDominantColorFromPixbuf(pixbuf);
    } catch (error) {
        console.error(`Gridgets: cannot read artwork for its dominant colour: ${filePath}`, error.message);
        return null;
    }
    if (color) {
        if (dominantColorCache.size >= DOMINANT_COLOR_CACHE_LIMIT) {
            dominantColorCache.delete(dominantColorCache.keys().next().value);
        }
        dominantColorCache.set(filePath, color);
    }
    return color;
}

async function loadScaledPixbuf(filePath, cancellable) {
    const file = Gio.File.new_for_path(filePath);
    const stream = await new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
            try {
                resolve(file.read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
    return new Promise((resolve, reject) => {
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream,
            DOMINANT_COLOR_SAMPLE_SIZE,
            DOMINANT_COLOR_SAMPLE_SIZE,
            true,
            cancellable,
            (_source, result) => {
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

/** Groups pixels into fine colour buckets and returns the most populated bucket's average. */
function computeDominantColorFromPixbuf(pixbuf) {
    if (!pixbuf) return null;

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const nChannels = pixbuf.get_n_channels();
    const rowstride = pixbuf.get_rowstride();
    const pixels = pixbuf.get_pixels();

    const buckets = new Map();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = y * rowstride + x * nChannels;
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];

            const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
            if (brightness < DOMINANT_COLOR_MIN_BRIGHTNESS) continue;

            const key = `${Math.floor(red / DOMINANT_COLOR_BUCKET_QUANTUM)},`
                + `${Math.floor(green / DOMINANT_COLOR_BUCKET_QUANTUM)},`
                + `${Math.floor(blue / DOMINANT_COLOR_BUCKET_QUANTUM)}`;

            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
                buckets.set(key, bucket);
            }
            bucket.count++;
            bucket.rSum += red;
            bucket.gSum += green;
            bucket.bSum += blue;
        }
    }

    let bestBucket = null;
    for (const bucket of buckets.values()) {
        if (!bestBucket || bucket.count > bestBucket.count)
            bestBucket = bucket;
    }

    if (!bestBucket) return null;
    const toHexByte = (sum) => Math.min(255, Math.round(sum / bestBucket.count)).toString(16).padStart(2, '0');
    return `#${toHexByte(bestBucket.rSum)}${toHexByte(bestBucket.gSum)}${toHexByte(bestBucket.bSum)}`;
}

function rememberArtworkFile(artUrl, filePath) {
    if (artworkFileCache.size >= ARTWORK_FILE_CACHE_LIMIT && !artworkFileCache.has(artUrl))
        artworkFileCache.delete(artworkFileCache.keys().next().value);
    artworkFileCache.set(artUrl, filePath);
}

/** A file's modified time as a string, or '' when it cannot be read. */
function fileModifiedStamp(path) {
    try {
        const info = Gio.File.new_for_path(path)
            .query_info(Gio.FILE_ATTRIBUTE_TIME_MODIFIED, Gio.FileQueryInfoFlags.NONE, null);
        return info ? info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED).toString() : '';
    } catch (_error) {
        return '';
    }
}

/** True only for a file that exists and has bytes in it; a zero-length copy is no artwork. */
function hasArtworkBytes(path) {
    try {
        const info = Gio.File.new_for_path(path)
            .query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE, Gio.FileQueryInfoFlags.NONE, null);
        return info !== null && info.get_size() > 0;
    } catch (_error) {
        return false;
    }
}

function getArtworkCachePath(artUrl, sourcePath = null) {
    // A player can reuse one path for every track, so the URL alone would keep resolving
    // to the first track's copy. The source's modified time changes, so it goes in the key.
    const key = sourcePath === null
        ? artUrl
        : `${artUrl}|${fileModifiedStamp(sourcePath)}`;
    const urlHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, key, -1);
    return GLib.build_filenamev([MUSIC_ART_CACHE_DIR, urlHash]);
}

// Generous because a player fetches the cover before writing the file. Timing out costs
// nothing: the current artwork stays and the next poll tries again.
const FILE_ENUM_BATCH_SIZE = 20;
const ARTWORK_RETRY_INTERVAL_MS = 500;
const ARTWORK_RETRY_MAX_ATTEMPTS = 20;

function fileExists(file) {
    return new Promise(resolve => {
        file.query_info_async(
            Gio.FILE_ATTRIBUTE_STANDARD_NAME,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                try {
                    source.query_info_finish(result);
                    resolve(true);
                } catch (_error) {
                    resolve(false);
                }
            }
        );
    });
}

/**
 * Copies a player's art file into the cache and calls back once it is there.
 *
 * St loads a background lazily, so a stylesheet pointing at a file the player still owns
 * can lose the picture between the check and the paint.
 */
function copyArtworkIntoCache(sourcePath, artUrl, state, callback) {
    const destinationPath = getArtworkCachePath(artUrl, sourcePath);
    const destination = Gio.File.new_for_path(destinationPath);
    if (destination.query_exists(null)) {
        rememberArtworkFile(artUrl, destinationPath);
        callback(destinationPath);
        return;
    }

    const pending = artworkDownloadQueue.get(artUrl);
    if (pending) {
        pending.push({ state, callback });
        return;
    }
    artworkDownloadQueue.set(artUrl, [{ state, callback }]);

    ensureDirectoryTree(Gio.File.new_for_path(MUSIC_ART_CACHE_DIR)).then(ready => {
        if (!ready) {
            console.error(`Gridgets: cannot create the artwork cache directory: ${MUSIC_ART_CACHE_DIR}`);
            flushArtworkQueue(artUrl, null);
            return;
        }
        Gio.File.new_for_path(sourcePath).copy_async(
            destination,
            Gio.FileCopyFlags.OVERWRITE,
            GLib.PRIORITY_DEFAULT,
            state.artworkCancellable,
            null,
            (source, result) => {
                try {
                    source.copy_finish(result);
                    rememberArtworkFile(artUrl, destinationPath);
                    flushArtworkQueue(artUrl, destinationPath);
                } catch (error) {
                    if (state.artworkCancellable.is_cancelled())
                        return;
                    console.error(`Gridgets: cannot cache artwork from ${sourcePath}:`, error.message);
                    flushArtworkQueue(artUrl, null);
                }
            }
        );
    });
}

/**
 * The most recently modified picture in a directory, or null when there is none.
 *
 * A player that deletes the path it advertised without sending a new one leaves its
 * folder as the only place the current artwork is still named.
 */
function newestArtworkIn(directory) {
    return new Promise(resolve => {
        directory.enumerate_children_async(
            'standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                let enumerator = null;
                try {
                    enumerator = source.enumerate_children_finish(result);
                } catch (_error) {
                    resolve(null);
                    return;
                }

                let newest = null;
                let newestTime = -1;
                const readBatch = () => {
                    enumerator.next_files_async(FILE_ENUM_BATCH_SIZE, GLib.PRIORITY_DEFAULT, null, (enumSource, nextResult) => {
                        let infos = null;
                        try {
                            infos = enumSource.next_files_finish(nextResult);
                        } catch (_error) {
                            enumerator.close(null);
                            resolve(newest);
                            return;
                        }
                        if (infos.length === 0) {
                            enumerator.close(null);
                            resolve(newest);
                            return;
                        }
                        for (const info of infos) {
                            const name = info.get_name();
                            if (!/\.(png|jpe?g|webp)$/i.test(name))
                                continue;
                            const mtime = info.get_attribute_uint64('time::modified');
                            if (mtime > newestTime) {
                                newestTime = mtime;
                                newest = directory.get_child(name).get_path();
                            }
                        }
                        readBatch();
                    });
                };
                readBatch();
            }
        );
    });
}

function makeDirectory(dir) {
    return new Promise(resolve => {
        dir.make_directory_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                source.make_directory_finish(result);
                resolve(true);
            } catch (_error) {
                resolve(false);
            }
        });
    });
}

async function ensureDirectoryTree(dir) {
    if (await fileExists(dir)) return true;
    const parent = dir.get_parent();
    if (parent && !(await ensureDirectoryTree(parent))) return false;
    return (await makeDirectory(dir)) || (await fileExists(dir));
}

function flushArtworkQueue(artUrl, resolvedPath) {
    const queued = artworkDownloadQueue.get(artUrl);
    if (!queued) return;
    artworkDownloadQueue.delete(artUrl);
    queued.forEach(entry => {
        if (!entry.state.container || isActorDestroyed(entry.state.container)) return;
        entry.callback(resolvedPath);
    });
}

/**
 * Each wait owns its own source and resolver, tracked in state.artworkRetryWaits, so
 * concurrent waits cannot overwrite each other and teardown can settle them all.
 */
function waitForArtworkRetry(state) {
    return new Promise(resolve => {
        const wait = {
            timeoutId: null,
            settled: false,
            settle(settledResult) {
                if (wait.settled) return;
                wait.settled = true;
                if (wait.timeoutId) {
                    GLib.Source.remove(wait.timeoutId);
                    wait.timeoutId = null;
                }
                state.artworkRetryWaits.delete(wait);
                resolve(settledResult);
            },
        };
        if (!state.artworkRetryWaits) state.artworkRetryWaits = new Set();
        state.artworkRetryWaits.add(wait);
        wait.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ARTWORK_RETRY_INTERVAL_MS, () => {
            wait.timeoutId = null;
            wait.settle(true);
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** A path the player already has, copied into our cache so it cannot be taken away. */
async function usePlayerFile(artUrl, source, state, callback) {
    const cachePath = getArtworkCachePath(artUrl, source);
    if (hasArtworkBytes(cachePath)) {
        rememberArtworkFile(artUrl, cachePath);
        callback(cachePath);
        return;
    }
    copyArtworkIntoCache(source, artUrl, state, callback);
}

/**
 * A file:// path, which a player owns and may replace or delete under us.
 */
async function resolvePlayerFile(artUrl, state, callback) {
    const localFile = artUrl.startsWith('file://') ? Gio.File.new_for_uri(artUrl) : Gio.File.new_for_path(artUrl);
    const localPath = artUrl.startsWith('file://') ? localFile.get_path() : artUrl;

    if (await fileExists(localFile)) {
        await usePlayerFile(artUrl, localPath, state, callback);
        return;
    }

    // The advertised path can already be gone: Firefox deletes it on a track change
    // and never sends a new one, so the folder is where the artwork now lives.
    const directory = localFile.get_parent();
    for (let attempt = 0; attempt < ARTWORK_RETRY_MAX_ATTEMPTS; attempt++) {
        const newest = directory && await fileExists(directory)
            ? await newestArtworkIn(directory)
            : null;
        if (newest) {
            if (newest !== localPath && state.lastLoggedReplacement !== newest) {
                state.lastLoggedReplacement = newest;
                console.error(`Gridgets: ${localPath} is gone, using the player's current artwork: ${newest}`);
            }
            await usePlayerFile(artUrl, newest, state, callback);
            return;
        }
        const waitSettled = await waitForArtworkRetry(state);
        if (!waitSettled || isActorDestroyed(state.container))
            return;
    }
    console.error(`Gridgets: no artwork found for ${localPath}, keeping the current one`);
}

/**
 * A remote URL, downloaded into the user cache first because an St CSS background cannot
 * load one. Concurrent requests for the same URL share a single transfer.
 */
async function resolveRemoteArtwork(artUrl, state, callback) {
    if (artworkFileCache.has(artUrl)) {
        const cachedPath = artworkFileCache.get(artUrl);
        if (await fileExists(Gio.File.new_for_path(cachedPath))) {
            callback(cachedPath);
            return;
        }
        artworkFileCache.delete(artUrl);
    }

    const filePath = getArtworkCachePath(artUrl);
    const localFile = Gio.File.new_for_path(filePath);
    if (await fileExists(localFile)) {
        rememberArtworkFile(artUrl, filePath);
        callback(filePath);
        return;
    }

    if ((failedArtworkDownloadAttempts.get(artUrl) || 0) >= ARTWORK_RETRY_MAX_ATTEMPTS) {
        console.error(`Gridgets: giving up on artwork after ${ARTWORK_RETRY_MAX_ATTEMPTS} failed downloads: ${artUrl}`);
        callback(null);
        return;
    }

    const pending = artworkDownloadQueue.get(artUrl);
    if (pending) {
        pending.push({ state, callback });
        return;
    }
    artworkDownloadQueue.set(artUrl, [{ state, callback }]);

    if (!(await ensureDirectoryTree(Gio.File.new_for_path(MUSIC_ART_CACHE_DIR)))) {
        console.error(`Gridgets: cannot create the artwork cache directory: ${MUSIC_ART_CACHE_DIR}`);
        failedArtworkDownloadAttempts.set(artUrl, (failedArtworkDownloadAttempts.get(artUrl) || 0) + 1);
        flushArtworkQueue(artUrl, null);
        return;
    }

    const downloadCancellable = new Gio.Cancellable();
    activeArtworkDownloads.set(artUrl, downloadCancellable);

    Gio.File.new_for_uri(artUrl).copy_async(
        localFile,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_DEFAULT,
        downloadCancellable,
        null,
        (source, result) => {
            activeArtworkDownloads.delete(artUrl);
            try {
                source.copy_finish(result);
                failedArtworkDownloadAttempts.delete(artUrl);
                rememberArtworkFile(artUrl, filePath);
                flushArtworkQueue(artUrl, filePath);
            } catch (e) {
                if (downloadCancellable.is_cancelled()) {
                    console.error(`Gridgets: artwork download cancelled for ${artUrl}`);
                } else {
                    const attempt = (failedArtworkDownloadAttempts.get(artUrl) || 0) + 1;
                    failedArtworkDownloadAttempts.set(artUrl, attempt);
                    console.error(`Gridgets: artwork download failed (${attempt}/${ARTWORK_RETRY_MAX_ATTEMPTS}) for ${artUrl}:`, e.message);
                }
                flushArtworkQueue(artUrl, null);
            }
        }
    );
}

/**
 * Resolves an art URL to a path on disk, or calls back null when there is none.
 *
 * A file the player owns is looked for where the player keeps it; a remote one is
 * downloaded into the cache. A missing file is retried on timers held in
 * state.artworkRetryWaits, so they can all be cleared on widget destruction.
 */
export async function ensureLocalArtwork(artUrl, state, callback) {
    if (!artUrl) {
        callback(null);
        return;
    }
    if (artUrl.startsWith('http://') || artUrl.startsWith('https://'))
        await resolveRemoteArtwork(artUrl, state, callback);
    else
        await resolvePlayerFile(artUrl, state, callback);
}

/** Clears module-level runtime caches and cancels in-flight downloads; called from the extension's disable(). */
export function clearArtworkCaches() {
    for (const cancellable of activeArtworkDownloads.values()) {
        cancellable.cancel();
    }
    activeArtworkDownloads.clear();
    artworkDownloadQueue.clear();
    dominantColorCache.clear();
    artworkFileCache.clear();
    failedArtworkDownloadAttempts.clear();
}
