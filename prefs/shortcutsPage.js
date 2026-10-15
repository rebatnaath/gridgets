import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';

/**
 * Rebinding for the three desktop-icon shortcuts.
 *
 * GNOME gives a registered shortcut to the extension for as long as it is registered, so
 * these are held only while a desktop icon here is selected. With none selected they are
 * released and the file manager and text fields get Ctrl+X, Ctrl+C and F2 back.
 *
 * The rows are built from ActionRow and Button rather than Adw.ShortcutRow, which is
 * libadwaita 1.8 and absent on the GNOME 45 and 46 releases this extension supports.
 */
const DESKTOP_ICON_SHORTCUTS = [
    {
        key: 'rename-selected-icon',
        title: 'Rename Icon',
        subtitle: 'Opens the rename box on the selected desktop icon.',
    },
    {
        key: 'cut-selected-icon',
        title: 'Cut Icon',
        subtitle: 'Puts the selected desktop icon on the clipboard as a cut.',
    },
    {
        key: 'copy-selected-icon',
        title: 'Copy Icon',
        subtitle: 'Puts the selected desktop icon on the clipboard as a copy.',
    },
];

const UNBOUND_LABEL = 'Disabled';

function createShortcutRow(settings, { key, title, subtitle }) {
    const button = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(button);
    row.set_activatable_widget(button);

    const refresh = () => {
        const accelerators = settings.get_strv(key);
        button.label = accelerators.length > 0 ? accelerators[0] : UNBOUND_LABEL;
        button.tooltip_text = accelerators.length > 0
            ? accelerators[0]
            : 'Click, then press a key. Escape cancels, Backspace clears.';
    };
    refresh();

    const changedId = settings.connect(`changed::${key}`, refresh);
    row.connect('destroy', () => settings.disconnect(changedId));

    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        // Num Lock and Caps Lock report as modifiers but are never part of an
        // accelerator, so they are dropped before the name is built.
        const mask = (state & Gtk.accelerator_get_default_mod_mask()) & ~Gdk.ModifierType.LOCK_MASK;

        if (keyval === Gdk.KEY_Escape && mask === 0) {
            refresh();
            return Gdk.EVENT_STOP;
        }
        if ((keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) && mask === 0) {
            settings.set_strv(key, []);
            return Gdk.EVENT_STOP;
        }
        if (!Gtk.accelerator_valid(keyval, mask))
            return Gdk.EVENT_PROPAGATE;

        settings.set_strv(key, [Gtk.accelerator_name(keyval, mask)]);
        return Gdk.EVENT_STOP;
    });
    button.add_controller(controller);

    return row;
}

export function buildShortcutsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Shortcuts',
        icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
    });

    const group = new Adw.PreferencesGroup({
        title: 'Desktop Icons',
        description: 'These are only active while a desktop icon is selected. With nothing selected, GNOME '
            + 'keeps these keys for other windows.',
    });
    for (const shortcut of DESKTOP_ICON_SHORTCUTS)
        group.add(createShortcutRow(settings, shortcut));
    page.add(group);

    return page;
}
