import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { MAX_APP_LAUNCHER_ITEMS, normalizeAppLauncherApps } from '../utils/widgetUtils.js';
import { clearBox } from './displayUtils.js';

const MAX_RENDERED_APP_ROWS = 80;

let cachedDesktopApplications = null;

function getDesktopApplications() {
    if (cachedDesktopApplications) return cachedDesktopApplications;

    const applications = [];
    const seenIds = new Set();
    for (const appInfo of Gio.AppInfo.get_all()) {
        const appId = appInfo.get_id();
        if (!appId || seenIds.has(appId) || !appInfo.should_show()) continue;
        seenIds.add(appId);
        applications.push({
            id: appId,
            name: appInfo.get_display_name() || appInfo.get_name() || appId,
            description: appInfo.get_description() || '',
            icon: appInfo.get_icon() || null,
        });
    }

    applications.sort((a, b) => a.name.localeCompare(b.name));
    cachedDesktopApplications = applications;
    return cachedDesktopApplications;
}

function setAppSelectionSummary(summaryLabel, helperLabel, selectedApps, statusMessage = '') {
    const selectedEntries = [...selectedApps.values()];
    const selectedNames = selectedEntries.slice(0, 4).map(app => app.name);
    const extraCount = selectedEntries.length - selectedNames.length;
    const previewText = selectedNames.length > 0
        ? `${selectedNames.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''}`
        : 'None';

    summaryLabel.set_markup(
        `<span size='small' weight='bold'>Selected (${selectedEntries.length}/${MAX_APP_LAUNCHER_ITEMS}): ${GLib.markup_escape_text(previewText, -1)}</span>`
    );

    const helperText = statusMessage || `Choose up to ${MAX_APP_LAUNCHER_ITEMS} applications.`;
    helperLabel.set_markup(
        `<span size='x-small' alpha='70%'>${GLib.markup_escape_text(helperText, -1)}</span>`
    );
}

export function createAppSelectionControls(grid, rowIdx, defaultApps = []) {
    const selectedApps = new Map(
        normalizeAppLauncherApps(defaultApps).map(app => [app.id, app])
    );

    const label = new Gtk.Label({ label: 'Applications:', xalign: 0 });

    const controlsBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        hexpand: true,
        valign: Gtk.Align.START,
    });
    controlsBox.append(label);

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search installed applications...',
        hexpand: true,
    });

    const summaryLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 40,
    });

    const helperLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 40,
    });

    const resultsListBox = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        max_content_height: 320,
        min_content_height: 220,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });
    scrolledWindow.set_child(resultsListBox);

    const desktopApplications = getDesktopApplications();

    const renderAppRows = () => {
        clearBox(resultsListBox);

        const query = searchEntry.get_text().trim().toLowerCase();
        const filteredApps = desktopApplications
            .filter(app => {
                if (query === '') return true;
                const haystacks = [app.name, app.description, app.id]
                    .filter(Boolean)
                    .map(value => value.toLowerCase());
                return haystacks.some(value => value.includes(query));
            })
            .slice(0, MAX_RENDERED_APP_ROWS);

        if (filteredApps.length === 0) {
            const emptyRow = new Gtk.ListBoxRow({ selectable: false, activatable: false });
            const emptyLabel = new Gtk.Label({
                label: 'No matching applications found.',
                xalign: 0,
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 10,
                margin_end: 10,
            });
            emptyRow.set_child(emptyLabel);
            resultsListBox.append(emptyRow);
            return;
        }

        for (const app of filteredApps) {
            const row = new Gtk.ListBoxRow({ selectable: false, activatable: false });
            const rowBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 10,
                margin_top: 8,
                margin_bottom: 8,
                margin_start: 10,
                margin_end: 10,
            });

            const icon = new Gtk.Image({
                gicon: app.icon,
                pixel_size: 24,
                valign: Gtk.Align.CENTER,
            });

            const textBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                hexpand: true,
                valign: Gtk.Align.CENTER,
            });

            const nameLabel = new Gtk.Label({
                label: app.name,
                xalign: 0,
                hexpand: true,
            });

            const detailParts = [app.description, app.id].filter(Boolean);
            const detailLabel = new Gtk.Label({
                xalign: 0,
                wrap: true,
                wrap_mode: Pango.WrapMode.WORD,
                max_width_chars: 30,
                ellipsize: Pango.EllipsizeMode.END,
            });
            detailLabel.set_markup(
                `<span size='small' alpha='65%'>${GLib.markup_escape_text(detailParts.join(' • '), -1)}</span>`
            );

            textBox.append(nameLabel);
            textBox.append(detailLabel);

            const toggleButton = new Gtk.CheckButton({
                active: selectedApps.has(app.id),
                valign: Gtk.Align.CENTER,
            });

            let isInternalToggle = false;
            toggleButton.connect('toggled', () => {
                if (isInternalToggle) return;

                const shouldSelect = toggleButton.get_active();
                if (shouldSelect) {
                    if (!selectedApps.has(app.id) && selectedApps.size >= MAX_APP_LAUNCHER_ITEMS) {
                        isInternalToggle = true;
                        toggleButton.set_active(false);
                        isInternalToggle = false;
                        setAppSelectionSummary(summaryLabel, helperLabel, selectedApps, `Maximum ${MAX_APP_LAUNCHER_ITEMS} applications allowed.`);
                        return;
                    }
                    selectedApps.set(app.id, app);
                } else {
                    selectedApps.delete(app.id);
                }
                setAppSelectionSummary(summaryLabel, helperLabel, selectedApps);
            });

            rowBox.append(icon);
            rowBox.append(textBox);
            rowBox.append(toggleButton);
            row.set_child(rowBox);
            resultsListBox.append(row);
        }
    };

    searchEntry.connect('search-changed', renderAppRows);
    renderAppRows();

    controlsBox.append(searchEntry);
    controlsBox.append(summaryLabel);
    controlsBox.append(helperLabel);
    controlsBox.append(scrolledWindow);

    grid.attach(controlsBox, 0, rowIdx, 2, 1);

    return {
        getSelectedApps: () => [...selectedApps.values()],
    };
}
