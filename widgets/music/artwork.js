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

export async function extractDominantColor(filePath) {
    if (dominantColorCache.has(filePath)) return dominantColorCache.get(filePath);

    let color = null;
    try {
        const pixbuf = await loadScaledPixbuf(filePath);
        color = computeDominantColorFromPixbuf(pixbuf);
    } catch (_error) {
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

/** Asynchronously decodes a small thumbnail of the image without blocking the main loop. */
async function loadScaledPixbuf(filePath) {
    const file = Gio.File.new_for_path(filePath);
    const stream = await new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
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
            null,
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

/**
 * Samples every pixel of a decoded pixbuf, grouping them into fine color buckets,
 * returning the average color of the most populated bucket.
 */
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
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];

            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness < DOMINANT_COLOR_MIN_BRIGHTNESS) continue;

            const key = `${Math.floor(r / DOMINANT_COLOR_BUCKET_QUANTUM)},`
                + `${Math.floor(g / DOMINANT_COLOR_BUCKET_QUANTUM)},`
                + `${Math.floor(b / DOMINANT_COLOR_BUCKET_QUANTUM)}`;

            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
                buckets.set(key, bucket);
            }
            bucket.count++;
            bucket.rSum += r;
            bucket.gSum += g;
            bucket.bSum += b;
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

function getArtworkCachePath(artUrl) {
    const urlHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, artUrl, -1);
    return GLib.build_filenamev([MUSIC_ART_CACHE_DIR, urlHash]);
}

const ARTWORK_RETRY_INTERVAL_MS = 500;
const ARTWORK_RETRY_MAX_ATTEMPTS = 6;

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

function findLatestModifiedPng(parentDir) {
    return new Promise(resolve => {
        parentDir.enumerate_children_async(
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

                const selectLatest = (latestPng, latestTime) => {
                    enumerator.next_files_async(20, GLib.PRIORITY_DEFAULT, null, (enumSource, nextResult) => {
                        let infos = null;
                        try {
                            infos = enumSource.next_files_finish(nextResult);
                        } catch (_error) {
                            enumerator.close(null);
                            resolve(latestPng);
                            return;
                        }
                        if (infos.length === 0) {
                            enumerator.close(null);
                            resolve(latestPng);
                            return;
                        }
                        let bestPng = latestPng;
                        let bestTime = latestTime;
                        for (const info of infos) {
                            const name = info.get_name();
                            if (!name.endsWith('.png')) continue;
                            const mtime = info.get_attribute_uint64('time::modified');
                            if (mtime > bestTime) {
                                bestTime = mtime;
                                bestPng = parentDir.get_child(name).get_path();
                            }
                        }
                        selectLatest(bestPng, bestTime);
                    });
                };

                selectLatest(null, 0);
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
    artworkDownloadQueue.delete(artUrl);
    queued.forEach(entry => {
        if (!entry.state.container || isActorDestroyed(entry.state.container)) return;
        entry.callback(resolvedPath);
    });
}

/**
 * Creates one retry wait for a state. Each call owns its own timeout source and
 * resolver, tracked in state.artworkRetryWaits, so concurrent waits cannot
 * overwrite each other and destroy-cleanup can settle all of them at once.
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

/**
 * Resolves an MPRIS artwork URL to a local file path.
 * Remote http(s) URLs are downloaded once into the user cache directory since
 * St CSS backgrounds cannot load remote URLs directly. Missing local files are
 * retried a few times on independent timers tracked in state.artworkRetryWaits
 * so they can be removed on widget destruction.
 */
export async function ensureLocalArtwork(artUrl, state, callback) {
    if (!artUrl) {
        callback(null);
        return;
    }

    if (!artUrl.startsWith('http://') && !artUrl.startsWith('https://')) {
        const localFile = artUrl.startsWith('file://') ? Gio.File.new_for_uri(artUrl) : Gio.File.new_for_path(artUrl);
        if (await fileExists(localFile)) {
            callback(artUrl.startsWith('file://') ? localFile.get_path() : artUrl);
            return;
        }

        const parentDir = localFile.get_parent();
        if (parentDir && await fileExists(parentDir)) {
            const latestPng = await findLatestModifiedPng(parentDir);
            if (latestPng) {
                callback(latestPng);
                return;
            }
        }

        let attempts = 0;
        while (attempts < ARTWORK_RETRY_MAX_ATTEMPTS) {
            const waitSettled = await waitForArtworkRetry(state);
            if (!waitSettled || isActorDestroyed(state.container)) return;
            attempts++;
            if (await fileExists(localFile)) {
                callback(artUrl.startsWith('file://') ? localFile.get_path() : artUrl);
                return;
            }
        }
        callback(null);
        return;
    }

    if (artworkFileCache.has(artUrl)) {
        callback(artworkFileCache.get(artUrl));
        return;
    }

    const filePath = getArtworkCachePath(artUrl);
    const localFile = Gio.File.new_for_path(filePath);
    if (await fileExists(localFile)) {
        if (artworkFileCache.size >= ARTWORK_FILE_CACHE_LIMIT)
            artworkFileCache.delete(artworkFileCache.keys().next().value);
        artworkFileCache.set(artUrl, filePath);
        callback(filePath);
        return;
    }

    if ((failedArtworkDownloadAttempts.get(artUrl) || 0) >= ARTWORK_RETRY_MAX_ATTEMPTS) {
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
                if (artworkFileCache.size >= ARTWORK_FILE_CACHE_LIMIT)
                    artworkFileCache.delete(artworkFileCache.keys().next().value);
                artworkFileCache.set(artUrl, filePath);
                flushArtworkQueue(artUrl, filePath);
            } catch (e) {
                if (!downloadCancellable.is_cancelled()) {
                    failedArtworkDownloadAttempts.set(artUrl, (failedArtworkDownloadAttempts.get(artUrl) || 0) + 1);
                }
                flushArtworkQueue(artUrl, null);
            }
        }
    );
}

/** Clears module-level runtime caches and cancels in-flight downloads; called from the extension's disable(). */
export function clearArtworkCaches() {
    for (const cancellable of activeArtworkDownloads.values()) {
        cancellable.cancel();
    }
    activeArtworkDownloads.clear();
    dominantColorCache.clear();
    artworkFileCache.clear();
    failedArtworkDownloadAttempts.clear();
}
