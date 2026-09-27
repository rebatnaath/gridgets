import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { getWidgets, saveWidgets, deleteCacheFile } from '../utils/widgetUtils.js';
import { getWidgetCacheFolder } from '../utils/widgetRegistry.js';
import { deleteLastGoodCache } from '../utils/lastGoodCache.js';
import { buildWidgetEditPanel } from './widgetEditDialogs.js';
import { getStoreWidgetEntry, getWidgetDetailText } from './widgetCatalog.js';

const GLOBAL_SECTION_KEY = 'global';
const PRIMARY_SECTION_KEY = 'primary';
// Key for the placeholder group shown when no widgets exist. It never collides with a
// real section because it is only stored while the list is empty.
const EMPTY_SECTION_KEY = 'empty';

function normalizeMonitorSectionKey(monitorSetting) {
    if (!monitorSetting || monitorSetting === GLOBAL_SECTION_KEY) {
        return GLOBAL_SECTION_KEY;
    }

    if (monitorSetting === PRIMARY_SECTION_KEY) {
        return PRIMARY_SECTION_KEY;
    }

    const monitorIndex = Number.parseInt(monitorSetting, 10);
    if (!Number.isNaN(monitorIndex) && monitorIndex >= 0) {
        return String(monitorIndex);
    }

    return GLOBAL_SECTION_KEY;
}

function formatGlobalMonitorMode(globalMonitorSetting) {
    if (!globalMonitorSetting || globalMonitorSetting === 'primary') {
        return 'Primary Monitor';
    }

    if (globalMonitorSetting === 'all') {
        return 'All Monitors (Span Canvas)';
    }

    if (globalMonitorSetting === 'each') {
        return 'All Monitors (Independent Grids)';
    }

    const monitorIndex = Number.parseInt(globalMonitorSetting, 10);
    if (!Number.isNaN(monitorIndex) && monitorIndex >= 0) {
        return `Monitor ${monitorIndex + 1}`;
    }

    return 'Primary Monitor';
}

function formatMonitorLabel(monitorSetting) {
    const sectionKey = normalizeMonitorSectionKey(monitorSetting);

    if (sectionKey === GLOBAL_SECTION_KEY) {
        return 'Default (Follow Global)';
    }

    if (sectionKey === PRIMARY_SECTION_KEY) {
        return 'Primary Monitor';
    }

    return `Monitor ${Number.parseInt(sectionKey, 10) + 1}`;
}

function getMonitorSectionDefinition(sectionKey, settings) {
    if (sectionKey === GLOBAL_SECTION_KEY) {
        const globalMonitorSetting = settings.get_string('global-monitor') || 'primary';
        return {
            title: 'Global State',
            description: `Widgets in this section follow the current global monitor target: ${formatGlobalMonitorMode(globalMonitorSetting)}.`,
        };
    }

    if (sectionKey === PRIMARY_SECTION_KEY) {
        return {
            title: 'Primary Monitor',
            description: 'Widgets in this section are pinned to the primary monitor.',
        };
    }

    const monitorNumber = Number.parseInt(sectionKey, 10) + 1;
    return {
        title: `Monitor ${monitorNumber}`,
        description: `Widgets in this section are pinned directly to Monitor ${monitorNumber}.`,
    };
}

function compareSectionKeys(leftKey, rightKey) {
    const sectionOrder = [GLOBAL_SECTION_KEY, PRIMARY_SECTION_KEY];
    const leftIndex = sectionOrder.indexOf(leftKey);
    const rightIndex = sectionOrder.indexOf(rightKey);

    if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) {
            return 1;
        }
        if (rightIndex === -1) {
            return -1;
        }
        return leftIndex - rightIndex;
    }

    return Number.parseInt(leftKey, 10) - Number.parseInt(rightKey, 10);
}

function buildWidgetSubtitle(widget) {
    const detailText = getWidgetDetailText(widget);
    const monitorText = formatMonitorLabel(widget.monitor);
    const metadataText = `${widget.width ?? 0}×${widget.height ?? 0} · ${monitorText}`;
    return detailText ? `${detailText} · ${metadataText}` : metadataText;
}

function createWidgetRow(window, settings, widget) {
    const widgetEntry = getStoreWidgetEntry(widget);
    const rowTitle = widgetEntry ? widgetEntry.title : 'Color Block';
    const rowIconName = widgetEntry ? widgetEntry.fallbackIconName : 'image-x-generic-symbolic';

    const expanderRow = new Adw.ExpanderRow({
        title: rowTitle,
        subtitle: buildWidgetSubtitle(widget),
        use_markup: false,
    });
    expanderRow.widgetId = widget.id;
    expanderRow.widgetType = widget.type;
    expanderRow.monitorSectionKey = normalizeMonitorSectionKey(widget.monitor);
    expanderRow.editPanelLoaded = false;

    const icon = new Gtk.Image({
        icon_name: rowIconName,
        pixel_size: 28,
        margin_end: 8,
    });
    expanderRow.add_prefix(icon);

    const deleteButton = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        css_classes: ['destructive-action', 'flat'],
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Remove Widget',
    });

    deleteButton.connect('clicked', () => {
        const widgets = getWidgets(settings);
        const remainingWidgets = widgets.filter(existingWidget => existingWidget.id !== widget.id);

        const cacheFolder = getWidgetCacheFolder(widget.type);
        if (cacheFolder) {
            deleteCacheFile(cacheFolder, widget.id);
            deleteLastGoodCache(widget.type, widget.id);
        }

        saveWidgets(settings, remainingWidgets);
    });

    expanderRow.add_suffix(deleteButton);

    expanderRow.connect('notify::expanded', () => {
        if (!expanderRow.get_expanded() || expanderRow.editPanelLoaded) {
            return;
        }

        const editPanel = buildWidgetEditPanel(window, widget, settings, updatedWidget => {
            expanderRow.set_subtitle(buildWidgetSubtitle(updatedWidget));

            const updatedEntry = getStoreWidgetEntry(updatedWidget);
            if (updatedEntry) {
                expanderRow.set_title(updatedEntry.title);
            }
        });

        expanderRow.add_row(editPanel);
        expanderRow.editPanelLoaded = true;
    });

    return expanderRow;
}

