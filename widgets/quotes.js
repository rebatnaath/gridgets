import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import { SECONDARY_OPACITY, cssColorToRgba, resolveExplicitFontFamily, resolveWidgetForegroundColor } from '../utils/widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup, registerWidgetCleanup, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const QUOTE_ROTATE_INTERVAL_SEC = 30;
const BORDER_ALPHA = 0.14;
const QUOTES_URL = 'https://raw.githubusercontent.com/rebatnaath/gridgets/main/github/quotesData.json';

export function createQuotesNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const REF_WIDTH = 220;
    const REF_HEIGHT = 220;
    let scale = Math.min(width / REF_WIDTH, height / REF_HEIGHT);

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.max(1, Math.round(14 * scale))}px;`,
    });
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;
    container.add_child(outerBox);

    const quoteLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(17 * scale))}px; padding: 0 4px;`,
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
        style: `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(13 * scale))}px; `
            + `opacity: ${SECONDARY_OPACITY}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`,
    });
    outerBox.add_child(authorLabel);

    const session = new Soup.Session();
    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    let quotes = [];

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
                    console.error(`Quotes fetch returned status ${message.get_status()}`);
                    return;
                }
                const bytes = sourceObject.send_and_read_finish(result);
                if (!bytes || bytes.get_size() === 0) {
                    console.error('Quotes fetch returned empty response');
                    return;
                }
                const raw = new TextDecoder().decode(bytes.get_data());
                quotes = JSON.parse(raw);
                if (quotes.length > 0) {
                    const quote = quotes[Math.floor(Math.random() * quotes.length)];
                    showQuote(quote);
                }
            } catch (err) {
                console.error('Failed to fetch quotes:', err);
            }
        });
    }

    fetchQuotes();

    function applyScale(newScale) {
        scale = newScale;
        outerBox.style = `padding: ${Math.max(1, Math.round(14 * scale))}px;`;
        quoteLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(17 * scale))}px; padding: 0 4px;`;
        authorLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(13 * scale))}px; `
            + `opacity: ${SECONDARY_OPACITY}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`;
    }

    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.min(w / REF_WIDTH, h / REF_HEIGHT));
    });

    state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_ROTATE_INTERVAL_SEC, () => {
        fetchQuotes();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        if (state.refreshTimerId) {
            GLib.Source.remove(state.refreshTimerId);
            state.refreshTimerId = null;
        }
        if (state.cancellable) {
            state.cancellable.cancel();
        }
    });

    return container;
}