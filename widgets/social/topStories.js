import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { cssColorToRgba, getTopStoryFeeds, getTopStoryGenreLabel, resolveAccentColor, resolveExplicitFontFamily, resolveWidgetColors } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { subscribeToFeed } from '../../utils/rssEngine.js';
import { resolveArticleImageUrl, fetchImageBytes } from '../../utils/articleImage.js';
import { connectShortClick, openExternalUri } from '../../utils/widgetInteractions.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { createOfflineNotice, noticeMessageForFetchFailure } from '../../components/offline/offlineNotice/offlineNotice.js';
import { clampText, hostLabelFromUrl, relativeTimeFromIso } from '../../utils/feedText.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';
import {
    loadLastGoodCache,
    saveLastGoodCache,
    readCachedImageBytes,
    writeCachedImageBytes,
    cachedImageUri,
    pruneCachedImages,
} from '../../utils/lastGoodCache.js';

const REF_WIDTH_PX = 369;
const REF_HEIGHT_PX = 305;

const HEADER_PADDING_V_PX = 9;
const LIST_PADDING_PX = 8;
// Split from the vertical padding so the gap between stories can tighten on its own.
const CARD_PADDING_X_PX = 9;
const CARD_PADDING_Y_PX = 5;
const CARD_SPACING_PX = 4;
const CARD_RADIUS_PX = 10;
// Shared by the header and the stories so their text cannot drift out of alignment.
const CONTENT_INSET_PX = LIST_PADDING_PX + CARD_PADDING_X_PX;
const THUMBNAIL_SIZE_PX = 46;
const THUMBNAIL_RADIUS_PX = 7;

const CARD_TITLE_MAX_LINES = 2;
const META_SPACING_PX = 4;
const TITLE_COLUMN_SPACING_PX = 2;
/** Same measurement the calendar day column uses: 13px of text occupies 18px. */
const TITLE_LINE_HEIGHT_RATIO = 1.43;
const CARD_TEXT_SPACING_PX = 8;
const MAX_CARDS = 14;
/** Bounds each stored feed so eight of them cannot grow the file without limit. */
const MAX_CACHED_ITEMS_PER_FEED = 20;
const SOURCE_NAME_MAX_CHARS = 26;
const CLUTTER_OPACITY_OPAQUE = 255;

const HEADER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const HEADER_ICON_SIZE_PX = TYPOGRAPHY_SIZE.iconMd;
const SOURCE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;
const TITLE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.label;
const MONOGRAM_SIZE_RATIO = 0.44;

const HEADER_ICON_NAME = 'application-rss+xml-symbolic';

const REFRESH_MINUTES = 20;
const MIN_REFRESH_MINUTES = 5;