/**
 * Rebuilds the list in place, reusing the row of every widget that is unchanged.
 *
 * The list used to be cleared and rebuilt from scratch, which threw away the edit
 * panel of any other widget that was open. Those panels hold unsaved edits, so saving
 * one widget silently discarded the work in another. A row is only rebuilt when the
 * widget behind it is gone, changed type, or moved to a different monitor section.
 *
 * AdwPreferencesGroup has no API to enumerate its children, so the rows this function
 * adds are tracked here rather than read back off the widget.
 */
export function populateActiveWidgets(window, settings, page) {
    const widgets = getWidgets(settings);

    const previousGroups = page.activeGroupsByKey instanceof Map
        ? page.activeGroupsByKey
        : new Map();
    const previousRows = page.activeRowsById instanceof Map
        ? page.activeRowsById
        : new Map();
    const previousRowsBySection = page.activeRowsBySection instanceof Map
        ? page.activeRowsBySection
        : new Map();

    const widgetsBySection = new Map();
    for (const widget of widgets) {
        const sectionKey = normalizeMonitorSectionKey(widget.monitor);
        if (!widgetsBySection.has(sectionKey))
            widgetsBySection.set(sectionKey, []);
        widgetsBySection.get(sectionKey).push(widget);
    }

    for (const [sectionKey, group] of previousGroups) {
        if (widgetsBySection.has(sectionKey))
            continue;
        page.remove(group);
        previousGroups.delete(sectionKey);
        for (const row of previousRowsBySection.get(sectionKey) || [])
            previousRows.delete(row.widgetId);
        previousRowsBySection.delete(sectionKey);
    }

    if (widgets.length === 0) {
        for (const group of previousGroups.values())
            page.remove(group);
        previousGroups.clear();
        previousRows.clear();
        previousRowsBySection.clear();

        const emptyGroup = new Adw.PreferencesGroup({
            title: 'Manage Widgets',
            description: 'View, edit appearance overrides, and remove currently active desktop widgets.',
        });
        emptyGroup.add(new Adw.ActionRow({ title: 'No widgets added yet.' }));
        page.add(emptyGroup);
        previousGroups.set(EMPTY_SECTION_KEY, emptyGroup);
        page.activeGroupsByKey = previousGroups;
        page.activeRowsById = previousRows;
        page.activeRowsBySection = previousRowsBySection;
        return;
    }

    const orderedSectionKeys = [...widgetsBySection.keys()].sort(compareSectionKeys);
    for (const sectionKey of orderedSectionKeys) {
        const section = getMonitorSectionDefinition(sectionKey, settings);
        let group = previousGroups.get(sectionKey);
        if (!group) {
            group = new Adw.PreferencesGroup({
                title: section.title,
                description: section.description,
            });
            page.add(group);
            previousGroups.set(sectionKey, group);
        } else {
            group.set_title(section.title);
            group.set_description(section.description);
        }

        const sectionWidgets = widgetsBySection.get(sectionKey);
        const sectionRows = [];
        const claimedRowIds = new Set();

        for (const widget of sectionWidgets) {
            const existingRow = previousRows.get(widget.id);
            // A row carries its title, icon and delete handler from the widget it was
            // built for, so it cannot outlive a change to any of those.
            const isReusable = existingRow
                && widget.type === existingRow.widgetType
                && sectionKey === existingRow.monitorSectionKey;
            const row = isReusable ? existingRow : createWidgetRow(window, settings, widget);
            if (!isReusable) {
                group.add(row);
                previousRows.set(widget.id, row);
            }
            claimedRowIds.add(row.widgetId);
            sectionRows.push(row);
        }

        const previousSectionRows = previousRowsBySection.get(sectionKey) || [];
        for (const staleRow of previousSectionRows) {
            if (claimedRowIds.has(staleRow.widgetId))
                continue;
            group.remove(staleRow);
            previousRows.delete(staleRow.widgetId);
        }
        previousRowsBySection.set(sectionKey, sectionRows);
    }

    page.activeGroupsByKey = previousGroups;
    page.activeRowsById = previousRows;
    page.activeRowsBySection = previousRowsBySection;
}
