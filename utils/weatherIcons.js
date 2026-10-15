import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// The weather icon lookup, shared so every widget that shows a sun or a moon resolves it the
// same way. The colour icons are not in the symbolic theme the desktop ships, so they are
// found beside gnome-weather and loaded from disk; the themed chain is the fallback for a
// machine without it.

let cachedGnomeWeatherIconDirectory = null;

function getGnomeWeatherIconDirectory() {
    // Resolving this walks up to eight symlinks and stats a directory, and it is asked
    // for once per icon on every refresh, so the answer is kept for the session.
    if (cachedGnomeWeatherIconDirectory !== null)
        return cachedGnomeWeatherIconDirectory;

    const executablePath = GLib.find_program_in_path('gnome-weather');
    if (!executablePath) {
        cachedGnomeWeatherIconDirectory = '';
        return cachedGnomeWeatherIconDirectory;
    }

    let resolvedPath = executablePath;
    for (let depth = 0; depth < 8; depth++) {
        const file = Gio.File.new_for_path(resolvedPath);
        const fileInfo = file.query_info(
            'standard::type,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
        if (fileInfo.get_file_type() !== Gio.FileType.SYMBOLIC_LINK)
            break;

        const target = fileInfo.get_symlink_target();
        resolvedPath = GLib.path_is_absolute(target)
            ? target
            : GLib.build_filenamev([GLib.path_get_dirname(resolvedPath), target]);
        resolvedPath = GLib.canonicalize_filename(resolvedPath, null);
    }

    const installationDirectory = GLib.path_get_dirname(GLib.path_get_dirname(resolvedPath));
    cachedGnomeWeatherIconDirectory = `${installationDirectory}/share/icons/hicolor/scalable/status`;
    return cachedGnomeWeatherIconDirectory;
}

/** Points an St.Icon at the weather icon for `iconName`, largest variant first. */
export function setWeatherIcon(iconActor, iconName) {
    const baseName = String(iconName || 'weather-clear')
        .replace(/-symbolic$/, '')
        .replace(/-(small|large)$/, '');
    const iconNames = [
        `${baseName}-large`,
        `${baseName}-small`,
        baseName,
        `${baseName}-symbolic`,
    ];
    const iconDirectory = getGnomeWeatherIconDirectory();
    if (iconDirectory) {
        for (const themedName of iconNames) {
            const themedPath = GLib.build_filenamev([iconDirectory, `${themedName}.svg`]);
            if (GLib.file_test(themedPath, GLib.FileTest.EXISTS)) {
                iconActor.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(themedPath) });
                return;
            }
        }
    }

    // Gio.ThemedIcon.new() takes a single string in this GJS, not an array, so a
    // fallback chain has to be built by appending. Passing the array instead throws
    // "Expected type string for argument 'iconname' but got type Array", which on any
    // machine without gnome-weather installed would abandon the whole UI update.
    const themedIcon = new Gio.ThemedIcon();
    for (const themedName of iconNames)
        themedIcon.append_name(themedName);
    iconActor.gicon = themedIcon;
}