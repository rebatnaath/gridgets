import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { showPropertiesDialog } from './propertiesDialog.js';

const FILE_MANAGER_BUS_NAME = 'org.freedesktop.FileManager1';
const FILE_MANAGER_OBJECT_PATH = '/org/freedesktop/FileManager1';

// Long enough for a file manager to start, short enough not to stall the fallback.
const PROPERTIES_TIMEOUT_MS = 4000;

/**
 * Asks the file manager to show the properties of `file`.
 *
 * The call is asynchronous and guarded by a timeout: it runs in the shell process, so a
 * file manager that takes its time or never answers must not hold the desktop up.
 */
function requestPropertiesFromFileManager(file, onUnavailable) {
    const cancellable = new Gio.Cancellable();
    let settled = false;
    let timeoutId = 0;

    const finish = opened => {
        if (settled)
            return;
        settled = true;
        if (timeoutId) {
            GLib.Source.remove(timeoutId);
            timeoutId = 0;
        }
        if (!opened)
            onUnavailable();
    };

    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROPERTIES_TIMEOUT_MS, () => {
        timeoutId = 0;
        cancellable.cancel();
        finish(false);
        return GLib.SOURCE_REMOVE;
    });

    // new_tuple, not new GLib.Variant('(asas)', ...): the string form rejects a nested JS
    // array on this GLib, the tuple form takes it.
    const uriArray = GLib.Variant.new_array(
        GLib.VariantType.new('s'), [GLib.Variant.new_string(file.get_uri())]);
    // The caller's startup id, used to raise its window.
    const parameters = GLib.Variant.new_tuple([uriArray, GLib.Variant.new_string('')]);

    Gio.DBus.session.call(
        FILE_MANAGER_BUS_NAME,
        FILE_MANAGER_OBJECT_PATH,
        FILE_MANAGER_BUS_NAME,
        'ShowItemProperties',
        parameters,
        null,
        Gio.DBusCallFlags.NONE,
        PROPERTIES_TIMEOUT_MS,
        cancellable,
        (_connection, result) => {
            try {
                Gio.DBus.session.call_finish(result);
                finish(true);
            } catch (error) {
                // No file manager on the bus, or none that implements the interface.
                console.error(`Gridgets: no file manager answered for ${file.get_uri()}:`, error);
                finish(false);
            }
        });
}

/** Shows the properties of a desktop entry, in the file manager or in this extension. */
export function showFileProperties(file) {
    requestPropertiesFromFileManager(file, () => showPropertiesDialog(file));
}