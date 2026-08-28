import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import { populateActiveWidgets } from './activeWidgetsList.js';

export function buildIndividualSettingsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Individual Settings',
        icon_name: 'org.gnome.tweaks-symbolic',
        name: 'individual-settings',
    });

    let isListDirty = true;

    const isPageVisible = () => window.get_visible_page() === page;
    const refreshActiveWidgets = () => {
        populateActiveWidgets(window, settings, page);
        isListDirty = false;
    };

    if (isPageVisible()) {
        refreshActiveWidgets();
    }

    const markDirtyOnVisible = () => {
        if (isPageVisible()) {
            refreshActiveWidgets();
            return;
        }
        isListDirty = true;
    };

    const widgetsChangedSignalId = settings.connect('changed::widgets', markDirtyOnVisible);
    const globalMonitorChangedSignalId = settings.connect('changed::global-monitor', markDirtyOnVisible);

    const visiblePageChangedSignalId = window.connect('notify::visible-page', () => {
        if (isPageVisible() && isListDirty) {
            refreshActiveWidgets();
        }
    });

    const openEditWidgetChangedId = settings.connect('changed::open-edit-widget-id', () => {
        consumePendingEditRequest();
    });

    // Safety net for cross-process dconf lag: by the time the window maps,
    // a write made just before the prefs process spawned is guaranteed visible.
    const pendingEditMapCheckSignalId = window.connect('map', () => consumePendingEditRequest());

    let navigateMappedSignalId = 0;
    let navigateRetrySourceId = 0;
    let pendingNavigateWidgetId = null;

    page.connect('unrealize', () => {
        if (widgetsChangedSignalId) {
            settings.disconnect(widgetsChangedSignalId);
        }
        if (globalMonitorChangedSignalId) {
            settings.disconnect(globalMonitorChangedSignalId);
        }
        if (visiblePageChangedSignalId) {
            window.disconnect(visiblePageChangedSignalId);
        }
        if (openEditWidgetChangedId) {
            settings.disconnect(openEditWidgetChangedId);
        }
        if (pendingEditMapCheckSignalId) {
            window.disconnect(pendingEditMapCheckSignalId);
        }
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

    const clearPendingEditId = (widgetId) => {
        if (settings.get_string('open-edit-widget-id') === widgetId) {
            settings.set_string('open-edit-widget-id', '');
        }
    };

    const navigateToWidget = (widgetId) => {
        window.set_visible_page(page);
        if (isListDirty) {
            refreshActiveWidgets();
        }
        const targetRow = page.activeRows.find(row => row.widgetId === widgetId);
        if (targetRow) {
            targetRow.set_expanded(true);
        }
        return Boolean(targetRow);
    };

    // Replaces any in-flight retry so a newer request takes precedence.
    const finishOrRetryNavigation = () => {
        const widgetId = pendingNavigateWidgetId;
        if (!widgetId) return;
        if (navigateToWidget(widgetId)) {
            clearPendingEditId(widgetId);
            pendingNavigateWidgetId = null;
            return;
        }

        // Rows may not exist yet on first present; give the list one more tick.
        if (navigateRetrySourceId) return;
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

    const scheduleNavigateToWidget = (widgetId) => {
        if (!widgetId || widgetId.trim() === '') return;
        if (pendingNavigateWidgetId === widgetId) return;
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

    // Does NOT clear the key here; it is cleared only after navigation succeeds.
    function consumePendingEditRequest() {
        const id = settings.get_string('open-edit-widget-id');
        if (id && id.trim() !== '') {
            scheduleNavigateToWidget(id);
        }
    }

    consumePendingEditRequest();

    return page;
}
