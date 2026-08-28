import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DBUS_POLL_INTERVAL_MS = 1000;

const BROWSER_MPRIS_PATTERNS = ['chromium', 'firefox', 'chrome', 'brave', 'edge', 'opera', 'vivaldi', 'mozilla'];

// Unwraps a GVariant to a plain JS value. Uses deep_unpack() rather than
// unpack() because array-typed variants (e.g. xesam:artist as "as") only
// yield plain strings when fully unwrapped.
export function unpackVariantValue(value) {
    return value ? value.deep_unpack() : value;
}

export function isBrowserPlayer(playerName) {
    const lower = playerName.toLowerCase();
    return BROWSER_MPRIS_PATTERNS.some(b => lower.includes(b));
}

export async function getActiveMediaPlayer(config = {}) {
    try {
        const response = await Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null, null,
            Gio.DBusCallFlags.NONE, -1, null
        );
        const busNames = response.deep_unpack()[0];
        let mediaPlayers = busNames.filter(name => name.startsWith('org.mpris.MediaPlayer2.'));

        const shouldIgnoreBrowsers = config.ignoreBrowsers !== false;
        if (shouldIgnoreBrowsers) {
            const nonBrowserPlayers = mediaPlayers.filter(name => !isBrowserPlayer(name));
            if (nonBrowserPlayers.length > 0) {
                mediaPlayers = nonBrowserPlayers;
            }
        }

        if (config.playerFilter && config.playerFilter.trim() !== '') {
            const filterPattern = config.playerFilter.trim().toLowerCase();
            const matchingPlayers = mediaPlayers.filter(name => name.toLowerCase().includes(filterPattern));
            if (matchingPlayers.length > 0) {
                mediaPlayers = matchingPlayers;
            }
        }

        if (mediaPlayers.length === 0) return null;
        if (mediaPlayers.length === 1) return mediaPlayers[0];

        for (const player of mediaPlayers) {
            const props = await fetchPlayerProperties(player);
            const status = unpackVariantValue(props?.['PlaybackStatus']);
            if (status === 'Playing') return player;
        }

        return mediaPlayers[0];
    } catch (_error) {
        return null;
    }
}

export async function fetchPlayerProperties(playerName) {
    try {
        const response = await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']),
            null,
            Gio.DBusCallFlags.NONE, -1, null
        );
        return response.deep_unpack()[0];
    } catch (_error) {
        return null;
    }
}

export async function fetchPlayerPosition(playerName) {
    if (!playerName) return null;
    try {
        const response = await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null,
            Gio.DBusCallFlags.NONE, -1, null
        );
        const rawVariant = response.deep_unpack()[0];
        if (rawVariant !== undefined && rawVariant !== null) {
            const pos = Number(rawVariant.unpack());
            if (!isNaN(pos) && pos >= 0) return pos;
        }
        return null;
    } catch (_error) {
        return null;
    }
}

// Sends a D-Bus method call to the MPRIS Player interface.
async function callPlayerMethod(playerName, method) {
    if (!playerName) return;
    try {
        await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            method,
            null, null,
            Gio.DBusCallFlags.NONE, -1, null
        );
    } catch (error) {
        console.error(`Error executing ${method} on player ${playerName}:`, error);
    }
}

export function togglePlayPause(playerName) {
    return callPlayerMethod(playerName, 'PlayPause');
}

export function skipToNext(playerName) {
    return callPlayerMethod(playerName, 'Next');
}

export function skipToPrevious(playerName) {
    return callPlayerMethod(playerName, 'Previous');
}

export function extractTrackMetadata(properties) {
    const rawMeta = properties['Metadata'];
    const metadata = rawMeta ? rawMeta.deep_unpack() : {};

    const title = unpackVariantValue(metadata['xesam:title']) || 'Unknown Title';
    const rawArtists = unpackVariantValue(metadata['xesam:artist']) || [];
    const artistArray = Array.isArray(rawArtists) ? rawArtists : [rawArtists];
    const artist = artistArray.filter(Boolean).join(', ') || 'Unknown Artist';
    const album = unpackVariantValue(metadata['xesam:album']) || '';
    const artUrl = unpackVariantValue(metadata['mpris:artUrl']) || '';
    const lengthMicro = Number(unpackVariantValue(metadata['mpris:length'])) || 0;
    const trackId = unpackVariantValue(metadata['mpris:trackid']) || '/org/mpris/MediaPlayer2/TrackList/NoTrack';

    return { title, artist, album, artUrl, lengthMicro, trackId };
}

export async function resolveBusOwner(playerName) {
    try {
        const reply = await Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'GetNameOwner',
            new GLib.Variant('(s)', [playerName]),
            null,
            Gio.DBusCallFlags.NONE, -1, null
        );
        return reply.deep_unpack()[0];
    } catch (_error) {
        return null;
    }
}
