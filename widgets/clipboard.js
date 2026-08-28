import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile } from '../utils/widgetUtils.js';
import {
    createWidgetContainer,
    connectTimerCleanup,
    startPollingTimer
} from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const TICK_INTERVAL_MS = 1000;
const MAX_HISTORY_LENGTH = 25;
const PREVIEW_TEXT_MAX_LENGTH = 40;
const PREVIEW_TEXT_MIN_LENGTH = 20;
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 160;
const BASE_TITLE_FONT_SIZE = 14;
const BASE_ITEM_FONT_SIZE = 12;
const BORDER_ALPHA = 0.14;
const ITEM_IDLE_ALPHA = 0.06;
const ITEM_HOVER_ALPHA = 0.11;
const ITEM_RADIUS_PX = 9;
const ITEM_PADDING_V_PX = 9;
const ITEM_PADDING_H_PX = 11;
const LIST_SPACING_PX = 6;

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    container.style += ` border: 1px solid ${textRgba(BORDER_ALPHA)};`;

    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);
    const titleFontSize = Math.round(BASE_TITLE_FONT_SIZE * scale);
    const itemFontSize = Math.round(BASE_ITEM_FONT_SIZE * scale);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
    });

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: `margin-bottom: 8px; border-bottom: 1px solid ${textRgba(0.12)}; padding-bottom: 4px;`,
    });

    const headerLabel = new St.Label({
        text: 'Clipboard History',
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: ${SECONDARY_OPACITY};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    const itemContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${Math.max(1, Math.round(LIST_SPACING_PX * scale))}px;`,
    });

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
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

    loadJsonFromFileAsync(clipboardFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && Array.isArray(savedData.history)) {
            state.clipboardHistory = savedData.history;
            renderClipboardItems();
        } else if (!loadError) {
            saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        }
    });

    const systemClipboard = St.Clipboard.get_default();

    const renderClipboardItems = () => {
        if (isActorDestroyed(container)) return;
        itemContainer.destroy_all_children();

        if (state.clipboardHistory.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No history yet.',
                style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-size: ${itemFontSize}px;`,
            });
            itemContainer.add_child(emptyLabel);
            return;
        }

        const maxLen = Math.max(PREVIEW_TEXT_MIN_LENGTH, Math.round(PREVIEW_TEXT_MAX_LENGTH * scale));
        const itemRadius = Math.max(1, Math.round(ITEM_RADIUS_PX * scale));
        const itemPadding = `${Math.max(1, Math.round(ITEM_PADDING_V_PX * scale))}px ${Math.max(1, Math.round(ITEM_PADDING_H_PX * scale))}px`;
        const itemNormalStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${textRgba(ITEM_IDLE_ALPHA)};`;
        const itemHoverStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${textRgba(ITEM_HOVER_ALPHA)};`;

        state.clipboardHistory.forEach((clipboardText) => {
            const itemBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                reactive: true,
                style: itemNormalStyle,
            });

            itemBox.connect('enter-event', () => {
                itemBox.style = itemHoverStyle;
                return Clutter.EVENT_PROPAGATE;
            });
            itemBox.connect('leave-event', () => {
                itemBox.style = itemNormalStyle;
                return Clutter.EVENT_PROPAGATE;
            });

            const singleLinePreview = clipboardText.replace(/\n/g, ' ');
            const truncatedPreview = singleLinePreview.length > maxLen
                ? `${singleLinePreview.substring(0, maxLen)}...`
                : singleLinePreview;

            const textLabel = new St.Label({
                text: truncatedPreview,
                style: `${fontCss}color: ${textColor}; font-size: ${itemFontSize}px;`,
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
        if (isActorDestroyed(container)) return;
        systemClipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, newClipboardText) => {
            if (isActorDestroyed(container) || !newClipboardText || newClipboardText.trim() === '') return;

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

    return container;
}
