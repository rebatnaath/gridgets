import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachButtonFeedback } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';
import { subscribeToFeed } from '../utils/rssEngine.js';

const DEFAULT_REFRESH_MINUTES = 15;
const MIN_REFRESH_MINUTES = 5;
const SAVE_DEBOUNCE_MS = 2000;
const MAX_PERSISTED_ITEMS = 30;
const HEADER_FONT_SIZE_PX = 13;
const BORDER_ALPHA = 0.14;
const ITEM_FONT_SIZE_PX = 12;
const DATE_FONT_SIZE_PX = 10;

function stateFilePath(widgetId) {
    return GLib.build_filenamev([getGridgetsDataDir('rss'), `${widgetId}.json`]);
}

// Persists the current item list so reloads render instantly.
function persistItems(widgetId, items) {
    saveJsonToFile(stateFilePath(widgetId), {
        fetchedAtIso: new Date().toISOString(),
        items: items.slice(0, MAX_PERSISTED_ITEMS),
    });
}

function openLink(uri) {
    Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (sourceObj, result) => {
        try {
            Gio.AppInfo.launch_default_for_uri_finish(result);
        } catch (error) {
            console.error(`Failed to open ${uri}:`, error.message);
        }
    });
}

export function createRssNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const scale = Math.min(width / 320, height / 240);
    const refreshIntervalSeconds = Math.max(MIN_REFRESH_MINUTES, config.refreshMinutes || DEFAULT_REFRESH_MINUTES) * 60;

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.max(1, Math.round(12 * scale))}px; spacing: ${Math.max(1, Math.round(8 * scale))}px;`,
    });
    container.add_child(outerBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `spacing: ${Math.max(1, Math.round(8 * scale))}px;`,
    });
    outerBox.add_child(headerBox);

    headerBox.add_child(new St.Icon({
        icon_name: 'application-rss+xml-symbolic',
        icon_size: Math.max(1, Math.round(18 * scale)),
        style: `color: ${textColor}; opacity: 0.7;`,
    }));

    const titleLabel = new St.Label({
        text: config.feedUrl || 'RSS Feed',
        x_expand: true,
        style: `${fontCss}color: ${textColor}; `
            + `font-size: ${Math.max(1, Math.round(HEADER_FONT_SIZE_PX * scale))}px;`,
    });
    titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    headerBox.add_child(titleLabel);

    const statusLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-size: ${DATE_FONT_SIZE_PX}px;`,
    });
    headerBox.add_child(statusLabel);

    const scrollContent = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${Math.max(1, Math.round(6 * scale))}px;`,
    });
    const scroll = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scroll.set_child(scrollContent);
    scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    outerBox.add_child(scroll);

    function clearItemRows() {
        scrollContent.remove_all_children();
    }

    function buildItemRow(item) {
        const row = new St.Button({
            style_class: 'rss-item',
            x_expand: true,
            style: `
                padding: ${Math.max(1, Math.round(6 * scale))}px;
                border-radius: ${Math.max(1, Math.round(8 * scale))}px;
            `,
        });

        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: `spacing: ${Math.max(1, Math.round(3 * scale))}px;`,
        });
        row.set_child(rowBox);

        const itemTitle = new St.Label({
            text: item.title,
            x_expand: true,
            style: `${fontCss}color: ${textColor}; font-size: ${ITEM_FONT_SIZE_PX}px;`,
        });
        itemTitle.clutter_text.line_wrap = false;
        itemTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        rowBox.add_child(itemTitle);

        if (item.dateIso) {
            const itemDate = new Date(item.dateIso).toLocaleDateString();
            const dateLabel = new St.Label({
                text: itemDate,
                style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-size: ${DATE_FONT_SIZE_PX}px;`,
            });
            rowBox.add_child(dateLabel);
        }

        if (item.link) {
            row.reactive = true;
            row.connect('clicked', () => openLink(item.link));
            attachButtonFeedback(row);
        }

        return row;
    }

    function renderItems(items) {
        clearItemRows();
        if (!items || items.length === 0) {
            statusLabel.text = 'No items';
            return;
        }
        statusLabel.text = String(items.length);
        for (const item of items.slice(0, MAX_PERSISTED_ITEMS)) {
            scrollContent.add_child(buildItemRow(item));
        }
    }

    let saveDebounceId = null;
    function schedulePersist(items) {
        if (saveDebounceId) {
            GLib.Source.remove(saveDebounceId);
        }
        saveDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
            saveDebounceId = null;
            persistItems(config.id, items);
            return GLib.SOURCE_REMOVE;
        });
    }

    loadJsonFromFileAsync(stateFilePath(config.id), (cached) => {
        if (isActorDestroyed(container)) return;
        if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
            renderItems(cached.items);
        }
    });

    renderItems([]);

    const hasFeed = typeof config.feedUrl === 'string' && config.feedUrl.startsWith('http');
    const releaseFeed = hasFeed
        ? subscribeToFeed(config.feedUrl, refreshIntervalSeconds, (items) => {
            if (!items) return;
            renderItems(items);
            schedulePersist(items);
        })
        : null;

    if (!hasFeed)
        statusLabel.text = 'Set a feed URL';

    registerWidgetCleanup(container, () => {
        if (saveDebounceId) {
            GLib.Source.remove(saveDebounceId);
            saveDebounceId = null;
        }
        if (releaseFeed)
            releaseFeed();
    });

    return container;
}
