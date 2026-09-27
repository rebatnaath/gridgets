import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile } from './widgetUtils.js';
import { createGetMessage } from './httpClient.js';

const LOOKUP_TIMEOUT_SECONDS = 8;
const IMAGE_FETCH_TIMEOUT_SECONDS = 15;
const MAX_CONCURRENT_LOOKUPS = 3;
/** Bounds the stored answers; the file is rewritten in full on every save, so it has to stay small. */
const MAX_CACHED_URLS = 500;
const READ_CHUNK_BYTES = 8192;
/** Kept well under the argument limit of Function.prototype.apply. */
const WIDEN_CHUNK_BYTES = 4096;

const CACHE_SAVE_DELAY_MS = 4000;

/**
 * Aggregator feeds such as Google News publish no image at all, so the only place left to
 * find one is the story page - a wrapper whose open-graph image the aggregator already
 * hosts, which is why a lookup never has to reach the publisher.
 */
const OG_IMAGE_PATTERN = /<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i;
const CONTENT_ATTRIBUTE_PATTERN = /content=["']([^"']+)["']/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * A safety net, not an optimisation. An ordinary publisher puts og:image in <head> and
 * the read stops there, but an aggregator wrapper emits its whole og block last.
 * Measured against Google News: 582KB with the tag at 577KB.
 */
const MAX_PAGE_BYTES = 768 * 1024;

const resolvedUrlCache = new Map();
const inFlightLookups = new Map();
const waitingCallbacks = new Map();
let lookupQueue = [];
let activeLookups = 0;
let cacheLoaded = false;
/** Lookups asked for before the stored answers arrive; replayed once the read lands. */
let cacheLoadWaiters = [];
let saveTimeoutId = 0;

let lookupSession = null;
let fetchSession = null;

function cacheFilePath() {
    return GLib.build_filenamev([getGridgetsDataDir('top-stories'), 'article-images.json']);
}

/**
 * The stored answers are read asynchronously, so a lookup issued before the read lands
 * would miss the cache and refetch a page whose image URL is already on disk. A read
 * that fails still releases the waiters.
 */
function whenCacheLoaded(callback) {
    loadCache();
    if (cacheLoaded)
        callback();
    else
        cacheLoadWaiters.push(callback);
}

function loadCache() {
    if (cacheLoaded)
        return;
    cacheLoaded = true;
    loadJsonFromFileAsync(cacheFilePath(), (data) => {
        if (data && typeof data === 'object') {
            for (const [articleUrl, imageUrl] of Object.entries(data)) {
                if (HTTP_URL_PATTERN.test(imageUrl))
                    resolvedUrlCache.set(articleUrl, imageUrl);
            }
        }
        const waiters = cacheLoadWaiters;
        cacheLoadWaiters = [];
        for (const waiter of waiters)
            waiter();
    });
}

/** Debounced so a burst of resolved articles costs one write rather than one each. */
function scheduleCacheSave() {
    if (saveTimeoutId) return;
    saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CACHE_SAVE_DELAY_MS, () => {
        saveTimeoutId = 0;
        const plain = {};
        for (const [articleUrl, imageUrl] of resolvedUrlCache) plain[articleUrl] = imageUrl;
        saveJsonToFile(cacheFilePath(), plain);
        return GLib.SOURCE_REMOVE;
    });
}

function getSession() {
    if (!lookupSession)
        lookupSession = new Soup.Session({ timeout: LOOKUP_TIMEOUT_SECONDS });
    return lookupSession;
}

function getFetchSession() {
    if (!fetchSession)
        fetchSession = new Soup.Session({ timeout: IMAGE_FETCH_TIMEOUT_SECONDS });
    return fetchSession;
}

function extractOgImage(html) {
    const metaTag = html.match(OG_IMAGE_PATTERN);
    if (!metaTag) return '';
    const content = metaTag[0].match(CONTENT_ATTRIBUTE_PATTERN);
    if (!content) return '';
    const imageUrl = content[1].trim().replace(/&amp;/g, '&');
    return HTTP_URL_PATTERN.test(imageUrl) ? imageUrl : '';
}

function notifyWaiters(articleUrl, imageUrl) {
    const callbacks = waitingCallbacks.get(articleUrl);
    if (!callbacks) return;
    waitingCallbacks.delete(articleUrl);
    for (const callback of callbacks) callback(imageUrl);
}

function startLookup(articleUrl, cancellable) {
    inFlightLookups.set(articleUrl, cancellable);
    activeLookups += 1;
    const session = getSession();
    const message = createGetMessage(articleUrl, { acceptEncoding: 'gzip' });

    if (!message) {
        settleLookup(articleUrl, '');
        return;
    }

    // A synchronous throw here would leave the concurrency counter permanently raised and
    // stall the queue for the rest of the session.
    try {
        session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (sessionObj, result) => {
            if (cancellable.is_cancelled()) {
                settleLookup(articleUrl, '');
                return;
            }
            let stream = null;
            try {
                stream = sessionObj.send_finish(result);
            } catch (_error) {
                settleLookup(articleUrl, '');
                return;
            }
            if (message.status_code !== Soup.Status.OK) {
                stream.close(null);
                settleLookup(articleUrl, '');
                return;
            }
            readUntilImageFound(stream, cancellable, imageUrl => {
                settleLookup(articleUrl, imageUrl);
            });
        });
    } catch (_error) {
        settleLookup(articleUrl, '');
    }
}

