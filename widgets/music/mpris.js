import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DBUS_POLL_INTERVAL_MS = 1000;

const BROWSER_MPRIS_PATTERNS = ['chromium', 'firefox', 'chrome', 'brave', 'edge', 'opera', 'vivaldi', 'mozilla'];

// Properties fetched through GetAll arrive already deep-unpacked into plain
// JS values, so some call sites hold a GLib.Variant and others hold the plain
// value directly. Unwrap only when there is actually a variant to unwrap.
export function unpackVariantValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value.deep_unpack === 'function') return value.deep_unpack();
    return value;
}

function isBrowserPlayer(playerName) {
    const lower = playerName.toLowerCase();
    return BROWSER_MPRIS_PATTERNS.some(browserPattern => lower.includes(browserPattern));
}

// Browsers append a volatile ".instanceNNN" suffix to their MPRIS bus name and
// re-acquire a new one whenever the active media session changes, so the suffix
// cannot be used as a stable application identity.
function normalizePlayerBusName(busName) {
    const instanceMarker = '.instance';
    const markerIndex = busName.indexOf(instanceMarker);
    return markerIndex === -1 ? busName : busName.slice(0, markerIndex);
}

// Ranking weights: a playing track always outranks a paused one, and a session
// without a title is never a useful thing to display.
const PLAYING_WITH_TITLE_SCORE = 500;
const PAUSED_WITH_TITLE_SCORE = 100;
const NO_TITLE_SCORE = 0;

// A player is mid-transition for a moment after a control press, so the target
// of that press is held for this long regardless of what the state becomes.
const ACTION_LOCK_DURATION_MS = 3000;
let lastActionEpochMs = 0;

function isWithinActionLockWindow() {
    return Date.now() - lastActionEpochMs < ACTION_LOCK_DURATION_MS;
}

export async function getActiveMediaPlayer(config = {}, preferredPlayer = '') {
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

        // Right after a control press the player is mid-transition, so state
        // changes are unreliable. Honour the last action target unconditionally
        // for a short window instead of re-deciding where the command should go.
        if (preferredPlayer && mediaPlayers.includes(preferredPlayer) && isWithinActionLockWindow()) {
            return preferredPlayer;
        }

        // Stays on the player already being followed so a short-lived
        // "Playing" session elsewhere (e.g. a YouTube hover preview) cannot
        // take over the track currently playing.
        if (preferredPlayer && mediaPlayers.includes(preferredPlayer)) {
            const preferredProperties = await fetchPlayerProperties(preferredPlayer);
            const preferredStatus = unpackVariantValue(preferredProperties?.['PlaybackStatus']);
            if (preferredStatus === 'Playing')
                return preferredPlayer;
        }

        const candidates = [];
        for (const player of mediaPlayers) {
            const properties = await fetchPlayerProperties(player);
            const status = unpackVariantValue(properties?.['PlaybackStatus']);
            const metadata = unpackVariantValue(properties?.['Metadata']) || {};
            const hasTitle = Boolean(unpackVariantValue(metadata['xesam:title']));

            let score = NO_TITLE_SCORE;
            if (hasTitle && status === 'Playing')
                score = PLAYING_WITH_TITLE_SCORE;
            else if (hasTitle && status === 'Paused')
                score = PAUSED_WITH_TITLE_SCORE;

            candidates.push({ player, score });
        }

        // A browser can expose several instances of itself at once while it
        // hands media over between them. They are one logical app, so collapse
        // them onto the strongest-scoring instance before ranking.
        const strongestPerApp = new Map();
        for (const candidate of candidates) {
            const appKey = normalizePlayerBusName(candidate.player);
            const incumbent = strongestPerApp.get(appKey);
            if (!incumbent || candidate.score > incumbent.score)
                strongestPerApp.set(appKey, candidate);
        }

        const ranked = [...strongestPerApp.values()].sort((a, b) => b.score - a.score);

        // A session that momentarily reports no title still beats a null
        // player: null makes the widget call resetWidgetState(), which throws
        // away the current track position. A title-less session is more useful
        // than dropping playback state over one blank frame.
        return ranked[0].player;
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
        // A player that does not implement a control (Firefox has no Next)
        // answers "not available now"; that is a normal reply, not a fault.
        console.debug(`Gridgets: ${method} unavailable on ${playerName}:`, error.message);
    }
}

// Chrome releases and re-acquires its MPRIS bus name whenever the active media
// session changes (for example when a YouTube hover preview starts), so a
// cached name can stop having an owner. Re-resolve before issuing a command.
async function resolveLivePlayer(config, state) {
    const cachedPlayer = state.currentPlayer;
    if (cachedPlayer && await resolveBusOwner(cachedPlayer))
        return cachedPlayer;

    const livePlayer = await getActiveMediaPlayer(config, '');
    if (livePlayer)
        state.currentPlayer = livePlayer;
    return livePlayer;
}

async function callPlayerControl(config, state, method) {
    const player = await resolveLivePlayer(config, state);
    if (!player) return;

    lastActionEpochMs = Date.now();
    return callPlayerMethod(player, method);
}

export function togglePlayPause(config, state) {
    return callPlayerControl(config, state, 'PlayPause');
}

export function skipToNext(config, state) {
    return callPlayerControl(config, state, 'Next');
}

export function skipToPrevious(config, state) {
    return callPlayerControl(config, state, 'Previous');
}

export function extractTrackMetadata(properties) {
    const rawMeta = properties['Metadata'];
    const metadata = unpackVariantValue(rawMeta) || {};

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
