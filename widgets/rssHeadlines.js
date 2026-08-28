import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { SECONDARY_OPACITY, cssColorToRgba, resolveExplicitFontFamily, resolveWidgetBackgroundColor, resolveWidgetForegroundColor } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, connectTimerCleanup } from '../shell/widgetUIUtils.js';
import { subscribeToFeed } from '../utils/rssEngine.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 240;
const TITLEBAR_PADDING_V_PX = 10;
const TITLEBAR_PADDING_H_PX = 14;
const CONTENT_PADDING_PX = 14;
const FOOTER_PADDING_V_PX = 8;
const ARTICLE_TITLE_MAX_CHARS = 110;
const SNIPPET_MAX_CHARS = 160;
const SOURCE_NAME_MAX_CHARS = 22;
const BORDER_ALPHA = 0.14;

const SOURCE_FONT_SIZE_PX = 11;
const TITLE_FONT_SIZE_PX = 12;
const SNIPPET_FONT_SIZE_PX = 10;
const FOOTER_FONT_SIZE_PX = 9;

const ROTATE_INTERVAL_SECONDS = 5;
const FADE_DURATION_MS = 150;
const MAX_VISIBLE_DOTS = 5;
const MIN_REFRESH_MINUTES = 5;
const DEFAULT_REFRESH_MINUTES = 15;

function clampText(text, maxChars) {
    if (!text) return '';
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function sourceNameFromUrl(feedUrl) {
    try {
        const host = new URL(feedUrl).hostname.replace(/^www\./, '');
        return clampText(host, SOURCE_NAME_MAX_CHARS);
    } catch (_urlErr) {
        return 'Feed';
    }
}

function relativeTimeFromIso(dateIso) {
    const publishedMs = dateIso ? Date.parse(dateIso) : NaN;
    if (isNaN(publishedMs)) return '';
    const deltaMinutes = Math.max(0, Math.floor((Date.now() - publishedMs) / 60000));
    if (deltaMinutes < 1) return 'Just now';
    if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
    const hours = Math.floor(deltaMinutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function createRssHeadlinesNode(config, width, height, xPosition, yPosition) {
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 0;
    const accentHex = config.globalAccentColor || '#3584e4';
    const accentRgba = (alpha) => cssColorToRgba(accentHex, alpha);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const hasFeed = typeof config.feedUrl === 'string' && config.feedUrl.startsWith('http');
    const refreshIntervalSeconds = Math.max(MIN_REFRESH_MINUTES, config.refreshMinutes || DEFAULT_REFRESH_MINUTES) * 60;

    const state = { timerId: null, releaseFeed: null };
    let articles = [];
    let currentIndex = 0;
    let dotWidgets = [];
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

    const footerBar = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    const timeLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
    const dotsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        style: 'spacing: 4px;',
    });
    footerBar.add_child(timeLabel);
    footerBar.add_child(dotsRow);
    mainBox.add_child(footerBar);

    function renderDots() {
        dotsRow.destroy_all_children();
        dotWidgets = [];
        const visibleCount = Math.min(articles.length, MAX_VISIBLE_DOTS);
        for (let index = 0; index < visibleCount; index++) {
            const dot = new St.Widget({
                y_align: Clutter.ActorAlign.CENTER,
            });
            dotsRow.add_child(dot);
            dotWidgets.push(dot);
        }
        updateActiveDot();
    }

    // Restyles the existing dots for the current position.
    function updateActiveDot() {
        if (!dotWidgets.length) return;
        const activeIndex = currentIndex % MAX_VISIBLE_DOTS;
        dotWidgets.forEach((dot, index) => {
            if (isActorDestroyed(container)) return;
            const isActive = index === activeIndex;
            dot.style = `width: ${isActive ? Math.round(10 * scale) : Math.round(4 * scale)}px;`
                + `height: ${Math.round(4 * scale)}px; border-radius: ${Math.round(scale)}px;`
                + `background-color: ${textColor};`
                + `opacity: ${isActive ? 1 : 0.27};`;
        });
    }

    function applyArticle() {
        if (!hasFeed) {
            sourceLabel.text = 'RSS Headlines';
            articleTitle.text = 'No feed configured';
            articleSnippet.text = 'Add a feed URL through the widget settings.';
            timeLabel.text = '';
            renderDots();
            return;
        }
        if (articles.length === 0) {
            articleTitle.text = 'Waiting for updates…';
            articleSnippet.text = '';
            timeLabel.text = '';
            renderDots();
            return;
        }
        const article = articles[currentIndex % articles.length];
        articleTitle.text = clampText(article.title, ARTICLE_TITLE_MAX_CHARS);
        articleSnippet.text = clampText(article.summary, SNIPPET_MAX_CHARS);
        timeLabel.text = relativeTimeFromIso(article.dateIso);
        const visibleCount = Math.min(articles.length, MAX_VISIBLE_DOTS);
        if (visibleCount !== dotWidgets.length)
            renderDots();
        else
            updateActiveDot();
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
    container.connect('scroll-event', (_actor, event) => {
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
    registerWidgetCleanup(container, () => {
        if (state.releaseFeed)
            state.releaseFeed();
        state.releaseFeed = null;
    });

    if (hasFeed && !state.releaseFeed) {
        sourceLabel.text = sourceNameFromUrl(config.feedUrl);
        state.releaseFeed = subscribeToFeed(config.feedUrl, refreshIntervalSeconds, (items) => {
            if (isActorDestroyed(container)) return;
            articles = Array.isArray(items) ? items : [];
            currentIndex = 0;
            applyArticle();
        });
    }

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ROTATE_INTERVAL_SECONDS, () => {
        rotateArticle(1);
        return GLib.SOURCE_CONTINUE;
    });

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = (v) => Math.max(1, Math.round(v * scale));

        container.style = `${fontCss}background-color: ${bgColor}; border-radius: ${borderRadius}px;`
            + `border: 1px solid ${textRgba(BORDER_ALPHA)};`;

        titleBar.style = `padding: ${px(TITLEBAR_PADDING_V_PX)}px ${px(TITLEBAR_PADDING_H_PX)}px;`
            + `background-color: ${textRgba(0.04)};`
            + `border-bottom: 1px solid ${textRgba(0.1)};`;
        sourceLabel.style = `${fontCss}font-size: ${px(SOURCE_FONT_SIZE_PX)}px; color: ${textColor};`;
        sourceLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        contentArea.style = `padding: ${px(CONTENT_PADDING_PX)}px;`;
        articleTitle.style = `${fontCss}font-size: ${px(TITLE_FONT_SIZE_PX + 4)}px; font-weight: 700; color: ${textColor};`;
        articleSnippet.style = `${fontCss}font-size: ${px(SNIPPET_FONT_SIZE_PX + 2)}px;`
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        articleSnippet.clutter_text.line_wrap = true;
        articleSnippet.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        footerBar.style = `padding: ${px(FOOTER_PADDING_V_PX)}px ${px(TITLEBAR_PADDING_H_PX)}px;`
            + `border-top: 1px solid ${textRgba(0.1)};`;
        timeLabel.style = `${fontCss}font-size: ${px(FOOTER_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        dotsRow.style = `spacing: ${px(4)}px;`;

        applyArticle();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    return container;
}
