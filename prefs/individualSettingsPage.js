import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { populateActiveWidgets, removableWidgets, removeAllWidgets } from './activeWidgetsList.js';
import { createSwitchRow } from './aestheticControls.js';
import { confirmDestructive } from './confirmActions.js';

export function buildIndividualSettingsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Individual Settings',
        description: 'Configure the widgets currently placed on your desktop.',
        icon_name: 'org.gnome.tweaks-symbolic',
        name: 'individual-settings',
    });

    let isListDirty = true;
    let navigateMappedSignalId = 0;
    let navigateRetrySourceId = 0;
    let pendingNavigateWidgetId = null;

    const isPageVisible = () => window.get_visible_page() === page;

    const refreshActiveWidgets = () => {
        populateActiveWidgets(window, settings, page);
        isListDirty = false;
    };

    const markDirtyOnVisible = () => {
        if (isPageVisible()) {
            refreshActiveWidgets();
            return;
        }
        isListDirty = true;
    };

    const clearPendingEditId = widgetId => {
        if (settings.get_string('open-edit-widget-id') === widgetId)
            settings.set_string('open-edit-widget-id', '');
    };

    const navigateToWidget = widgetId => {
        window.set_visible_page(page);
        if (isListDirty)
            refreshActiveWidgets();

        const rowsById = page.activeRowsById instanceof Map ? page.activeRowsById : new Map();
        const targetRow = rowsById.get(widgetId);
        if (targetRow)
            targetRow.set_expanded(true);
        return Boolean(targetRow);
    };

    const finishOrRetryNavigation = () => {
        const widgetId = pendingNavigateWidgetId;
        if (!widgetId)
            return;

        if (navigateToWidget(widgetId)) {
            clearPendingEditId(widgetId);
            pendingNavigateWidgetId = null;
            return;
        }

        if (navigateRetrySourceId)
            return;

        navigateRetrySourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            navigateRetrySourceId = 0;
            const retryId = pendingNavigateWidgetId;
            if (retryId && navigateToWidget(retryId)) {
                clearPendingEditId(retryId);
                pendingNavigateWidgetId = null;
            } else {
                pendingNavigateWidgetId = null;
            }
            return GLib.SOURCE_REMOVE;
        });
    };

    const scheduleNavigateToWidget = widgetId => {
        if (!widgetId || widgetId.trim() === '' || pendingNavigateWidgetId === widgetId)
            return;

        pendingNavigateWidgetId = widgetId;
        if (navigateMappedSignalId) {
            window.disconnect(navigateMappedSignalId);
            navigateMappedSignalId = 0;
        }

        if (window.get_mapped()) {
            finishOrRetryNavigation();
            return;
        }

        navigateMappedSignalId = window.connect('map', () => {
            window.disconnect(navigateMappedSignalId);
            navigateMappedSignalId = 0;
            finishOrRetryNavigation();
        });
    };

    const consumePendingEditRequest = () => {
        const widgetId = settings.get_string('open-edit-widget-id');
        if (widgetId && widgetId.trim() !== '')
            scheduleNavigateToWidget(widgetId);
    };

    const widgetsChangedId = settings.connect('changed::widgets', markDirtyOnVisible);
    const globalMonitorChangedId = settings.connect('changed::global-monitor', markDirtyOnVisible);
    const visiblePageChangedId = window.connect('notify::visible-page', () => {
        if (isPageVisible() && isListDirty)
            refreshActiveWidgets();
    });
    const openEditChangedId = settings.connect('changed::open-edit-widget-id', consumePendingEditRequest);
    const pendingEditMapId = window.connect('map', consumePendingEditRequest);

    page.connect('destroy', () => {
        settings.disconnect(widgetsChangedId);
        settings.disconnect(globalMonitorChangedId);
        settings.disconnect(openEditChangedId);
        window.disconnect(visiblePageChangedId);
        window.disconnect(pendingEditMapId);
        if (navigateMappedSignalId) {
            window.disconnect(navigateMappedSignalId);
            navigateMappedSignalId = 0;
        }
        if (navigateRetrySourceId) {
            GLib.Source.remove(navigateRetrySourceId);
            navigateRetrySourceId = 0;
        }
        pendingNavigateWidgetId = null;
    });

    const dangerGroup = new Adw.PreferencesGroup({
        title: 'Removing Widgets',
        description: 'Removing a widget deletes the data it has saved, and there is no undo.',
    });

    dangerGroup.add(createSwitchRow(
        'Confirm Before Removing',
        'Ask each time. Turn this off when clearing several widgets in a row.',
        settings,
        'confirm-widget-delete'
    ).row);

    const clearRow = new Adw.ActionRow({
        title: 'Delete All Widgets',
        subtitle: 'Every widget and its saved data go. Icons on your desktop stay: they come from the folder, not from here.',
    });
    const clearButton = new Gtk.Button({
        label: 'Delete All',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    // Nothing to delete should not offer to delete. Desktop icons do not count: they are
    // left behind by this action, so a grid holding only them has nothing to remove.
    const refreshClearButton = () => {
        clearButton.sensitive = removableWidgets(settings).length > 0;
    };
    clearButton.connect('clicked', () => {
        confirmDestructive(window, settings, {
            heading: 'Delete all widgets?',
            body: 'Every widget on the desktop goes, along with the data each one has saved. Icons on your desktop stay. This cannot be undone.',
            confirmLabel: 'Delete All',
        }, () => removeAllWidgets(settings));
    });
    clearRow.add_suffix(clearButton);
    refreshClearButton();
    dangerGroup.add(clearRow);
    page.add(dangerGroup);

    const widgetsChangedForClearId = settings.connect('changed::widgets', refreshClearButton);
    page.connect('destroy', () => settings.disconnect(widgetsChangedForClearId));

    refreshActiveWidgets();
    consumePendingEditRequest();
    return page;
}
