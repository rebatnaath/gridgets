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

const QUOTE_ROTATE_INTERVAL_SEC = 30;
const QUOTES_URL = 'https://raw.githubusercontent.com/rebatnaath/gridgets/main/github/quotesData.json';

export function createQuotesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const REF_WIDTH = 220;
    const REF_HEIGHT = 220;
    let scale = Math.min(width / REF_WIDTH, height / REF_HEIGHT);

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.max(1, Math.round(14 * scale))}px;`,
    });
    container.add_child(outerBox);

    const quoteLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.subtitle, scale, MIN_FONT_SIZE.subtitle)}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; padding: 0 4px;`,
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
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.label, scale, MIN_FONT_SIZE.label)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; opacity: ${TEXT_OPACITY.secondary}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`,
    });
    outerBox.add_child(authorLabel);

    const session = new Soup.Session();
    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    let quotes = [];
    let lastErrorMessage = '';

    function reportFetchError(message) {
        if (message === lastErrorMessage) return;
        lastErrorMessage = message;
        console.error(message);
    }

    function showQuote(quote) {
        quoteLabel.set_text(quote.text);
        authorLabel.set_text(`— ${quote.author}`);
    }

    function fetchQuotes() {
        const message = Soup.Message.new('GET', QUOTES_URL);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, state.cancellable, (sourceObject, result) => {
            if (isActorDestroyed(container)) return;
            try {
                if (message.get_status() !== 200) {
                    reportFetchError(`Quotes fetch returned status ${message.get_status()}`);
                    return;
                }
                const bytes = sourceObject.send_and_read_finish(result);
                if (!bytes || bytes.get_size() === 0) {
                    reportFetchError('Quotes fetch returned empty response');
                    return;
                }
                const raw = new TextDecoder().decode(bytes.get_data());
                quotes = JSON.parse(raw);
                lastErrorMessage = '';
                if (quotes.length > 0) {
                    const quote = quotes[Math.floor(Math.random() * quotes.length)];
                    showQuote(quote);
                }
            } catch (err) {
                reportFetchError(`Failed to fetch quotes: ${err.message}`);
            }
        });
    }

    fetchQuotes();

    function applyScale(newScale) {
        scale = newScale;
        outerBox.style = `padding: ${Math.max(1, Math.round(14 * scale))}px;`;
        quoteLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.subtitle, scale, MIN_FONT_SIZE.subtitle)}px; font-weight: ${TYPOGRAPHY_WEIGHT.regular}; padding: 0 4px;`;
        authorLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(TYPOGRAPHY_SIZE.label, scale, MIN_FONT_SIZE.label)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.regular}; opacity: ${TEXT_OPACITY.secondary}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`;
    }

    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (scale) => {
        applyScale(scale);
    });

    state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_ROTATE_INTERVAL_SEC, () => {
        fetchQuotes();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        if (state.refreshTimerId) {
            GLib.Source.remove(state.refreshTimerId);
            state.refreshTimerId = null;
        }
        if (state.cancellable) {
            state.cancellable.cancel();
        }
        session.abort();
    });

    return container;
}