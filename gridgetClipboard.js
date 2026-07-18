/**
 * ============================================================================
 * CLIPBOARD WIDGET 
 * 
 * This module provides a widget for viewing and managing clipboard history.
 * It periodically polls the system clipboard and displays recent entries,
 * allowing users to click and restore previous clipboard content.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    loadJsonFromFile, saveJsonToFile,
    resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    createWidgetContainer, connectTimerCleanup, startPollingTimer
} from './widgetUIUtils.js';

const TICK_INTERVAL_MS = 1000;
const MAX_HISTORY_LENGTH = 10;
const PREVIEW_TEXT_MAX_LENGTH = 40;

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

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
        icon_size: 16,
        style: `color: ${textColor}; margin-right: 6px;`,
    });
    const headerLabel = new St.Label({
        text: 'Clipboard History',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: 14px;`,
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

    const clipboardFilePath = `${config.extensionPath}/clipboard-${config.id}.json`;

    const savedData = loadJsonFromFile(clipboardFilePath);
    const state = {
        clipboardHistory: (savedData && Array.isArray(savedData.history)) ? savedData.history : [],
        timerId: null,
    };

    const systemClipboard = St.Clipboard.get_default();

    const renderClipboardItems = () => {
        itemContainer.destroy_all_children();

        if (state.clipboardHistory.length === 0) {
            const emptyStateLabel = new St.Label({
                text: 'No history yet.',
                style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.5; font-size: 12px;`,
            });
            itemContainer.add_child(emptyStateLabel);
            return;
        }

        state.clipboardHistory.forEach((clipboardText) => {
            const itemBox = new St.BoxLayout({
                vertical: false,
                reactive: true,
                style: 'padding: 6px; border-radius: 4px; margin-bottom: 4px;',
            });

            itemBox.connect('enter-event', () => {
                itemBox.style = 'padding: 6px; border-radius: 4px; margin-bottom: 4px; background-color: rgba(255,255,255,0.1);';
                return Clutter.EVENT_PROPAGATE;
            });
            itemBox.connect('leave-event', () => {
                itemBox.style = 'padding: 6px; border-radius: 4px; margin-bottom: 4px; background-color: transparent;';
                return Clutter.EVENT_PROPAGATE;
            });

            const singleLinePreview = clipboardText.replace(/\n/g, ' ');
            const truncatedPreview = singleLinePreview.length > PREVIEW_TEXT_MAX_LENGTH
                ? singleLinePreview.substring(0, PREVIEW_TEXT_MAX_LENGTH) + '...'
                : singleLinePreview;

            const textLabel = new St.Label({
                text: truncatedPreview,
                style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 12px;`,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            itemBox.add_child(textLabel);

            itemBox.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    systemClipboard.set_text(St.ClipboardType.CLIPBOARD, clipboardText);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            itemContainer.add_child(itemBox);
        });
    };

    const pollSystemClipboard = () => {
        systemClipboard.get_text(St.ClipboardType.CLIPBOARD, (cb, newClipboardText) => {
            if (newClipboardText && newClipboardText.trim() !== '') {
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
            }
        });
    };

    renderClipboardItems();
    startPollingTimer(pollSystemClipboard, TICK_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    return container;
}
