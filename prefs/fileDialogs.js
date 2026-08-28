import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function openImageFileDialog(parentWindow, callback) {
    const fileDialog = new Gtk.FileDialog({ title: 'Select Image' });
    const filter = new Gtk.FileFilter();
    filter.set_name('Images');
    filter.add_mime_type('image/png');
    filter.add_mime_type('image/jpeg');
    filter.add_mime_type('image/gif');
    filter.add_mime_type('image/webp');
    filter.add_mime_type('image/svg+xml');
    filter.add_pattern('*.png');
    filter.add_pattern('*.jpg');
    filter.add_pattern('*.jpeg');
    filter.add_pattern('*.gif');
    filter.add_pattern('*.webp');
    filter.add_pattern('*.svg');

    const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filters.append(filter);
    fileDialog.set_filters(filters);

    fileDialog.open(parentWindow, null, (dialog, result) => {
        try {
            const file = dialog.open_finish(result);
            if (file) {
                let path = file.get_path();
                if (!path && file.get_uri())
                    path = GLib.filename_from_uri(file.get_uri())[0];
                callback(path);
            }
        } catch (error) {
            if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                console.error('Image file dialog failed:', error);
        }
    });
}

export function openFolderFileDialog(parentWindow, callback) {
    const fileDialog = new Gtk.FileDialog({ title: 'Select Folder' });
    fileDialog.select_folder(parentWindow, null, (dialog, result) => {
        try {
            const folder = dialog.select_folder_finish(result);
            if (folder) {
                callback(folder.get_path());
            }
        } catch (error) {
            if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                console.error('Folder file dialog failed:', error);
        }
    });
}
