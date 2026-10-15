import Gio from 'gi://Gio';

export const SHOW_APP_LAUNCHERS_KEY = 'show-app-launchers';
export const APP_LAUNCHERS_KEY = 'app-launchers';

function toLauncher(info) {
    return {
        id: info.get_id(),
        name: info.get_display_name() || info.get_name(),
        file: Gio.File.new_for_path(info.get_filename()),
        info,
    };
}

export function listInstallableLaunchers() {
    const launchers = [];
    for (const info of Gio.AppInfo.get_all()) {
        if (!info.get_id() || !info.should_show())
            continue;
        launchers.push(toLauncher(info));
    }
    return launchers.sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedLaunchers(settings) {
    const chosen = new Set(settings.get_strv(APP_LAUNCHERS_KEY));
    if (chosen.size === 0 || !settings.get_boolean(SHOW_APP_LAUNCHERS_KEY))
        return [];

    const launchers = [];
    for (const info of Gio.AppInfo.get_all()) {
        const id = info.get_id();
        if (!id || !chosen.has(id))
            continue;
        launchers.push(toLauncher(info));
    }
    return launchers;
}

// Takes the desktop ID rather than a path, which is the same string in every applications
// directory, so no search or settings are needed. Null when nothing resolves it.
export function launcherFile(id) {
    const info = Gio.DesktopAppInfo.new(id);
    if (!info || !info.get_filename())
        return null;
    return Gio.File.new_for_path(info.get_filename());
}
