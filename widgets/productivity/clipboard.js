import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveChildCornerRadius, DEFAULT_CHILD_CORNER_RADIUS_PX, saveJsonToFile } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import {
    createWidgetContainer,
    connectTimerCleanup,
    startPollingTimer,
    attachResponsiveScaler
} from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const TICK_INTERVAL_MS = 1000;
const MAX_HISTORY_LENGTH = 25;
const PREVIEW_TEXT_MAX_LENGTH = 40;
const PREVIEW_TEXT_MIN_LENGTH = 20;
const BASE_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const BASE_ITEM_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const ITEM_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const ITEM_PADDING_V_PX = 9;
const ITEM_PADDING_H_PX = 11;
const LIST_SPACING_PX = 6;
const CONTENT_PADDING_PX = 12;
const HEADER_PADDING_V_PX = 10;
const HEADER_PADDING_H_PX = 14;
const HEADER_BORDER_WIDTH_PX = 1;

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 160;

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let currentScale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const borderRadius = config.appliedBorderRadius || 0;
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
        style: `padding: ${HEADER_PADDING_V_PX}px ${HEADER_PADDING_H_PX}px;`
            + `background-color: ${card};`
            + `border-radius: ${borderRadius}px ${borderRadius}px 0 0;`
            + `border-bottom: ${HEADER_BORDER_WIDTH_PX}px solid ${highlight};`,
    });

    const headerLabel = new St.Label({
        text: 'Clipboard History',
        style: `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    const itemContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${Math.max(1, Math.round(LIST_SPACING_PX * currentScale))}px;`,
    });

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    scrollView.set_child(itemContainer);
    const scrollArea = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${CONTENT_PADDING_PX}px;`,
    });
    scrollArea.add_child(scrollView);
    contentBox.add_child(scrollArea);
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
                style: `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.secondary}; font-size: ${scaleFontSize(BASE_ITEM_FONT_SIZE, currentScale, MIN_FONT_SIZE.label)}px;`,
            });
            itemContainer.add_child(emptyLabel);
            return;
        }

        const maxLen = Math.max(PREVIEW_TEXT_MIN_LENGTH, Math.round(PREVIEW_TEXT_MAX_LENGTH * currentScale));
        const itemRadius = resolveChildCornerRadius(ITEM_RADIUS_PX, currentScale);
        const itemPadding = `${Math.max(1, Math.round(ITEM_PADDING_V_PX * currentScale))}px ${Math.max(1, Math.round(ITEM_PADDING_H_PX * currentScale))}px`;
        const itemNormalStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${card};`;
        const itemHoverStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${highlight};`;

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
                style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(BASE_ITEM_FONT_SIZE, currentScale, MIN_FONT_SIZE.label)}px;`,
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

    function applyScale(scale) {
        currentScale = scale;
        const titleFontSize = scaleFontSize(BASE_TITLE_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle);
        headerLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`);
        itemContainer.set_style(`spacing: ${Math.max(1, Math.round(LIST_SPACING_PX * scale))}px;`);
        renderClipboardItems();
    }

    applyScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyScale(scale);
    });

    return container;
}
