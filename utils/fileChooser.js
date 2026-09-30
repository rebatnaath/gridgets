import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
const PORTAL_TIMEOUT_MS = 600000;
const RESPONSE_OK = 0;

const IMAGE_FILE_TYPES = 'Images (*.png, *.jpg, *.jpeg, *.gif, *.webp, *.svg)';

/**
 * Opens a chooser through the XDG desktop portal and calls back with the chosen path.
 *
 * The portal is the only option here: the shell process must not import Gtk. `callback`
 * receives null on dismiss or when no backend answers, so callers treat it as "no change".
 *
 * No file filter is sent, since a portal filter is a Gtk.FileFilter handle. The accepted
 * extensions go in the title instead.
 */
export function openPortalFileChooser({ title, chooseFolder = false }, callback) {
    const chooserTitle = `${title} — ${chooseFolder ? 'Folders' : IMAGE_FILE_TYPES}`;

    // A folder is chosen through OpenFile with directory:true; the interface has no
    // OpenFolder method.
    const options = {};
    if (chooseFolder) {
        const dict = new GLib.VariantDict(new GLib.Variant('a{sv}', {}));
        dict.insert_value('directory', GLib.Variant.new_boolean(true));
        Object.assign(options, dict.end().deepUnpack());
    }

    // (s parent_window, s title, a{sv} options). The empty parent makes the backend log an
    // unhandled parent window and then open unparented; there is no handle to pass.
    Gio.DBus.session.call(
        PORTAL_BUS_NAME,
        PORTAL_OBJECT_PATH,
        'org.freedesktop.portal.FileChooser',
        'OpenFile',
        new GLib.Variant('(ssa{sv})', ['', chooserTitle, options]),
        new GLib.VariantType('(o)'),
        Gio.DBusCallFlags.NONE,
        PORTAL_TIMEOUT_MS,
        null,
        (source, result) => {
            let requestPath;
            try {
                requestPath = source.call_finish(result).deep_unpack()[0];
            } catch (error) {
                // No portal backend, or the call was refused: nothing to pick from.
                console.error('Failed to open the file chooser:', error.message);
                callback(null);
                return;
            }
            watchPortalResponse(requestPath, callback);
        }
    );
}

/** The chooser answers on the Request signal rather than the method reply. */
function watchPortalResponse(requestPath, callback) {
    const subscription = Gio.DBus.session.signal_subscribe(
        PORTAL_BUS_NAME,
        'org.freedesktop.portal.Request',
        // Null member: the signal is emitted on the request path, not the desktop one,
        // so filtering by path would never match. The path is checked below instead.
        null,
        null,
        null,
        Gio.DBusSignalFlags.NONE,
        (_connection, _senderName, path, _interfaceName, _signalName, parameters) => {
            if (path !== requestPath)
                return;
            Gio.DBus.session.signal_unsubscribe(subscription);
            const [responseCode, results] = parameters.deepUnpack();
            if (responseCode !== RESPONSE_OK) {
                callback(null);
                return;
            }
            // deepUnpack leaves each a{sv} value wrapped, so uris is a Variant<as> here and
            // has to be unpacked before it can be indexed.
            const uris = results.uris.deepUnpack();
            if (!uris || uris.length === 0) {
                callback(null);
                return;
            }
            callback(portalUriToPath(uris[0]));
        }
    );
}

/** The portal answers with a URI; the widget configs store plain paths. */
function portalUriToPath(uri) {
    try {
        return Gio.File.new_for_uri(uri).get_path();
    } catch {
        return null;
    }
}
