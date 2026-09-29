import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { cssColorToRgba, resolveExplicitFontFamily, resolveWidgetColors, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, GRAPHICS_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, connectTimerCleanup } from '../../shell/widgetUIUtils.js';
import { subscribeToFeed } from '../../utils/rssEngine.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { loadLastGoodCache, saveLastGoodCache } from '../../utils/lastGoodCache.js';
import { createOfflineNotice, noticeMessageForFetchFailure, OFFLINE_NOTICE_MESSAGES } from '../../components/offline/offlineNotice/offlineNotice.js';
import { clampText, hostLabelFromUrl, relativeTimeFromIso } from '../../utils/feedText.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 240;
const TITLEBAR_PADDING_V_PX = 10;
const TITLEBAR_PADDING_H_PX = 14;
const CONTENT_PADDING_PX = 14;
const FOOTER_PADDING_V_PX = 8;
const ARTICLE_TITLE_MAX_CHARS = 110;
const SNIPPET_MAX_CHARS = 160;
const SOURCE_NAME_MAX_CHARS = 22;

const SOURCE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const TITLE_DISPLAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const SNIPPET_DISPLAY_FONT_SIZE_PX = TYPOGRAPHY_SIZE.compact;
const FOOTER_FONT_SIZE_PX = TYPOGRAPHY_SIZE.metadata;

/** Bounds the stored feed so one chatty feed cannot grow the file without limit. */
const MAX_CACHED_ARTICLES = 60;
const ROTATE_INTERVAL_SECONDS = 5;
const FADE_DURATION_MS = 150;
const MIN_REFRESH_MINUTES = 5;
const DEFAULT_REFRESH_MINUTES = 15;

function sourceNameFromUrl(feedUrl) {
    return clampText(hostLabelFromUrl(feedUrl), SOURCE_NAME_MAX_CHARS) || 'Feed';
}

