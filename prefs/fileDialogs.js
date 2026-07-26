/**
 * ============================================================================
 * PREFERENCES: FILE DIALOGS
 * 
 * GTK FileDialog helpers for selecting image files and folders.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

/**
 * Helper to open GTK FileDialog for selecting image files.
 */
export function openImageFileDialog(parentWindow, title, callback) {
    const fileDialog = new Gtk.FileDialog({ title });
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
                const path = file.get_path() || (file.get_uri() ? file.get_uri().replace(/^file:\/\//, '') : '');
                callback(path);
            }
        } catch (e) {
            console.debug('Image selection cancelled:', e.message);
        }
    });
}

/**
 * Helper to open GTK FileDialog for selecting folders.
 */
export function openFolderFileDialog(parentWindow, title, callback) {
    const fileDialog = new Gtk.FileDialog({ title });
    fileDialog.select_folder(parentWindow, null, (dialog, result) => {
        try {
            const folder = dialog.select_folder_finish(result);
            if (folder) {
                callback(folder.get_path());
            }
        } catch (e) {
            console.debug('Folder selection cancelled:', e.message);
        }
    });
}
