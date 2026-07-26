/**
 * ============================================================================
 * PREFERENCES: INDIVIDUAL SETTINGS PAGE
 * 
 * Defines the "Individual Settings" / "Manage Widgets" page, allowing users
 * to view active widgets on their desktop grid, remove widgets, and open
 * per-widget edit dialogs with custom aesthetic overrides.
 * ============================================================================
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import { populateActiveWidgets } from './activeWidgetsList.js';
import { openWidgetEditDialog } from './widgetEditDialogs.js';
import { getWidgets } from '../utils/widgetUtils.js';

export function buildIndividualSettingsPage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Individual Settings',
        icon_name: 'org.gnome.tweaks-symbolic',
    });

    const activeGroup = new Adw.PreferencesGroup({
        title: 'Manage Widgets',
        description: 'View, edit appearance overrides, and remove currently active desktop widgets.',
    });
    page.add(activeGroup);

    populateActiveWidgets(window, settings, activeGroup, extensionPath);

    const widgetsChangedSignalId = settings.connect('changed::widgets', () => {
        populateActiveWidgets(window, settings, activeGroup, extensionPath);
    });

    window.connect('unrealize', () => {
        if (widgetsChangedSignalId) {
            settings.disconnect(widgetsChangedSignalId);
        }
    });

    const openEditWidgetId = settings.get_string('open-edit-widget-id');
    if (openEditWidgetId && openEditWidgetId.trim() !== '') {
        settings.set_string('open-edit-widget-id', '');
        window.set_visible_page(page);
        try {
            const widgets = getWidgets(settings);
            const targetWidget = widgets.find(w => w.id === openEditWidgetId);
            if (targetWidget) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    openWidgetEditDialog(window, targetWidget, settings);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            console.error('Error opening widget edit dialog:', e);
        }
    }

    return page;
}