export function createRssHeadlinesNode(config, width, height, xPosition, yPosition) {
    const {
        subtleBackground,
        highlightBackground,
        contentColor: textColor,
    } = resolveWidgetColors(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = resolveWidgetCornerRadius(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const hasFeed = typeof config.feedUrl === 'string' && config.feedUrl.startsWith('http');
    const refreshIntervalSeconds = Math.max(MIN_REFRESH_MINUTES, config.refreshMinutes || DEFAULT_REFRESH_MINUTES) * 60;

    const state = { timerId: null, releaseFeed: null, releaseConnectivity: null };
    let articles = [];
    let currentIndex = 0;
    /** Non-empty while a fetch has failed, so the notice can say why the list may be old. */
    let fetchFailureMessage = '';
    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const titleBar = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    const sourceLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    titleBar.add_child(sourceLabel);
    mainBox.add_child(titleBar);

    const contentArea = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    const articleTitle = new St.Label({ text: '' });
    const articleSnippet = new St.Label({
        text: '',
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentArea.add_child(articleTitle);
    contentArea.add_child(articleSnippet);
    mainBox.add_child(contentArea);

    const emptyState = createOfflineNotice({ fontCss, textColor, scale });
    emptyState.actor.hide();
    mainBox.add_child(emptyState.actor);

    const footerBar = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    const timeLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    const articlePositionLabel = new St.Label({
        text: '',
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    footerBar.add_child(timeLabel);
    footerBar.add_child(articlePositionLabel);
    mainBox.add_child(footerBar);

    function updateArticlePosition() {
        if (articles.length === 0) {
            articlePositionLabel.text = '';
            return;
        }
        articlePositionLabel.text = `${currentIndex + 1} / ${articles.length}`;
    }

    function applyArticle() {
        if (!hasFeed) {
            emptyState.actor.hide();
            sourceLabel.text = 'RSS Headlines';
            articleTitle.text = 'No feed configured';
            articleTitle.visible = true;
            articleSnippet.text = 'Add a feed URL through the widget settings.';
            timeLabel.text = '';
            updateArticlePosition();
            return;
        }

        // Content on screen always wins over the notice, so a refresh that failed keeps
        // the headlines the user was already reading. With nothing cached and no fetch
        // finished yet the widget stays blank rather than claiming there is no content,
        // which is what the empty hand-off from the engine used to trigger.
        if (articles.length === 0) {
            articleTitle.text = '';
            articleTitle.visible = false;
            articleSnippet.text = '';
            timeLabel.text = '';
            updateArticlePosition();
            if (fetchFailureMessage) {
                emptyState.setMessage(fetchFailureMessage);
                emptyState.actor.show();
            } else {
                emptyState.actor.hide();
            }
            return;
        }

        if (fetchFailureMessage) {
            emptyState.setMessage(fetchFailureMessage);
            emptyState.actor.show();
        } else {
            emptyState.actor.hide();
        }

        const article = articles[currentIndex % articles.length];
        const articleTitleText = clampText(article.title, ARTICLE_TITLE_MAX_CHARS);
        articleTitle.text = articleTitleText;
        articleTitle.visible = articleTitleText.length > 0;
        articleSnippet.text = clampText(article.summary, SNIPPET_MAX_CHARS);
        timeLabel.text = relativeTimeFromIso(article.dateIso);
        updateArticlePosition();
    }

    function rotateArticle(step) {
        if (articles.length === 0 || isActorDestroyed(container)) return;
        currentIndex = ((currentIndex + step) % articles.length + articles.length) % articles.length;
        applyArticle();
        if (!contentArea.mapped) return;
        contentArea.opacity = 0;
        contentArea.ease({
            opacity: 255,
            duration: FADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    // One wheel notch can emit several events; collapse them into a single step.
    const SCROLL_STEP_COOLDOWN_MS = 250;
    let lastScrollAdvanceMs = 0;
    let smoothScrollAccumulator = 0;
    const scrollSignalId = container.connect('scroll-event', (_actor, event) => {
        if (articles.length === 0 || isActorDestroyed(container)) return Clutter.EVENT_PROPAGATE;
        const direction = event.get_scroll_direction();

        let step = 0;
        if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
            step = 1;
        } else if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
            step = -1;
        } else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, , deltaY] = event.get_scroll_delta();
            smoothScrollAccumulator += deltaY;
            if (Math.abs(smoothScrollAccumulator) >= 1) {
                step = smoothScrollAccumulator > 0 ? 1 : -1;
                smoothScrollAccumulator = 0;
            }
        }
        if (step === 0) return Clutter.EVENT_STOP;

        const nowMs = GLib.get_monotonic_time() / 1000;
        if (nowMs - lastScrollAdvanceMs < SCROLL_STEP_COOLDOWN_MS) return Clutter.EVENT_STOP;
        lastScrollAdvanceMs = nowMs;
        rotateArticle(step);
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);

    if (hasFeed) {
        sourceLabel.text = sourceNameFromUrl(config.feedUrl);
        state.releaseFeed = subscribeToFeed(config.feedUrl, refreshIntervalSeconds, (items, isFetchResult) => {
            if (isActorDestroyed(container)) return;
            // An empty list is what a failed fetch looks like from here, so it must not
            // clobber data restored from the last-good cache. It is also what the engine
            // hands over before its first fetch has finished, which is not a failure and
            // must not raise the notice.
            const incoming = Array.isArray(items) ? items : [];
            if (incoming.length > 0) {
                articles = incoming;
                currentIndex = 0;
                fetchFailureMessage = '';
                saveLastGoodCache('rss-headlines', config.id, articles.slice(0, MAX_CACHED_ARTICLES));
            } else if (isFetchResult) {
                fetchFailureMessage = noticeMessageForFetchFailure(articles.length > 0, isNetworkAvailable());
            }
            applyArticle();
        });

        // A widget added while offline should not wait out the poll interval. The engine
        // refetches on its own here; this just drops the notice so the list stops being
        // labelled stale while that request is in flight.
        state.releaseConnectivity = subscribeToSettledConnectivity(available => {
            if (!available || isActorDestroyed(container)) return;
            fetchFailureMessage = '';
            applyArticle();
        });

        loadLastGoodCache('rss-headlines', config.id, payload => {
            if (isActorDestroyed(container)) return;
            if (articles.length > 0 || !Array.isArray(payload) || payload.length === 0) return;
            articles = payload;
            // The read can land after a failed fetch, in which case the "nothing to show"
            // notice it raised is no longer true. A stale notice stays, because saved
            // articles really are what is on screen.
            if (fetchFailureMessage && fetchFailureMessage !== OFFLINE_NOTICE_MESSAGES.stale)
                fetchFailureMessage = '';
            applyArticle();
        });
    }

    registerWidgetCleanup(container, () => {
        container.disconnect(scrollSignalId);
        if (state.releaseFeed)
            state.releaseFeed();
        state.releaseFeed = null;
        if (state.releaseConnectivity)
            state.releaseConnectivity();
        state.releaseConnectivity = null;
    });

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ROTATE_INTERVAL_SECONDS, () => {
        rotateArticle(1);
        return GLib.SOURCE_CONTINUE;
    });

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = (v) => Math.max(1, Math.round(v * scale));

        titleBar.style = `padding: ${px(TITLEBAR_PADDING_V_PX)}px ${px(TITLEBAR_PADDING_H_PX)}px;`
            + `background-color: ${subtleBackground};`
            + `border-radius: ${borderRadius}px ${borderRadius}px 0 0;`
            + `border-bottom: 1px solid ${highlightBackground};`;
        sourceLabel.style = `${fontCss}font-size: ${scaleFontSize(SOURCE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor};`;
        sourceLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        contentArea.style = `padding: ${px(CONTENT_PADDING_PX)}px;`;
        emptyState.applyScale(scale);
        articleTitle.style = `${fontCss}font-size: ${scaleFontSize(TITLE_DISPLAY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; color: ${textColor};`;
        articleSnippet.style = `${fontCss}font-size: ${scaleFontSize(SNIPPET_DISPLAY_FONT_SIZE_PX, scale, MIN_FONT_SIZE.label)}px;`
            + `color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;
        articleSnippet.clutter_text.line_wrap = true;
        articleSnippet.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        footerBar.style = `padding: ${px(FOOTER_PADDING_V_PX)}px ${px(TITLEBAR_PADDING_H_PX)}px;`
            + `border-top: 1px solid ${cssColorToRgba(textColor, GRAPHICS_OPACITY.divider)};`;
        timeLabel.style = `${fontCss}font-size: ${scaleFontSize(FOOTER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px; color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`;
        articlePositionLabel.style = `${fontCss}font-size: ${scaleFontSize(FOOTER_FONT_SIZE_PX, scale, MIN_FONT_SIZE.metadata)}px; color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`;

        applyArticle();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    return container;
}
