import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    loadJsonFromFileAsync,
    saveJsonToFile,
    getGridgetsDataDir,
    resolveWidgetForegroundColor,
    resolveWidgetFontFamily
} from '../utils/widgetUtils.js';
import {
    createWidgetContainer,
    connectTimerCleanup,
    startPollingTimer
} from '../utils/widgetUIUtils.js';

const TICK_INTERVAL_MS = 1000;
const MAX_HISTORY_LENGTH = 10;
const PREVIEW_TEXT_MAX_LENGTH = 40;
const PREVIEW_TEXT_MIN_LENGTH = 20;
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 160;
const BASE_TITLE_FONT_SIZE = 14;
const MIN_TITLE_FONT_SIZE = 11;
const BASE_ITEM_FONT_SIZE = 12;
const MIN_ITEM_FONT_SIZE = 10;
const BASE_ICON_SIZE = 16;
const MIN_ICON_SIZE = 13;
const BUTTON_PRIMARY = 1;
const ITEM_STYLE_NORMAL = 'padding: 6px; border-radius: 4px; margin-bottom: 4px; background-color: transparent;';
const ITEM_STYLE_HOVER = 'padding: 6px; border-radius: 4px; margin-bottom: 4px; background-color: rgba(255,255,255,0.1);';

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const titleFontSize = Math.max(MIN_TITLE_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));
    const itemFontSize = Math.max(MIN_ITEM_FONT_SIZE, Math.round(BASE_ITEM_FONT_SIZE * scale));
    const iconSize = Math.max(MIN_ICON_SIZE, Math.round(BASE_ICON_SIZE * scale));

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
    });

    const headerBox = new St.BoxLayout({
        vertical: false,
        style: 'margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px;',
    });

    const headerIcon = new St.Icon({
        icon_name: 'edit-copy-symbolic',
        icon_size: iconSize,
        style: `color: ${textColor}; margin-right: 6px;`,
    });

    const headerLabel = new St.Label({
        text: 'Clipboard History',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${titleFontSize}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

    const itemContainer = new St.BoxLayout({
        vertical: true,
        x_expand: true,
    });
    scrollView.set_child(itemContainer);
    contentBox.add_child(scrollView);
    container.add_child(contentBox);

    const baseDir = getGridgetsDataDir('clipboard');
    const clipboardFilePath = GLib.build_filenamev([
        baseDir,
        `clipboard-${config.id}.json`
    ]);

    const state = {
        clipboardHistory: [],
        timerId: null,
    };

    loadJsonFromFileAsync(clipboardFilePath, (savedData) => {
        if (container.isDestroyed) return;
        if (savedData && Array.isArray(savedData.history)) {
            state.clipboardHistory = savedData.history;
            renderClipboardItems();
        } else {
            saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        }
    });

    const systemClipboard = St.Clipboard.get_default();

    const renderClipboardItems = () => {
        if (container.isDestroyed) return;
        itemContainer.destroy_all_children();

        if (state.clipboardHistory.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No history yet.',
                style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.5; font-size: ${itemFontSize}px;`,
            });
            itemContainer.add_child(emptyLabel);
            return;
        }

        const maxLen = Math.max(PREVIEW_TEXT_MIN_LENGTH, Math.round(PREVIEW_TEXT_MAX_LENGTH * scale));

        state.clipboardHistory.forEach((clipboardText) => {
            const itemBox = new St.BoxLayout({
                vertical: false,
                reactive: true,
                style: ITEM_STYLE_NORMAL,
            });

            itemBox.connect('enter-event', () => {
                itemBox.style = ITEM_STYLE_HOVER;
                return Clutter.EVENT_PROPAGATE;
            });
            itemBox.connect('leave-event', () => {
                itemBox.style = ITEM_STYLE_NORMAL;
                return Clutter.EVENT_PROPAGATE;
            });

            const singleLinePreview = clipboardText.replace(/\n/g, ' ');
            const truncatedPreview = singleLinePreview.length > maxLen
                ? `${singleLinePreview.substring(0, maxLen)}...`
                : singleLinePreview;

            const textLabel = new St.Label({
                text: truncatedPreview,
                style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${itemFontSize}px;`,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            itemBox.add_child(textLabel);

            itemBox.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === BUTTON_PRIMARY) {
                    systemClipboard.set_text(St.ClipboardType.CLIPBOARD, clipboardText);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            itemContainer.add_child(itemBox);
        });
    };

    const pollSystemClipboard = () => {
        if (container.isDestroyed) return;
        systemClipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, newClipboardText) => {
            if (container.isDestroyed || !newClipboardText || newClipboardText.trim() === '') return;

            const isAlreadyLatest = state.clipboardHistory.length > 0
                && state.clipboardHistory[0] === newClipboardText;

            if (!isAlreadyLatest) {
                const existingIndex = state.clipboardHistory.indexOf(newClipboardText);
                if (existingIndex > -1) {
                    state.clipboardHistory.splice(existingIndex, 1);
                }

                state.clipboardHistory.unshift(newClipboardText);
                if (state.clipboardHistory.length > MAX_HISTORY_LENGTH) {
                    state.clipboardHistory.pop();
                }

                saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
                renderClipboardItems();
            }
        });
    };

    renderClipboardItems();
    startPollingTimer(pollSystemClipboard, TICK_INTERVAL_MS, state);
    connectTimerCleanup(container, state);
    container.connect('destroy', () => {
        state.clipboardHistory = [];
    });

    return container;
}