/**
 * Bytes are widened one to one rather than UTF-8 decoded: the tag being looked for is
 * ASCII, so a multi-byte character cannot affect the match either way. Converted in one
 * call rather than byte by byte, which matters on a page of hundreds of kilobytes.
 */
function widenBytes(bytes) {
    const data = bytes.get_data();
    let text = '';
    for (let offset = 0; offset < data.length; offset += WIDEN_CHUNK_BYTES) {
        text += String.fromCharCode.apply(null, data.subarray(offset, offset + WIDEN_CHUNK_BYTES));
    }
    return text;
}

/** Reading stops at the match, which for an ordinary publisher means after a few kilobytes. */
function readUntilImageFound(stream, cancellable, done) {
    const reader = new Gio.DataInputStream({ base_stream: stream });
    const buffer = new Uint8Array(READ_CHUNK_BYTES);
    let received = '';
    let settled = false;
    let chunkCount = 0;

    const finish = imageUrl => {
        if (settled) return;
        settled = true;
        reader.close(null);
        done(imageUrl);
    };

    const readChunk = () => {
        if (settled || cancellable.is_cancelled()) {
            finish('');
            return;
        }
        reader.read_bytes_async(buffer.byteLength, GLib.PRIORITY_DEFAULT, cancellable, (streamObj, res) => {
            if (settled) return;
            if (cancellable.is_cancelled()) {
                finish('');
                return;
            }
            let chunk = null;
            try {
                chunk = streamObj.read_bytes_finish(res);
            } catch (_error) {
                finish('');
                return;
            }
            const size = chunk.get_size();
            chunkCount += 1;
            if (size === 0) {
                finish('');
                return;
            }
            received += widenBytes(chunk);
            if (received.length >= MAX_PAGE_BYTES) {
                finish('');
                return;
            }
            const imageUrl = extractOgImage(received);
            if (imageUrl) {
                finish(imageUrl);
                return;
            }
            readChunk();
        });
    };

    readChunk();
}

function settleLookup(articleUrl, imageUrl) {
    // The cancellable belongs to the caller, which shares one across every lookup,
    // image download and decode it starts, so it must never be cancelled here.
    inFlightLookups.delete(articleUrl);
    activeLookups = Math.max(0, activeLookups - 1);
    if (imageUrl) {
        rememberResolvedUrl(articleUrl, imageUrl);
        scheduleCacheSave();
    }
    notifyWaiters(articleUrl, imageUrl);
    const next = lookupQueue.shift();
    if (next)
        startLookup(next.articleUrl, next.cancellable);
}

/** Oldest answers are dropped first, so the file cannot grow without limit. */
function rememberResolvedUrl(articleUrl, imageUrl) {
    resolvedUrlCache.delete(articleUrl);
    resolvedUrlCache.set(articleUrl, imageUrl);
    while (resolvedUrlCache.size > MAX_CACHED_URLS)
        resolvedUrlCache.delete(resolvedUrlCache.keys().next().value);
}

/**
 * Calls back with '' when there is none. A cached answer arrives on the same tick once
 * the stored cache has loaded, so a widget rebuilt from cache never waits on the network.
 */
export function resolveArticleImageUrl(articleUrl, cancellable, callback) {
    if (!HTTP_URL_PATTERN.test(articleUrl)) {
        callback('');
        return;
    }
    whenCacheLoaded(() => {
        if (resolvedUrlCache.has(articleUrl)) {
            callback(resolvedUrlCache.get(articleUrl));
            return;
        }
        const waiting = waitingCallbacks.get(articleUrl);
        if (waiting) {
            waiting.push(callback);
            return;
        }
        waitingCallbacks.set(articleUrl, [callback]);
        if (activeLookups < MAX_CONCURRENT_LOOKUPS)
            startLookup(articleUrl, cancellable);
        else
            lookupQueue.push({ articleUrl, cancellable });
    });
}

export function fetchImageBytes(imageUrl, cancellable, callback) {
    const message = createGetMessage(imageUrl);
    if (!message) {
        callback(null);
        return;
    }
    getFetchSession().send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
        if (cancellable.is_cancelled()) {
            callback(null);
            return;
        }
        try {
            const bytes = session.send_and_read_finish(result);
            if (!bytes || bytes.get_size() === 0 || message.status_code !== Soup.Status.OK) {
                callback(null);
                return;
            }
            callback(bytes);
        } catch (_error) {
            callback(null);
        }
    });
}

/** Frees the cached answers and the queues behind them. Called from disable(). */
export function clearArticleImageCache() {
    inFlightLookups.clear();
    lookupQueue = [];
    waitingCallbacks.clear();
    cacheLoadWaiters = [];
    resolvedUrlCache.clear();
    activeLookups = 0;
    if (saveTimeoutId) {
        GLib.Source.remove(saveTimeoutId);
        saveTimeoutId = 0;
    }
    if (lookupSession) {
        lookupSession.abort();
        lookupSession = null;
    }
    if (fetchSession) {
        fetchSession.abort();
        fetchSession = null;
    }
}
