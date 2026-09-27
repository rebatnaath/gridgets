import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import { subscribeToSettledConnectivity } from './connectivity.js';
import { hostLabelFromUrl } from './feedText.js';
import { createGetMessage } from './httpClient.js';

const HTTP_STATUS_NOT_MODIFIED = 304;
const MAX_FEED_ITEMS = 50;
const FETCH_TIMEOUT_SECONDS = 30;
const MAX_SUMMARY_LENGTH = 300;

const decoder = new TextDecoder('utf-8');
const feedCache = new Map();

/** Minimal RSS 2.0 / Atom extractor — tag-level parsing avoids a full DOM parser. */

/** Decodes the XML entities feeds commonly emit inside text nodes. */
function decodeXmlEntities(text) {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Strips CDATA wrappers and any embedded HTML tags from feed text. */
function cleanFeedText(rawText) {
    if (!rawText) return '';
    const withoutCdata = rawText.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const withoutTags = withoutCdata.replace(/<!--([\s\S]*?)-->|<[^>]+>/g, ' ');
    const decoded = decodeXmlEntities(withoutTags);
    return decoded.replace(/<!--([\s\S]*?)-->|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Returns the inner text of the first `<tag>` occurrence inside `block`. */
function extractTagText(block, tagName) {
    const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\/${tagName}>`, 'i');
    const match = block.match(pattern);
    return match ? match[1].trim() : '';
}

/**
 * Resolves an item's link across RSS (<link>text</link>) and Atom
 * (<link rel="alternate" href="..." />) conventions.
 */
function extractItemLink(block) {
    const rssLink = extractTagText(block, 'link');
    if (rssLink && /^https?:\/\//i.test(cleanFeedText(rssLink))) {
        return cleanFeedText(rssLink);
    }

    const atomLinkPattern = /<link\b[^>]*\brel=["']?alternate["']?[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i;
    const atomMatch = block.match(atomLinkPattern);
    if (atomMatch) {
        return decodeXmlEntities(atomMatch[1]);
    }
    const anyHrefMatch = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
    return anyHrefMatch ? decodeXmlEntities(anyHrefMatch[1]) : '';
}

/** Returns the first capture of `pattern` inside `block`, decoded, or '' when absent. */
function extractAttribute(block, pattern) {
    const match = block.match(pattern);
    return match ? decodeXmlEntities(match[1]).trim() : '';
}

/**
 * Picks the image a feed publishes for an item. Feeds disagree on where it lives, so
 * the namespaces are tried in order of how often they carry one, and the item's own
 * markup is the last resort because cleaning the text has already thrown the tags away.
 */
function extractItemImage(block, rawSummary) {
    const mediaRss = extractAttribute(block, /<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i);
    if (mediaRss) return absoluteUrl(mediaRss);

    const mediaContent = extractAttribute(block,
        /<media:content\b(?=[^>]*\burl=["']([^"']+)["'])(?=[^>]*(?:\btype=["']image\/|\bmedium=["']image["']))[^>]*>/i);
    if (mediaContent) return absoluteUrl(mediaContent);

    const enclosure = extractAttribute(block, /<enclosure\b(?=[^>]*\btype=["']image\/)[^>]*\burl=["']([^"']+)["']/i);
    if (enclosure) return absoluteUrl(enclosure);

    const rssImage = extractTagText(block, 'image');
    if (rssImage) {
        const nested = extractTagText(rssImage, 'url') || rssImage;
        if (/^https?:\/\//i.test(nested)) return nested;
    }

    return extractAttribute(rawSummary, /<img\b[^>]*\bsrc=["']([^"']+)["']/i);
}

/** Feed image URLs are often relative; without a base they cannot be fetched. */
function absoluteUrl(candidate) {
    return /^https?:\/\//i.test(candidate) ? candidate : '';
}

/** Publisher name for an item, which aggregator feeds carry in <source>. */
function extractItemSource(block) {
    const source = cleanFeedText(extractTagText(block, 'source'));
    if (source) return source;
    const sourceUrl = extractAttribute(block, /<source\b[^>]*\burl=["']([^"']+)["']/i);
    return sourceUrl ? hostLabelFromUrl(sourceUrl) : '';
}

/**
 * Aggregator feeds repeat the publisher as a title suffix ("Headline - The Times").
 * Left in, a card that also shows the source reads it twice.
 */
function stripSourceSuffix(title, source) {
    if (!source) return title;
    const suffix = ` - ${source}`;
    return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

/** Normalizes a single RSS or Atom entry. */
function parseEntry(block) {
    const source = extractItemSource(block);
    const rawSummary = extractTagText(block, 'description') || extractTagText(block, 'summary') || extractTagText(block, 'content');
    const rawTitle = cleanFeedText(extractTagText(block, 'title'));
    const link = extractItemLink(block);
    const guid = cleanFeedText(extractTagText(block, 'guid'));
    const atomId = cleanFeedText(extractTagText(block, 'id'));
    const dateRfc = cleanFeedText(extractTagText(block, 'pubDate'));
    const dateIso = cleanFeedText(extractTagText(block, 'updated')) || cleanFeedText(extractTagText(block, 'published'));

    return {
        id: guid || atomId || link || rawTitle,
        title: stripSourceSuffix(rawTitle, source),
        link,
        summary: cleanFeedText(rawSummary).slice(0, MAX_SUMMARY_LENGTH),
        dateIso: normalizeDateString(dateIso || dateRfc),
        source,
        image: extractItemImage(block, rawSummary),
    };
}

/** Converts RFC-822 or ISO-8601 feed dates to ISO-8601; unparseable dates become ''. */
function normalizeDateString(rawDate) {
    if (!rawDate) return '';
    const parsedMs = Date.parse(rawDate);
    return isNaN(parsedMs) ? '' : new Date(parsedMs).toISOString();
}

/** Parses a full feed document into { title, items: [...] }; returns null when nothing usable is found. */
function parseFeed(xmlText) {
    if (!xmlText) return null;

    const channelTitle = cleanFeedText(extractTagText(xmlText, 'title'));
    const itemBlocks = [
        ...(xmlText.match(/<item[\s>][\s\S]*?<\/item>/gi) || []),
        ...(xmlText.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []),
    ];

    const seenIds = new Set();
    const items = [];
    for (const block of itemBlocks) {
        const entry = parseEntry(block);
        if (!entry.id || !entry.title || seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        items.push(entry);
        if (items.length >= MAX_FEED_ITEMS) break;
    }

    if (items.length === 0 && !channelTitle) return null;
    return { title: channelTitle, items };
}

/** Shared per-URL polling engine with reference counting; conditional-GET via ETag/Last-Modified. */
class RssFeedEngine {
    constructor(feedUrl) {
        this.feedUrl = feedUrl;
        this.session = new Soup.Session({ timeout: FETCH_TIMEOUT_SECONDS });
        this.subscribers = new Map();
        this.timerId = null;
        this.cancellable = null;
        this.lastItems = feedCache.get(feedUrl) || [];
        this._activeIntervalSeconds = null;
        this.etag = null;
        this.lastModified = null;
        this.lastFetchFailed = false;
        this.releaseConnectivity = null;

        this._runFetch = this._runFetch.bind(this);
    }

    /**
     * Registers a subscriber; polling runs at the fastest requested interval.
     *
     * The callback is invoked with (items, isFetchResult). `isFetchResult` is false only
     * for the synchronous hand-off of whatever is already cached, which on a first ever
     * load is nothing at all. A widget that treats that empty list as a failed fetch
     * flashes its offline notice before the first request has even completed, so the
     * distinction has to be part of the callback rather than something a caller infers
     * from an empty array.
     */
    subscribe(intervalSeconds, callback) {
        this.subscribers.set(callback, intervalSeconds);
        const fastestInterval = Math.min(...this.subscribers.values());
        // Cached items are delivered to every new subscriber, including the first.
        // Otherwise a widget recreated for a feed that is already cached shows
        // nothing until a fetch happens to succeed.
        callback(this.lastItems, false);
        if (this.subscribers.size === 1) {
            this._startTimer(fastestInterval);
            this._watchConnectivity();
            this._runFetch();
            return () => this.unsubscribe(callback);
        }
        if (fastestInterval !== this._activeIntervalSeconds && this.timerId)
            this._startTimer(fastestInterval);
        return () => this.unsubscribe(callback);
    }

    unsubscribe(callback) {
        this.subscribers.delete(callback);
        if (this.subscribers.size > 0) {
            const fastestInterval = Math.min(...this.subscribers.values());
            if (fastestInterval !== this._activeIntervalSeconds && this.timerId)
                this._startTimer(fastestInterval);
            return;
        }
        this.destroy();
    }

    _watchConnectivity() {
        // One subscription per feed covers every widget on it, so a widget added
        // while offline refetches as soon as the network returns instead of
        // waiting out the whole poll interval. The settled variant is used because
        // subscribe() has already issued the first fetch by the time this runs.
        this.releaseConnectivity = subscribeToSettledConnectivity(available => {
            if (available && this.subscribers.size > 0)
                this._runFetch();
        });
    }

    destroy() {
        if (this.releaseConnectivity) {
            this.releaseConnectivity();
            this.releaseConnectivity = null;
        }
        if (this.timerId) {
            GLib.Source.remove(this.timerId);
            this.timerId = null;
        }
        if (this.cancellable) {
            this.cancellable.cancel();
            this.cancellable = null;
        }
        this.session.abort();
        this.session = null;
    }

    _startTimer(intervalSeconds) {
        if (this.timerId) {
            GLib.Source.remove(this.timerId);
        }
        this._activeIntervalSeconds = intervalSeconds;
        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
            this._runFetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _runFetch() {
        if (this.cancellable) {
            this.cancellable.cancel();
        }
        this.cancellable = new Gio.Cancellable();

        const message = createGetMessage(this.feedUrl);
        if (!message) {
            this._notifySubscribers(this.lastItems);
            return;
        }
        if (this.etag) {
            message.request_headers.append('If-None-Match', this.etag);
        }
        if (this.lastModified) {
            message.request_headers.append('If-Modified-Since', this.lastModified);
        }

        const fetchCancellable = this.cancellable;
        this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, fetchCancellable, (sessionObj, result) => {
            if (fetchCancellable.is_cancelled()) return;

            let bodyText = null;
            try {
                const bytes = sessionObj.send_and_read_finish(result);
                if (bytes) {
                    bodyText = decoder.decode(bytes.get_data());
                }
            } catch (error) {
                this._logFetchFailure(`RSS fetch failed for ${this.feedUrl}: ${error.message}`);
                this._notifySubscribers(this.lastItems);
                return;
            }

            if (message.status_code === HTTP_STATUS_NOT_MODIFIED) {
                this.lastFetchFailed = false;
                this._notifySubscribers(this.lastItems);
                return;
            }
            if (message.status_code !== Soup.Status.OK || bodyText === null) {
                this._logFetchFailure(`RSS feed ${this.feedUrl} returned status ${message.status_code}`);
                this._notifySubscribers(this.lastItems);
                return;
            }

            this.lastFetchFailed = false;
            this.etag = message.response_headers.get_one('ETag') || null;
            this.lastModified = message.response_headers.get_one('Last-Modified') || null;

            const parsed = parseFeed(bodyText);
            this.lastItems = parsed ? parsed.items : this.lastItems;
            feedCache.set(this.feedUrl, this.lastItems);
            this._notifySubscribers(this.lastItems);
        });
    }

    /** Logs a fetch failure only when it starts, so a down feed does not spam the journal every poll. */
    _logFetchFailure(messageText) {
        if (this.lastFetchFailed) return;
        this.lastFetchFailed = true;
        console.error(messageText);
    }

    /** Every one of these runs after a fetch has completed or definitively failed. */
    _notifySubscribers(items) {
        const callbacks = [...this.subscribers.keys()];
        for (const callback of callbacks) {
            callback(items, true);
        }
    }
}

/** Active engines keyed by feed URL; released when the last subscriber unsubscribes. */
const activeEngines = new Map();

/** Clears all cached engines; called from the extension's disable(). */
export function clearRssEngines() {
    for (const engine of activeEngines.values())
        engine.destroy();
    activeEngines.clear();
    feedCache.clear();
}

/**
 * Gets (or creates) the shared engine for a feed URL and subscribes to it.
 * The returned function releases the subscription and has to be called on destroy.
 */
export function subscribeToFeed(feedUrl, intervalSeconds, callback) {
    let engine = activeEngines.get(feedUrl);
    if (!engine) {
        engine = new RssFeedEngine(feedUrl);
        activeEngines.set(feedUrl, engine);
    }

    const releaseSubscription = engine.subscribe(intervalSeconds, callback);
    return () => {
        releaseSubscription();
        const currentEngine = activeEngines.get(feedUrl);
        if (currentEngine && currentEngine.subscribers.size === 0) {
            activeEngines.delete(feedUrl);
        }
    };
}
