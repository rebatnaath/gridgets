import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { APP_LAUNCHERS_KEY, listInstallableLaunchers } from '../desktopIcons/appLaunchers.js';

const ROW_SUBTITLE_MAX_CHARS = 60;
const ICON_SIZE_PX = 32;
const SEARCH_ICON_NAME = 'system-search-symbolic';

/**
 * Picks which application launchers the desktop grid shows.
 *
 * A window rather than a row with a summary, because the list is however many applications
 * are installed and the only way to choose from it is to see it. A search entry is there
 * because nobody scrolls a hundred rows to find Firefox, and each row carries the app's own
 * icon so the list can be read by sight rather than by name alone.
 *
 * Nothing is written until Add is pressed. Cancel and closing the window both discard, and
 * Clear all only empties the tick boxes: it is a way of selecting nothing, not a way of
 * emptying the desktop behind the window you are looking at.
 */
export function openAppLauncherChooser(settings, parentWindow) {
    const launchers = listInstallableLaunchers();
    const chosen = new Set(settings.get_strv(APP_LAUNCHERS_KEY));

    const window = new Adw.Window({
        modal: true,
        transient_for: parentWindow,
        title: 'Application Launchers',
        default_width: 540,
        default_height: 640,
    });

    const header = new Adw.HeaderBar({ show_end_title_buttons: false, show_start_title_buttons: false });
    const cancelButton = new Gtk.Button({ label: 'Cancel' });
    const addButton = new Gtk.Button({ label: 'Add' });
    addButton.add_css_class('suggested-action');
    addButton.connect('clicked', () => {
        settings.set_strv(APP_LAUNCHERS_KEY, [...chosen]);
        window.close();
    });
    cancelButton.connect('clicked', () => window.close());
    header.pack_start(cancelButton);
    header.pack_end(addButton);

    const searchEntry = new Adw.EntryRow({ title: 'Search' });

    // The pencil is a named widget inside libadwaita's own template, called edit_icon and
    // set to adw-entry-edit-symbolic. There is no property on EntryRow to change it, and
    // add_prefix would put a magnifier beside the pencil rather than in its place, so the
    // template child is fetched and its icon set directly.
    // Two arguments: GTK4's signature takes the widget type the child is defined in, then
    // the name. Passing only the name throws and takes the dialog down with it.
    const editIcon = searchEntry.get_template_child(Adw.EntryRow.$gtype, 'edit_icon');
    if (editIcon)
        editIcon.set_from_icon_name(SEARCH_ICON_NAME);
    const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');

    const checks = launchers.map(launcher => {
        const check = new Gtk.CheckButton({ active: chosen.has(launcher.id), valign: Gtk.Align.CENTER });
        check.connect('toggled', () => {
            if (check.active)
                chosen.add(launcher.id);
            else
                chosen.delete(launcher.id);
        });

        // The app's own icon, at the size the list is read at. GIcon from the entry rather
        // than a themed name, because a launcher may ship its own icon and may not have one
        // in the theme at all.
        const icon = new Gtk.Image({ pixel_size: ICON_SIZE_PX, valign: Gtk.Align.CENTER });
        icon.set_from_gicon(launcher.info.get_icon());

        const row = new Adw.ActionRow({
            title: launcher.name,
            subtitle: launcher.id.length > ROW_SUBTITLE_MAX_CHARS
                ? `${launcher.id.slice(0, ROW_SUBTITLE_MAX_CHARS)}…`
                : launcher.id,
        });
        row.add_prefix(icon);
        row.add_suffix(check);
        row.activatable_widget = check;
        return { row, check, name: launcher.name.toLowerCase(), id: launcher.id.toLowerCase() };
    });

    for (const { row } of checks)
        list.append(row);

    // Matches on either the name or the desktop id: people look for both, and an id is
    // often the shorter of the two.
    searchEntry.connect('changed', () => {
        const needle = searchEntry.get_text().trim().toLowerCase();
        for (const entry of checks)
            entry.row.visible = needle === '' || entry.name.includes(needle) || entry.id.includes(needle);
    });

    const clearRow = new Adw.ActionRow({
        title: 'Clear all',
        subtitle: 'Untick everything. Nothing is removed from the desktop until you press Add.',
    });
    const clearButton = new Gtk.Button({ label: 'Clear', valign: Gtk.Align.CENTER });
    clearButton.connect('clicked', () => {
        chosen.clear();
        for (const entry of checks)
            entry.check.set_active(false);
    });
    clearRow.add_suffix(clearButton);

    // The two things you reach for sit together at the top, and the list they act on is
    // separated below: a group boundary is what draws the separation and the space, so the
    // list does not start up against Clear all.
    const controlsGroup = new Adw.PreferencesGroup();
    controlsGroup.add(searchEntry);
    controlsGroup.add(clearRow);

    const listGroup = new Adw.PreferencesGroup({ title: 'Shown on the desktop' });
    listGroup.add(list);

    const page = new Adw.PreferencesPage();
    page.add(controlsGroup);
    page.add(listGroup);

    const view = new Adw.ToolbarView({ content: page });
    view.add_top_bar(header);
    window.set_content(view);
    window.present();
    return window;
}