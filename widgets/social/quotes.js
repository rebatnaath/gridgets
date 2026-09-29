import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import { resolveExplicitFontFamily, resolveWidgetForegroundColor } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { loadLastGoodCache, saveLastGoodCache } from '../../utils/lastGoodCache.js';
import { createOfflineNotice, noticeMessageForFetchFailure, OFFLINE_NOTICE_MESSAGES } from '../../components/offline/offlineNotice/offlineNotice.js';
import { isNetworkAvailable, subscribeToSettledConnectivity } from '../../utils/connectivity.js';
import { createGetMessage } from '../../utils/httpClient.js';

const QUOTE_ROTATE_INTERVAL_SEC = 30;
const QUOTE_REFETCH_INTERVAL_SEC = 60 * 60;
const QUOTES_URL = 'https://raw.githubusercontent.com/rebatnaath/gridgets/main/github/quotesData.json';
const HTTP_STATUS_OK = 200;
const OUTER_PADDING_PX = 14;
const QUOTE_SIDE_PADDING_PX = 4;

export function createQuotesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const REF_WIDTH = 220;
    const REF_HEIGHT = 220;
    let scale = Math.min(width / REF_WIDTH, height / REF_HEIGHT);
    const px = value => scaleFontSize(value, scale);
    const authorStyle = () => `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.label, scale, MIN_FONT_SIZE.label)}px; `
        + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; opacity: ${TEXT_OPACITY.secondary}; padding-right: ${px(QUOTE_SIDE_PADDING_PX)}px;`;

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${px(OUTER_PADDING_PX)}px;`,
    });
    container.add_child(outerBox);

    const quoteLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.subtitle, scale, MIN_FONT_SIZE.subtitle)}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; padding: 0 ${QUOTE_SIDE_PADDING_PX}px;`,
    });
    quoteLabel.clutter_text.line_wrap = true;
    quoteLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    outerBox.add_child(quoteLabel);

    const authorLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
        x_expand: true,
        y_expand: true,
        style: authorStyle(),
    });
    outerBox.add_child(authorLabel);

    const offlineNotice = createOfflineNotice({ fontCss, textColor, scale });
    offlineNotice.actor.hide();
    outerBox.add_child(offlineNotice.actor);

    const session = new Soup.Session();
    const state = {
        rotateTimerId: null,
        refetchTimerId: null,
        fetchCancellable: new Gio.Cancellable(),
    };
    let quotes = [];
    let hasShownQuote = false;
    let lastErrorMessage = '';
    let noticeMessage = '';

    function reportFetchError(message) {
        if (message === lastErrorMessage) return;
        lastErrorMessage = message;
        console.error(message);
    }

    function showQuote(quote) {
        quoteLabel.set_text(quote.text);
        authorLabel.set_text(`— ${quote.author}`);
        hasShownQuote = true;
    }

    /**
     * Rotating deliberately leaves the notice alone: a widget that is showing saved
     * content stays labelled as such while it keeps cycling through it.
     */
    function showRandomQuote() {
        if (quotes.length === 0)
            return;
        showQuote(quotes[Math.floor(Math.random() * quotes.length)]);
    }

    function setNotice(message) {
        noticeMessage = message;
        offlineNotice.setMessage(message);
        offlineNotice.actor.show();
    }

    function clearNotice() {
        noticeMessage = '';
        offlineNotice.actor.hide();
    }

    /**
     * A failed refresh must not cost the user the quote already on screen, so this only
     * takes over when there is nothing to keep.
     */
    function showFetchProblem(networkUp) {
        if (!hasShownQuote) {
            quoteLabel.set_text('');
            authorLabel.set_text('');
        }
        setNotice(noticeMessageForFetchFailure(hasShownQuote, networkUp));
    }

    function fetchQuotes() {
        // Supersede any request still in flight so a slow earlier reply cannot
        // land after a newer one and leave the label showing older data.
        state.fetchCancellable.cancel();
        state.fetchCancellable = new Gio.Cancellable();
        const fetchCancellable = state.fetchCancellable;

        const message = createGetMessage(QUOTES_URL);
        if (!message) {
            reportFetchError('Quotes request could not be created');
            showFetchProblem(false);   // nothing was requested, so nothing is known of the network
            return;
        }

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, fetchCancellable, (sourceObject, result) => {
            if (fetchCancellable.is_cancelled()) return;
            if (isActorDestroyed(container)) return;
            try {
                if (message.get_status() !== HTTP_STATUS_OK) {
                    reportFetchError(`Quotes fetch returned status ${message.get_status()}`);
                    showFetchProblem(isNetworkAvailable());
                    return;
                }
                const bytes = sourceObject.send_and_read_finish(result);
                if (!bytes || bytes.get_size() === 0) {
                    reportFetchError('Quotes fetch returned empty response');
                    showFetchProblem(isNetworkAvailable());
                    return;
                }
                const payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (!Array.isArray(payload) || payload.length === 0) {
                    reportFetchError('Quotes feed held no usable entries');
                    showFetchProblem(isNetworkAvailable());
                    return;
                }
                quotes = payload;
                lastErrorMessage = '';
                saveLastGoodCache('quotes', config.id, quotes);
                showRandomQuote();
                clearNotice();
            } catch (err) {
                if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                reportFetchError(`Failed to fetch quotes: ${err.message}`);
                showFetchProblem(isNetworkAvailable());
            }
        });
    }

    loadLastGoodCache('quotes', config.id, payload => {
        if (isActorDestroyed(container)) return;
        if (hasShownQuote || !Array.isArray(payload) || payload.length === 0) return;
        quotes = payload;
        showRandomQuote();
        // The read can land after a failed fetch, in which case the "nothing to show"
        // notice it raised is no longer true. A stale notice is left alone, since saved
        // content really is what is on screen.
        if (noticeMessage && noticeMessage !== OFFLINE_NOTICE_MESSAGES.stale)
            clearNotice();
    });

    fetchQuotes();

    function applyScale(newScale) {
        scale = newScale;
        offlineNotice.applyScale(scale);
        outerBox.style = `padding: ${px(OUTER_PADDING_PX)}px;`;
        quoteLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.subtitle, scale, MIN_FONT_SIZE.subtitle)}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; padding: 0 ${QUOTE_SIDE_PADDING_PX}px;`;
        authorLabel.style = authorStyle();
    }

    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (scale) => {
        applyScale(scale);
    });

    // Quotes has no per-widget poll to ride on, so it watches connectivity directly:
    // without this a widget added while offline stays blank until the refetch timer.
    // The settled variant is used because the widget has already fetched once above.
    const releaseConnectivity = subscribeToSettledConnectivity(available => {
        if (available && !isActorDestroyed(container))
            fetchQuotes();
    });

    // Rotating reads from the copy already in memory; the network is only worth
    // touching hourly, since the feed is a static file on GitHub.
    state.rotateTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_ROTATE_INTERVAL_SEC, () => {
        if (!isActorDestroyed(container))
            showRandomQuote();
        return GLib.SOURCE_CONTINUE;
    });

    state.refetchTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_REFETCH_INTERVAL_SEC, () => {
        if (!isActorDestroyed(container))
            fetchQuotes();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        releaseConnectivity();
        if (state.rotateTimerId) {
            GLib.Source.remove(state.rotateTimerId);
            state.rotateTimerId = null;
        }
        if (state.refetchTimerId) {
            GLib.Source.remove(state.refetchTimerId);
            state.refetchTimerId = null;
        }
        state.fetchCancellable.cancel();
        session.abort();
    });

    return container;
}