import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { buildStoreView } from './storePage.js';
import { buildIndividualSettingsView } from './individualSettingsPage.js';
import { removableWidgets } from './activeWidgetsList.js';

const LIBRARY_VIEW = 'library';
const DESKTOP_VIEW = 'desktop';

/**
 * The Widgets page holds two views behind one toggle: the store (Library) and the
 * settings for the widgets already placed (On Desktop).
 *
 * AdwPreferencesPage only accepts AdwPreferencesGroup children, so the views cannot be
 * stacked pages. Instead both views add their groups to this single page and the toggle
 * shows or hides each group. Because neither view can enumerate the groups it added, and
 * because both rebuild their groups over time (store search, widget changes), this page
 * tracks which view each group belongs to and applies the active view to every group as
 * it is added.
 */
export function buildWidgetsPage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Widgets',
        icon_name: 'view-app-grid-symbolic',
    });

    const groupsByView = {
        [LIBRARY_VIEW]: new Set(),
        [DESKTOP_VIEW]: new Set(),
    };
    const viewListeners = {
        [LIBRARY_VIEW]: new Set(),
        [DESKTOP_VIEW]: new Set(),
    };

    let currentView = LIBRARY_VIEW;

    const applyVisibility = () => {
        for (const [view, groups] of Object.entries(groupsByView)) {
            for (const group of groups)
                group.set_visible(view === currentView);
        }
    };

    const host = {
        page,
        toggleGroup: null,
        activeGroupsByKey: undefined,
        activeRowsById: undefined,
        activeRowsBySection: undefined,
        get currentView() {
            return currentView;
        },
        addGroup(view, group) {
            groupsByView[view].add(group);
            page.add(group);
            group.set_visible(view === currentView);
        },
        removeGroup(group) {
            page.remove(group);
            for (const groups of Object.values(groupsByView))
                groups.delete(group);
        },
        addViewListener(view, listener) {
            viewListeners[view].add(listener);
        },
        setView(view) {
            if (view === currentView)
                return;
            currentView = view;
            if (this.toggleGroup && this.toggleGroup.get_active_name() !== view)
                this.toggleGroup.set_active_name(view);
            applyVisibility();
            for (const listener of viewListeners[view])
                listener();
        },
    };

    const switcherGroup = new Adw.PreferencesGroup();
    // The switcher spans the page like the search field and the store grid, so the two
    // views read as one page rather than as a separate control floating above it.
    const switcherBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        margin_top: 12,
        margin_bottom: 6,
        margin_start: 8,
        margin_end: 8,
    });

    const toggleGroup = new Adw.ToggleGroup({
        homogeneous: true,
        hexpand: true,
    });
    toggleGroup.add(new Adw.Toggle({ name: LIBRARY_VIEW, label: 'Library' }));
    const desktopToggle = new Adw.Toggle({ name: DESKTOP_VIEW, label: 'On Desktop' });
    toggleGroup.add(desktopToggle);
    toggleGroup.set_active_name(LIBRARY_VIEW);
    switcherBox.append(toggleGroup);
    switcherGroup.add(switcherBox);
    page.add(switcherGroup);

    host.toggleGroup = toggleGroup;

    // The count is the widgets that can actually be managed here; desktop icons are left
    // out because they belong to the desktop folder, not to the widget grid.
    const updateDesktopLabel = () => {
        const count = removableWidgets(settings).length;
        desktopToggle.set_label(count > 0 ? `On Desktop (${count})` : 'On Desktop');
    };
    updateDesktopLabel();
    const widgetsChangedId = settings.connect('changed::widgets', updateDesktopLabel);
    page.connect('destroy', () => settings.disconnect(widgetsChangedId));

    toggleGroup.connect('notify::active-name', () => {
        host.setView(toggleGroup.get_active_name());
    });

    buildStoreView(window, settings, extensionPath, host);
    buildIndividualSettingsView(window, settings, host);

    return page;
}
