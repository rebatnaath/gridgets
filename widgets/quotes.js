import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveWidgetFontFamily,
} from '../utils/widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup } from '../utils/widgetUIUtils.js';
import { QUOTES } from './quotesData.js';

const QUOTE_ROTATE_INTERVAL_SEC = 30;

function getRandomQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

export function createQuotesNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveWidgetFontFamily(config);

    const scale = Math.max(0.35, Math.min(width / 300, height / 200));

    const outerBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.max(8, Math.round(14 * scale))}px;`,
    });
    container.add_child(outerBox);

    const quoteLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.max(10, Math.round(13 * scale))}px; font-style: italic; padding: 0 4px;`,
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.max(9, Math.round(11 * scale))}px; font-weight: 600; opacity: 0.7; padding-right: ${Math.max(2, Math.round(4 * scale))}px;`,
    });
    outerBox.add_child(authorLabel);

    function updateQuote() {
        const quote = getRandomQuote();
        quoteLabel.set_text(`"${quote.text}"`);
        authorLabel.set_text(`— ${quote.author}`);
    }

    updateQuote();

    const state = {
        timerId: GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_ROTATE_INTERVAL_SEC, () => {
            updateQuote();
            return GLib.SOURCE_CONTINUE;
        }),
    };

    connectTimerCleanup(container, state);

    return container;
}
