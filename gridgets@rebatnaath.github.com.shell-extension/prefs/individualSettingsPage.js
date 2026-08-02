/**
 * ============================================================================
 * PREFERENCES: INDIVIDUAL SETTINGS PAGE
 *
 * Defines the "Individual Settings" page and keeps its widget sections in sync
 * with GSettings without rebuilding hidden content eagerly.
 * ============================================================================
 */

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

    const widgetsChangedSignalId = settings.connect('changed::widgets', () => {
        if (isPageVisible()) {
            refreshActiveWidgets();
            return;
        }

        isListDirty = true;
    });

    const globalMonitorChangedSignalId = settings.connect('changed::global-monitor', () => {
        if (isPageVisible()) {
            refreshActiveWidgets();
            return;
        }

        isListDirty = true;
    });

    const visiblePageChangedSignalId = window.connect('notify::visible-page', () => {
        if (isPageVisible() && isListDirty) {
            refreshActiveWidgets();
        }
    });

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
    });

    const openEditWidgetId = settings.get_string('open-edit-widget-id');
    if (openEditWidgetId && openEditWidgetId.trim() !== '') {
        settings.set_string('open-edit-widget-id', '');
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                window.set_visible_page(page);
                if (isListDirty) {
                    refreshActiveWidgets();
                }

                const targetRow = page.activeRows?.find(row => row.widgetId === openEditWidgetId);
                if (targetRow) {
                    targetRow.set_expanded(true);
                }
            } catch (error) {
                console.error('Error navigating to the target widget settings:', error);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    return page;
}
