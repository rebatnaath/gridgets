import GioUnix from 'gi://GioUnix';

// Resolving a .desktop id needs GDesktopAppInfo, which since GLib 2.86 lives in the
// GioUnix platform library. It is therefore kept out of modules the preferences
// process imports: this one is shell-only, and the preferences side reads the same
// details from Gio.AppInfo.get_all() instead.

/**
 * Resolves a .desktop app id to a DesktopAppInfo, or null when nothing matches.
 * A bare id such as `org.gnome.Nautilus` is tried with and without the suffix.
 */
export function resolveDesktopAppInfo(appId) {
    if (!appId || typeof appId !== 'string') return null;

    const idCandidates = appId.endsWith('.desktop') ? [appId] : [appId, `${appId}.desktop`];

    for (const candidate of idCandidates) {
        const appInfo = GioUnix.DesktopAppInfo.new(candidate);
        if (appInfo && appInfo.get_id()) return appInfo;
    }
    return null;
}
