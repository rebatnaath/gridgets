import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { getWidgets, saveWidgets, deleteCacheFile } from '../utils/widgetUtils.js';
import { buildWidgetEditPanel } from './widgetEditDialogs.js';
import { getStoreWidgetEntry, getWidgetDetailText } from './widgetCatalog.js';

const GLOBAL_SECTION_KEY = 'global';
const PRIMARY_SECTION_KEY = 'primary';

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
    const metadataText = `Position: (Col: ${widget.x ?? 0}, Row: ${widget.y ?? 0}) • Size: ${widget.width}x${widget.height} • Monitor: ${monitorText}`;
    return detailText ? `${detailText} • ${metadataText}` : metadataText;
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

        const CACHE_TYPE_MAP = { clipboard: 'clipboard', todo: 'todos', github: 'github' };
        const cacheKey = CACHE_TYPE_MAP[widget.type];
        if (cacheKey) {
            deleteCacheFile(cacheKey, widget.id);
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

function clearRenderedGroups(page) {
    if (!page.activeGroups) {
        page.activeGroups = [];
    }

    for (const group of page.activeGroups) {
        page.remove(group);
    }

    page.activeGroups = [];
    page.activeRows = [];
}

export function populateActiveWidgets(window, settings, page) {
    clearRenderedGroups(page);

    const widgets = getWidgets(settings);
    if (widgets.length === 0) {
        const emptyGroup = new Adw.PreferencesGroup({
            title: 'Manage Widgets',
            description: 'View, edit appearance overrides, and remove currently active desktop widgets.',
        });
        const emptyRow = new Adw.ActionRow({ title: 'No widgets added yet.' });
        emptyGroup.add(emptyRow);
        page.add(emptyGroup);
        page.activeGroups.push(emptyGroup);
        page.activeRows.push(emptyRow);
        return;
    }

    const widgetsBySection = new Map();
    for (const widget of widgets) {
        const sectionKey = normalizeMonitorSectionKey(widget.monitor);
        if (!widgetsBySection.has(sectionKey)) {
            widgetsBySection.set(sectionKey, []);
        }
        widgetsBySection.get(sectionKey).push(widget);
    }

    const orderedSectionKeys = [...widgetsBySection.keys()].sort(compareSectionKeys);
    for (const sectionKey of orderedSectionKeys) {
        const section = getMonitorSectionDefinition(sectionKey, settings);
        const group = new Adw.PreferencesGroup({
            title: section.title,
            description: section.description,
        });

        const sectionWidgets = widgetsBySection.get(sectionKey);
        for (const widget of sectionWidgets) {
            const row = createWidgetRow(window, settings, widget);
            group.add(row);
            page.activeRows.push(row);
        }

        page.add(group);
        page.activeGroups.push(group);
    }
}