function monogramFor(source) {
    const trimmed = (source || '').trim();
    return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function createTopStoriesNode(config, width, height, xPosition, yPosition) {
    const { highlightBackground, contentColor: textColor } = resolveWidgetColors(config);
    const accentColor = resolveAccentColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const customFeed = typeof config.feedUrl === 'string' && config.feedUrl.startsWith('http')
        ? [{ url: config.feedUrl, name: '' }]
        : getTopStoryFeeds(config.genre);
    const refreshSeconds = Math.max(MIN_REFRESH_MINUTES, config.refreshMinutes || REFRESH_MINUTES) * 60;

    const state = {
        releaseFeeds: [],
        releaseConnectivity: null,
        itemsByFeed: new Map(),
        imageCancellable: new Gio.Cancellable(),
        cards: [],
        articles: [],
        lookedUpUrls: new Set(),
        imageBytesCache: new Map(),
        /** Image URL per article link, keyed so the pruner keeps the files actually in use. */
        entryImageUrls: new Map(),
        prunedImageSignature: null,
        /** Non-empty only when there is nothing to read and a fetch has failed. */
        fetchFailureMessage: '',
    };
    let scale = 1;

    const rootBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(rootBox);

    const headerLabel = new St.Label({
        text: getTopStoryGenreLabel(config.genre),
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerIcon = new St.Icon({
        icon_name: HEADER_ICON_NAME,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    headerBox.add_child(headerLabel);
    headerBox.add_child(headerIcon);
    rootBox.add_child(headerBox);

    const cardList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    scrollView.set_child(cardList);

    const emptyState = createOfflineNotice({ fontCss, textColor, scale });
    emptyState.actor.hide();
    const scrollArea = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    scrollArea.add_child(scrollView);
    scrollArea.add_child(emptyState.actor);
    rootBox.add_child(scrollArea);

    function acquireCard(index) {
        while (state.cards.length <= index) {
            const sourceLabel = new St.Label({ text: '', x_align: Clutter.ActorAlign.START });
            sourceLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const timeLabel = new St.Label({ text: '', x_align: Clutter.ActorAlign.START });
            timeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const metaBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
            });
            metaBox.add_child(sourceLabel);
            metaBox.add_child(timeLabel);

            const titleLabel = new St.Label({
                text: '',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.START,
            });
            titleLabel.clutter_text.line_wrap = true;
            titleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            // Labels inherit END ellipsize from the shell theme, and END pins the text
            // to one line, so without this the wrap and line_max below do nothing.
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            // BinLayout so each child fills the tile and its centre alignment applies;
            // without a layout manager a child sits at 0,0 however it is aligned.
            const thumbnailBox = new St.Widget({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                layout_manager: new Clutter.BinLayout(),
            });
            const thumbnailImage = new St.Widget({
                visible: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const monogramLabel = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            thumbnailBox.add_child(thumbnailImage);
            thumbnailBox.add_child(monogramLabel);

            const textColumn = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            textColumn.add_child(metaBox);
            textColumn.add_child(titleLabel);

            // Reactive so the press is picked here rather than falling through to the
            // widget container, which only knows how to start a drag.
            const card = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                reactive: true,
            });
            card.add_child(textColumn);
            card.add_child(thumbnailBox);
            cardList.add_child(card);

            const entry = {
                card, textColumn, titleLabel, metaBox, sourceLabel, timeLabel,
                thumbnailBox, thumbnailImage, monogramLabel, articleLink: '', decodedSize: 0,
                imageUri: '',
                hovered: false,
            };
            card.connect('enter-event', () => {
                entry.hovered = true;
                styleCard(entry);
                return Clutter.EVENT_PROPAGATE;
            });
            card.connect('leave-event', () => {
                entry.hovered = false;
                styleCard(entry);
                return Clutter.EVENT_PROPAGATE;
            });
            connectShortClick(card, () => {
                if (entry.articleLink)
                    openExternalUri(entry.articleLink);
            });
            state.cards.push(entry);
            styleCard(entry);
        }
        return state.cards[index];
    }

    /**
     * Applies everything scale-dependent. Also called when a card is born, not just from
     * applyLayout: the first layout pass runs before any feed answers, so cards made later
     * would sit unstyled until the next resize.
     */
    function styleCard(entry) {
        const px = value => Math.max(1, Math.round(value * scale));
        const thumbnailPx = px(THUMBNAIL_SIZE_PX);
        const metaStyle = `${fontCss}font-size: ${scaleFontSize(SOURCE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px;`
            + `color: ${textColor};`;

        const highlightTint = cssColorToRgba(highlightBackground, GRAPHICS_OPACITY.gridLine);
        const hoverTint = entry.hovered
            ? ` background-color: ${highlightTint};`
            : '';
        entry.card.style = `padding: ${px(CARD_PADDING_Y_PX)}px ${px(CARD_PADDING_X_PX)}px;`
            + ` spacing: ${px(CARD_TEXT_SPACING_PX)}px;`
            + ` border-radius: ${px(CARD_RADIUS_PX)}px;${hoverTint}`;
        entry.textColumn.style = `spacing: ${px(TITLE_COLUMN_SPACING_PX)}px;`;
        const titleFontPx = scaleFontSize(TITLE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label);
        entry.titleLabel.style = `${fontCss}font-size: ${titleFontPx}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.medium}; color: ${textColor};`
            + ` min-height: ${Math.round(titleFontPx * TITLE_LINE_HEIGHT_RATIO * CARD_TITLE_MAX_LINES)}px;`;
        entry.titleLabel.clutter_text.line_max = CARD_TITLE_MAX_LINES;
        entry.sourceLabel.style = metaStyle;
        entry.timeLabel.style = metaStyle;
        // ClutterActor.opacity is a ubyte, not the 0-1 the stylesheet form takes, so the
        // token has to be converted or it truncates to 0 and the label disappears.
        const metaOpacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata);
        entry.sourceLabel.opacity = metaOpacity;
        entry.timeLabel.opacity = metaOpacity;
        entry.metaBox.style = `spacing: ${px(META_SPACING_PX)}px;`;
        styleThumbnailBox(entry, thumbnailPx, entry.thumbnailImage.visible);
        // The style is rebuilt wholesale, so the current picture is put back into it;
        // otherwise a resize would blank every thumbnail that was already showing.
        if (entry.thumbnailImage.visible)
            entry.thumbnailImage.style = thumbnailStyle(entry.imageUri, thumbnailPx);
        entry.monogramLabel.style = `${fontCss}font-size: ${Math.max(1, Math.round(thumbnailPx * MONOGRAM_SIZE_RATIO))}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor}; opacity: ${TEXT_OPACITY.disabled};`;
    }

    function clearThumbnail(entry, thumbnailPx) {
        // Rebuilt without the background-image, so the old picture is dropped rather than
        // left showing under the letter.
        entry.imageUri = '';
        entry.thumbnailImage.style = thumbnailStyle('', thumbnailPx);
        entry.thumbnailImage.hide();
        entry.monogramLabel.show();
        styleThumbnailBox(entry, thumbnailPx, false);
    }

    /** The placeholder reuses the card's hover tint, so a storyless tile reads as deliberate. */
    function styleThumbnailBox(entry, thumbnailPx, hasImage) {
        entry.thumbnailBox.style = `width: ${thumbnailPx}px; height: ${thumbnailPx}px;`
            + `border-radius: ${Math.max(1, Math.round(THUMBNAIL_RADIUS_PX * scale))}px;`
            + (hasImage ? '' : ` background-color: ${cssColorToRgba(highlightBackground, GRAPHICS_OPACITY.gridLine)};`);
    }

    function showImage(entry, articleLink, imageUrl, thumbnailPx) {
        // Recorded before any await, and from the resolved URL rather than article.image:
        // most stories have no image of their own, so that field would name nothing the
        // pruner could match against a file on disk.
        state.entryImageUrls.set(articleLink, imageUrl);
        const paint = () => {
            if (isActorDestroyed(container) || entry.articleLink !== articleLink) return;
            const uri = cachedImageUri('top-stories', config.id, imageUrl);
            if (!uri) return;
            styleThumbnail(entry, uri, thumbnailPx);
        };

        readCachedImageBytes('top-stories', config.id, imageUrl, diskBytes => {
            if (isActorDestroyed(container) || entry.articleLink !== articleLink) return;
            if (diskBytes) {
                state.imageBytesCache.set(articleLink, diskBytes);
                paint();
                return;
            }
            fetchImageBytes(imageUrl, state.imageCancellable, bytes => {
                if (!bytes || isActorDestroyed(container) || entry.articleLink !== articleLink) return;
                state.imageBytesCache.set(articleLink, bytes);
                // Painted from the callback: a stylesheet pointing at the file before the
                // write lands shows nothing, and says nothing about why.
                writeCachedImageBytes('top-stories', config.id, imageUrl, bytes, paint);
            });
        });
    }

    function thumbnailStyle(uri, sizePx) {
        const radiusPx = Math.max(1, Math.round(THUMBNAIL_RADIUS_PX * scale));
        return `width: ${sizePx}px; height: ${sizePx}px; border-radius: ${radiusPx}px;`
            + (uri
                ? ` background-image: url("${uri}");`
                    + ' background-size: cover; background-position: center;'
                : '');
    }

    function styleThumbnail(entry, uri, thumbnailPx) {
        entry.imageUri = uri;
        entry.decodedSize = thumbnailPx;
        entry.thumbnailImage.style = thumbnailStyle(uri, thumbnailPx);
        entry.thumbnailImage.show();
        entry.monogramLabel.hide();
        styleThumbnailBox(entry, thumbnailPx, true);
    }

    function loadThumbnail(entry, article, thumbnailPx) {
        clearThumbnail(entry, thumbnailPx);

        const applyResolved = imageUrl => {
            if (isActorDestroyed(container) || entry.articleLink !== article.link) {
                return;
            }
            if (imageUrl)
                showImage(entry, article.link, imageUrl, thumbnailPx);
        };

        if (article.image) {
            applyResolved(article.image);
            return;
        }
        if (state.lookedUpUrls.has(article.link))
            return;
        state.lookedUpUrls.add(article.link);
        resolveArticleImageUrl(article.link, state.imageCancellable, applyResolved);
    }

    function renderCards() {
        const shown = Math.min(MAX_CARDS, state.articles.length);
        const thumbnailPx = Math.max(1, Math.round(THUMBNAIL_SIZE_PX * scale));
        for (let i = 0; i < shown; i++) {
            const article = state.articles[i];
            const entry = acquireCard(i);
            // A card hidden by an earlier, shorter list has to be shown again here, or it
            // stays invisible for the rest of the widget's life.
            entry.card.visible = true;
            const isNewArticle = entry.articleLink !== article.link;
            if (isNewArticle) {
                entry.articleLink = article.link;
                entry.decodedSize = 0;
                entry.imageUri = '';
                state.entryImageUrls.delete(article.link);
                entry.monogramLabel.text = monogramFor(article.source);
                loadThumbnail(entry, article, thumbnailPx);
            } else if (entry.decodedSize !== thumbnailPx && entry.imageUri) {
                // Only the box changed size, so the file already on disk is repainted
                // rather than refetched.
                styleThumbnail(entry, entry.imageUri, thumbnailPx);
            }
            entry.titleLabel.text = article.title;
            entry.sourceLabel.text = clampText(article.source, SOURCE_NAME_MAX_CHARS);
            entry.timeLabel.text = relativeTimeFromIso(article.dateIso, { compact: true });
        }
        for (let i = shown; i < state.cards.length; i++)
            state.cards[i].card.visible = false;

        forgetArticlesOffScreen(shown);
        pruneVisibleThumbnails(shown);

        if (state.articles.length > 0) {
            if (state.fetchFailureMessage) {
                emptyState.setMessage(state.fetchFailureMessage);
                emptyState.actor.show();
            } else {
                emptyState.actor.hide();
            }
        } else if (state.fetchFailureMessage) {
            emptyState.setMessage(state.fetchFailureMessage);
            emptyState.actor.show();
        } else {
            emptyState.actor.hide();
        }
    }

    /**
     * Drops per-article state for anything not on a card. The image cache holds raw CDN
     * bytes, so keeping every story the feeds ever produced would cost tens of megabytes
     * over a long session. Anything still in flight re-adds itself and is collected on the
     * next pass.
     */
    function forgetArticlesOffScreen(shown) {
        const shownLinks = new Set();
        for (let i = 0; i < shown; i++)
            shownLinks.add(state.articles[i].link);
        for (const collection of [state.imageBytesCache, state.entryImageUrls, state.lookedUpUrls]) {
            for (const link of [...collection.keys()]) {
                if (!shownLinks.has(link))
                    collection.delete(link);
            }
        }
    }

    /**
     * Keeps only the thumbnails on screen. The pruner walks a folder on disk, too costly
     * to repeat per resize, so it runs only when the set of URLs has changed.
     */
    function pruneVisibleThumbnails(shown) {
        const keepImageUrls = [];
        for (let i = 0; i < shown; i++) {
            const imageUrl = state.entryImageUrls.get(state.articles[i].link);
            if (imageUrl)
                keepImageUrls.push(imageUrl);
        }
        const signature = keepImageUrls.join('\n');
        if (signature === state.prunedImageSignature)
            return;
        state.prunedImageSignature = signature;
        pruneCachedImages('top-stories', config.id, keepImageUrls);
    }

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) {
            return;
        }
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = value => Math.max(1, Math.round(value * scale));
        const headerIconPx = px(HEADER_ICON_SIZE_PX);
        headerBox.style = `padding: ${px(HEADER_PADDING_V_PX)}px ${px(CONTENT_INSET_PX)}px;`;
        headerLabel.style = `${fontCss}font-size: ${scaleFontSize(HEADER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${accentColor};`;
        headerIcon.style = `color: ${accentColor}; width: ${headerIconPx}px; height: ${headerIconPx}px;`;
        cardList.style = `padding: ${px(LIST_PADDING_PX)}px; spacing: ${px(CARD_SPACING_PX)}px;`;

        emptyState.applyScale(scale);

        for (const entry of state.cards)
            styleCard(entry);

        renderCards();
    }

    /**
     * Deals the list out one publisher at a time. On date alone the largest feed takes
     * the whole visible area - BBC Sport publishes far more than the others, so the top
     * of the list was four of the same source. Round-robin over per-publisher queues
     * keeps each one's own newest-first order while the first stories come from
     * different outlets.
     */
    function interleaveBySource(articles) {
        const queues = new Map();
        for (const article of articles) {
            const key = article.source || '';
            if (!queues.has(key))
                queues.set(key, []);
            queues.get(key).push(article);
        }

        const lists = [...queues.values()];
        const interleaved = [];
        for (let round = 0; interleaved.length < articles.length; round++) {
            for (const list of lists) {
                if (round < list.length)
                    interleaved.push(list[round]);
            }
        }
        return interleaved;
    }

    /** One feed per URL for the last-good cache, trimmed to the entries it stores. */
    function snapshotFeeds() {
        const snapshot = {};
        for (const source of customFeed) {
            const items = state.itemsByFeed.get(source.url);
            if (items && items.length > 0)
                snapshot[source.url] = items.slice(0, MAX_CACHED_ITEMS_PER_FEED);
        }
        return snapshot;
    }

    /** Undated entries sort last rather than poisoning the comparator with NaN. */
    function publishedAtMs(article) {
        const parsed = article.dateIso ? Date.parse(article.dateIso) : NaN;
        return isNaN(parsed) ? 0 : parsed;
    }

    /** Newest first across every feed, each item carrying the publisher it came from. */
    function mergeFeeds() {
        const merged = [];
        const seen = new Set();
        for (const source of customFeed) {
            for (const item of state.itemsByFeed.get(source.url) || []) {
                if (!item.link || seen.has(item.link))
                    continue;
                seen.add(item.link);
                merged.push({ ...item, source: item.source || source.name || hostLabelFromUrl(source.url) });
            }
        }
        merged.sort((a, b) => publishedAtMs(b) - publishedAtMs(a));
        return interleaveBySource(merged);
    }

    registerWidgetCleanup(container, () => {
        for (const release of state.releaseFeeds)
            release();
        state.releaseFeeds = [];
        if (state.releaseConnectivity)
            state.releaseConnectivity();
        state.releaseConnectivity = null;
        state.imageCancellable.cancel();
        state.imageBytesCache.clear();
        state.entryImageUrls.clear();
    });

    state.releaseFeeds = customFeed.map(source => subscribeToFeed(source.url, refreshSeconds, (items, isFetchResult) => {
        if (isActorDestroyed(container)) return;
        const incoming = Array.isArray(items) ? items : [];
        // An empty list never overwrites what is already held, so a failure cannot wipe
        // data restored from the cache - and the engine's empty hand-off before the first
        // fetch completes is not a failure, so it stays silent. A failure is only worth
        // reporting when there is nothing on screen to read instead.
        if (incoming.length > 0) {
            state.itemsByFeed.set(source.url, incoming);
            state.fetchFailureMessage = '';
        } else if (isFetchResult && state.articles.length === 0) {
            state.fetchFailureMessage = noticeMessageForFetchFailure(false, isNetworkAvailable());
        }
        state.articles = mergeFeeds();
        if (state.articles.length > 0)
            saveLastGoodCache('top-stories', config.id, snapshotFeeds());
        renderCards();
    }));

    // The engine refetches on reconnect by itself; this only drops the notice early.
    state.releaseConnectivity = subscribeToSettledConnectivity(() => {
        if (isActorDestroyed(container)) return;
        state.fetchFailureMessage = '';
        renderCards();
    });

    loadLastGoodCache('top-stories', config.id, payload => {
        if (isActorDestroyed(container)) return;
        if (state.articles.length > 0 || !payload || typeof payload !== 'object') return;
        for (const [url, items] of Object.entries(payload)) {
            if (Array.isArray(items) && items.length > 0)
                state.itemsByFeed.set(url, items);
        }
        if (state.itemsByFeed.size === 0) return;
        state.articles = mergeFeeds();
        state.fetchFailureMessage = '';
        renderCards();
    });

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, currentWidth, currentHeight) => {
        if (isActorDestroyed(container)) return;
        applyLayout(currentWidth, currentHeight);
    });

    return container;
}
