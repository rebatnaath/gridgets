import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveChildCornerRadius, resolveAccentColor, cssColorToRgba, DEFAULT_CHILD_CORNER_RADIUS_PX, saveJsonToFile, resolveWidgetCornerRadius, GRID_GAP_PX } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, clampWidgetScale, createWidgetMetrics } from '../../utils/typography.js';
import { relativeTimeFromIso } from '../../utils/feedText.js';
import {
    createWidgetContainer,
    registerWidgetCleanup,
    connectTimerCleanup,
    startPollingTimer,
    attachResponsiveScaler
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const TICK_INTERVAL_MS = 1000;
const MAX_HISTORY_LENGTH = 25;

const BASE_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_ITEM_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_META_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_BADGE_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_COUNT_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_SEARCH_FONT_SIZE = TYPOGRAPHY_SIZE.label;
const BASE_SECTION_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;

const ITEM_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const ITEM_PADDING_V_PX = 7;
const ITEM_PADDING_H_PX = 9;
const ITEM_SPACING_PX = 8;
const LIST_SPACING_PX = 6;
const CONTENT_PADDING_PX = 12;
const HEADER_PADDING_V_PX = 10;
const HEADER_PADDING_H_PX = 14;
const HEADER_BORDER_WIDTH_PX = 1;

const BADGE_SIZE_PX = 30;
const BADGE_RADIUS_PX = 10;
const SEARCH_FIELD_RADIUS_PX = 10;
const SEARCH_FIELD_PADDING_V_PX = 7;
const SEARCH_FIELD_PADDING_H_PX = 10;
const SEARCH_ICON_SIZE_PX = 16;
const SEARCH_FIELD_MARGIN_PX = 10;
const PIN_ICON_SIZE_PX = 14;
const PIN_PADDING_PX = 4;
const PIN_HOVER_ALPHA = 0.18;
const COUNT_PILL_PADDING_H_PX = 10;
const COUNT_PILL_PADDING_V_PX = 4;
const PILL_RADIUS_PX = 9999;

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 160;
// The list grows by footprint, not by text: every preset renders at the scale the middle
// tier would, so switching to a bigger size fits more rows instead of bigger rows. These
// mirror the clipboard Medium footprint in the size table and must move with it, or a
// smaller preset keeps the larger tier's text and shows fewer rows than it has room for.
const MIDDLE_PRESET_COLS = 6;
const MIDDLE_PRESET_ROWS = 7;
// The title alone tracks the footprint: a touch smaller than usual on Small, larger on
// Medium and Large, so it reads as a heading without the body text growing with it.
const TITLE_BOOST = 1.1;
const CLUTTER_OPACITY_OPAQUE = 255;
const BADGE_TINT_ALPHA = 0.18;

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;
const NUMBER_PATTERN = /^[\d\s.,+\-]+$/;

const ITEM_TYPE_META = Object.freeze({
    text: { label: 'Text', glyph: 'Aa' },
    number: { label: 'Number', glyph: '#' },
    link: { label: 'Link', glyph: '↗' },
});

// One tint per content kind so a glance tells text from a number from a link. Text keeps
// the theme accent; the other two are fixed because there is no per-role accent to borrow.
const ITEM_TYPE_COLORS = Object.freeze({
    number: '#c88800',
    link: '#3584e4',
});

function classifyClipboardText(text) {
    const trimmed = text.trim();
    if (URL_PATTERN.test(trimmed))
        return 'link';
    if (NUMBER_PATTERN.test(trimmed) && /\d/.test(trimmed))
        return 'number';
    return 'text';
}

/** Compact "5m ago"/"now" label for a stored timestamp; empty when it is not a number. */
function relativeTimeLabel(timestamp) {
    if (!Number.isFinite(timestamp))
        return '';
    return relativeTimeFromIso(new Date(timestamp).toISOString(), { compact: true });
}

/** The scale a footprint renders at, mirroring gridGeometry's cell-and-gap sizing. */
function scaleForFootprint(cols, rows, cellSize) {
    const footprintWidth = (cols * cellSize) + ((cols - 1) * GRID_GAP_PX);
    const footprintHeight = (rows * cellSize) + ((rows - 1) * GRID_GAP_PX);
    return clampWidgetScale(Math.min(footprintWidth / REF_WIDTH_PX, footprintHeight / REF_HEIGHT_PX));
}

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const accentHex = resolveAccentColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    // `config.width`/`height` are this widget's grid span, so its cell pitch gives the
    // middle-tier scale to hold; the ratio keeps that density when the grid reflows.
    const presetCols = config.width || MIDDLE_PRESET_COLS;
    const presetRows = config.height || MIDDLE_PRESET_ROWS;
    const cellSize = Math.max(1, (width - ((presetCols - 1) * GRID_GAP_PX)) / presetCols);
    const middleScale = scaleForFootprint(MIDDLE_PRESET_COLS, MIDDLE_PRESET_ROWS, cellSize);
    const fontScaleRatio = middleScale / scaleForFootprint(presetCols, presetRows, cellSize);

    let currentScale = middleScale;
    let searchQuery = '';

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const borderRadius = resolveWidgetCornerRadius(config);
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
        style: `${fontCss}color: ${textColor};`,
        opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });

    const countPill = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const countLabel = new St.Label({
        text: '0 items',
        style: `${fontCss}color: ${textColor};`,
        opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
        y_align: Clutter.ActorAlign.CENTER,
    });
    countPill.add_child(countLabel);

    headerBox.add_child(headerLabel);
    headerBox.add_child(countPill);
    contentBox.add_child(headerBox);

    const searchEntry = new St.Entry({
        hint_text: 'Search history',
        can_focus: true,
        x_expand: true,
    });
    searchEntry.primary_icon = new St.Icon({
        icon_name: 'system-search-symbolic',
        style: `color: ${textColor};`,
    });
    // The hint actor carries a theme color of its own that ignores the entry's color, so a
    // light theme leaves the placeholder too pale to read on the field; pin it to the fg.
    searchEntry.get_hint_actor().set_style(`color: ${cssColorToRgba(textColor, TEXT_OPACITY.secondary)};`);
    searchEntry.clutter_text.connect('text-changed', () => {
        searchQuery = searchEntry.get_text().trim().toLowerCase();
        renderClipboardItems();
    });
    // The shell leaves key focus on an entry when the press lands elsewhere, so watch the
    // stage during capture and drop focus whenever the press is outside the field. Capture
    // runs before any actor consumes the event, so this also catches desktop and shell clicks.
    const stageFocusId = global.stage.connect('captured-event', (_stage, event) => {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const focus = global.stage.get_key_focus();
        if (!focus || !searchEntry.contains(focus))
            return Clutter.EVENT_PROPAGATE;
        const target = event.get_source();
        if (target && searchEntry.contains(target))
            return Clutter.EVENT_PROPAGATE;
        global.stage.set_key_focus(null);
        // Drop the query with the focus, so an abandoned search does not keep filtering.
        if (searchEntry.get_text() !== '')
            searchEntry.set_text('');
        return Clutter.EVENT_PROPAGATE;
    });
    registerWidgetCleanup(container, () => global.stage.disconnect(stageFocusId));
    contentBox.add_child(searchEntry);

    const itemContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
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

    /** Old files stored bare strings; give each one a timestamp so it still renders. */
    const normalizeEntry = (entry) => {
        if (typeof entry === 'string')
            return { text: entry, timestamp: Date.now(), pinned: false };
        if (entry && typeof entry.text === 'string') {
            return {
                text: entry.text,
                timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
                pinned: entry.pinned === true,
            };
        }
        return null;
    };

    loadJsonFromFileAsync(clipboardFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && Array.isArray(savedData.history)) {
            state.clipboardHistory = savedData.history.map(normalizeEntry).filter(Boolean);
            renderClipboardItems();
        } else if (!loadError) {
            saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        }
    });

    const systemClipboard = St.Clipboard.get_default();

    const togglePin = (entry) => {
        entry.pinned = entry.pinned !== true;
        saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        renderClipboardItems();
    };

    // Copying an entry reuses it rather than pushing a second one: it moves to the front
    // with a fresh timestamp, and the poll then sees it as already latest.
    const promoteEntry = (entry) => {
        entry.timestamp = Date.now();
        const index = state.clipboardHistory.indexOf(entry);
        if (index > 0) {
            state.clipboardHistory.splice(index, 1);
            state.clipboardHistory.unshift(entry);
        }
        saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        renderClipboardItems();
    };

    const buildItemRow = (entry, itemRadius) => {
        const { px } = createWidgetMetrics(currentScale);
        const typeId = classifyClipboardText(entry.text);
        const meta = ITEM_TYPE_META[typeId];
        const badgeColor = ITEM_TYPE_COLORS[typeId] || accentHex;

        const itemPadding = `${px(ITEM_PADDING_V_PX)}px ${px(ITEM_PADDING_H_PX)}px`;
        const itemNormalStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${card};`;
        const itemHoverStyle = `padding: ${itemPadding}; border-radius: ${itemRadius}px;`
            + `background-color: ${highlight};`;

        // Built as a button so a click anywhere on the row, labels included, copies the
        // entry, the same way the app launcher's tiles take their clicks.
        const rowButton = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
            style: itemNormalStyle,
        });
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: `spacing: ${px(ITEM_SPACING_PX)}px;`,
        });
        rowButton.set_child(row);

        rowButton.connect('enter-event', () => {
            rowButton.style = itemHoverStyle;
            return Clutter.EVENT_PROPAGATE;
        });
        rowButton.connect('leave-event', () => {
            rowButton.style = itemNormalStyle;
            return Clutter.EVENT_PROPAGATE;
        });

        const badgeSize = px(BADGE_SIZE_PX);
        const badge = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: `background-color: ${cssColorToRgba(badgeColor, BADGE_TINT_ALPHA)};`
                + `border-radius: ${px(BADGE_RADIUS_PX)}px;`
                + `width: ${badgeSize}px; height: ${badgeSize}px;`,
        });
        const badgeGlyph = new St.Label({
            text: meta.glyph,
            style: `${fontCss}color: ${badgeColor};`
                + `font-size: ${px(BASE_BADGE_FONT_SIZE)}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        badge.add_child(badgeGlyph);
        row.add_child(badge);

        const textColumn = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const titleLabel = new St.Label({
            text: entry.text.replace(/\n/g, ' '),
            style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_ITEM_FONT_SIZE)}px;`,
            x_expand: true,
        });
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textColumn.add_child(titleLabel);

        const subtitle = `${meta.label} \u00b7 ${relativeTimeLabel(entry.timestamp)}`.replace(/\s+\u00b7\s*$/, '');
        const subtitleLabel = new St.Label({
            text: subtitle,
            style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_META_FONT_SIZE)}px;`,
            opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
        });
        textColumn.add_child(subtitleLabel);

        row.add_child(textColumn);

        // A pinned row keeps the pin lit in the accent; an unpinned one shows it faint so
        // it reads as an action waiting to be taken. Hovering fills a rounded chip behind
        // it, since the row's own hover highlight sits underneath and would hide the icon.
        const pinPadding = px(PIN_PADDING_PX);
        const pinRadius = px(ITEM_RADIUS_PX);
        const pinNormalStyle = `padding: ${pinPadding}px; border-radius: ${pinRadius}px;`
            + `background-color: transparent;`;
        const pinHoverStyle = `padding: ${pinPadding}px; border-radius: ${pinRadius}px;`
            + `background-color: ${cssColorToRgba(accentHex, PIN_HOVER_ALPHA)};`;

        const pinButton = new St.Button({
            child: new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: px(PIN_ICON_SIZE_PX),
                style: `color: ${entry.pinned ? accentHex : textColor};`,
            }),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: pinNormalStyle,
        });
        const setPinOpacity = () => {
            pinButton.child.opacity = entry.pinned
                ? CLUTTER_OPACITY_OPAQUE
                : Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.disabled);
        };
        setPinOpacity();
        pinButton.connect('enter-event', () => {
            pinButton.style = pinHoverStyle;
            pinButton.child.opacity = CLUTTER_OPACITY_OPAQUE;
            return Clutter.EVENT_PROPAGATE;
        });
        pinButton.connect('leave-event', () => {
            pinButton.style = pinNormalStyle;
            setPinOpacity();
            return Clutter.EVENT_PROPAGATE;
        });
        pinButton.connect('clicked', () => togglePin(entry));
        row.add_child(pinButton);

        rowButton.connect('clicked', () => {
            systemClipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text);
            // Deferred: rebuilding the list destroys this row mid-event.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!isActorDestroyed(container))
                    promoteEntry(entry);
                return GLib.SOURCE_REMOVE;
            });
        });

        return rowButton;
    };

    const buildSectionHeader = (label) => {
        const { px } = createWidgetMetrics(currentScale);
        const headerLabel = new St.Label({
            text: label.toUpperCase(),
            style: `${fontCss}color: ${textColor};`
                + `font-size: ${px(BASE_SECTION_FONT_SIZE)}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`,
            opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
        });
        return headerLabel;
    };

    const renderClipboardItems = () => {
        if (isActorDestroyed(container)) return;
        const { px } = createWidgetMetrics(currentScale);
        itemContainer.destroy_all_children();

        const total = state.clipboardHistory.length;
        countLabel.text = total === 1 ? '1 item' : `${total} items`;

        if (total === 0) {
            const emptyLabel = new St.Label({
                text: 'No history yet.',
                style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_ITEM_FONT_SIZE)}px;`,
                opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
            });
            itemContainer.add_child(emptyLabel);
            return;
        }

        const matchesSearch = (entry) => !searchQuery || entry.text.toLowerCase().includes(searchQuery);
        const pinnedEntries = state.clipboardHistory.filter(entry => entry.pinned && matchesSearch(entry));
        const recentEntries = state.clipboardHistory.filter(entry => !entry.pinned && matchesSearch(entry));

        if (pinnedEntries.length === 0 && recentEntries.length === 0) {
            const noMatchLabel = new St.Label({
                text: 'No matches.',
                style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_ITEM_FONT_SIZE)}px;`,
                opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
            });
            itemContainer.add_child(noMatchLabel);
            return;
        }

        const itemRadius = resolveChildCornerRadius(ITEM_RADIUS_PX, currentScale);
        if (pinnedEntries.length > 0) {
            itemContainer.add_child(buildSectionHeader('Pinned'));
            pinnedEntries.forEach(entry => itemContainer.add_child(buildItemRow(entry, itemRadius)));
        }
        if (recentEntries.length > 0) {
            if (pinnedEntries.length > 0)
                itemContainer.add_child(buildSectionHeader('Recent'));
            recentEntries.forEach(entry => itemContainer.add_child(buildItemRow(entry, itemRadius)));
        }
    };

    const pollSystemClipboard = () => {
        if (isActorDestroyed(container)) return;
        systemClipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, newClipboardText) => {
            if (isActorDestroyed(container) || !newClipboardText || newClipboardText.trim() === '') return;

            const isAlreadyLatest = state.clipboardHistory.length > 0
                && state.clipboardHistory[0].text === newClipboardText;

            if (!isAlreadyLatest) {
                const existingIndex = state.clipboardHistory.findIndex(entry => entry.text === newClipboardText);
                const wasPinned = existingIndex > -1 && state.clipboardHistory[existingIndex].pinned === true;
                if (existingIndex > -1)
                    state.clipboardHistory.splice(existingIndex, 1);

                state.clipboardHistory.unshift({ text: newClipboardText, timestamp: Date.now(), pinned: wasPinned });
                if (state.clipboardHistory.length > MAX_HISTORY_LENGTH) {
                    // Drop the oldest entry the user has not pinned, so trimming never
                    // discards a kept item.
                    const staleIndex = state.clipboardHistory.findLastIndex(entry => !entry.pinned);
                    if (staleIndex > -1)
                        state.clipboardHistory.splice(staleIndex, 1);
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
        const { px } = createWidgetMetrics(scale);
        // `scale` is the middle-tier density every row uses; the title alone leans by the
        // widget's column span, so Small shrinks it and Medium/Large grow it.
        const titleFontSize = px(BASE_TITLE_FONT_SIZE * (presetCols / MIDDLE_PRESET_COLS) * TITLE_BOOST);
        headerLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`);
        countLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${px(BASE_COUNT_FONT_SIZE)}px; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`);
        countPill.set_style(`background-color: ${highlight}; border-radius: ${PILL_RADIUS_PX}px;`
            + `padding: ${px(COUNT_PILL_PADDING_V_PX)}px ${px(COUNT_PILL_PADDING_H_PX)}px;`);
        searchEntry.primary_icon.icon_size = px(SEARCH_ICON_SIZE_PX);
        searchEntry.set_style(`background-color: ${highlight}; color: ${textColor};`
            + `font-size: ${px(BASE_SEARCH_FONT_SIZE)}px;`
            + `border-radius: ${px(SEARCH_FIELD_RADIUS_PX)}px;`
            + `padding: ${px(SEARCH_FIELD_PADDING_V_PX)}px ${px(SEARCH_FIELD_PADDING_H_PX)}px;`
            + `margin: ${px(SEARCH_FIELD_MARGIN_PX)}px ${px(CONTENT_PADDING_PX)}px;`);
        scrollArea.set_style(`padding: ${px(CONTENT_PADDING_PX)}px;`);
        itemContainer.set_style(`spacing: ${px(LIST_SPACING_PX)}px;`);
        renderClipboardItems();
    }

    applyScale(middleScale);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyScale(clampWidgetScale(scale * fontScaleRatio));
    });

    return container;
}
