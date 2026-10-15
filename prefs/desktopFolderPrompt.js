import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

/**
 * Asks for the desktop folder to be made when it is missing.
 *
 * The grid cannot make it on its own: creating a folder is a Gtk operation and the grid
 * runs in the shell process, which has no Gtk. Left alone, a machine with no desktop
 * folder shows an empty grid with nothing on screen to say why, so the question is asked
 * here instead, where a window can be shown.
 *
 * Nothing is written when the answer is Cancel, and a folder that is already there is
 * never touched. The grid picks the new folder up on its next sync, which the switch
 * turning on has already asked for.
 */
export function offerToCreateDesktopFolder(settings, parentWindow) {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP)
        || `${GLib.get_home_dir()}/Desktop`;
    const directory = Gio.File.new_for_path(path);

    let queryError = null;
    if (directory.query_exists(null))
        return null;

    const dialog = new Adw.MessageDialog({
        transient_for: parentWindow,
        modal: true,
        heading: 'Create a Desktop Folder?',
        body: `Gridgets keeps its desktop icons in your desktop folder, and there is not one yet.\n\nIt will be created at ${path}`,
    });

    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('create', 'Create', 'suggested-action');
    dialog.set_default_response('create');
    dialog.set_close_response('cancel');

    dialog.connect('response', (_dialog, response) => {
        // Declining leaves nothing for the switch to draw, so it goes back off rather than
        // sitting there promising icons that the grid will never have.
        if (response !== 'create') {
            settings.set_boolean('show-desktop-icons', false);
            return;
        }

        try {
            directory.make_directory_with_parents(null);
        } catch (error) {
            console.error(`Gridgets: could not create ${path}:`, error);
            settings.set_boolean('show-desktop-icons', false);
            return;
        }

        // The grid read the folder when the switch changed, which it already did while
        // this dialog was open, so ask for another sync now that the folder is there.
        settings.set_boolean('show-desktop-icons', false);
        settings.set_boolean('show-desktop-icons', true);
    });

    return dialog;
}