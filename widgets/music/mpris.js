import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DBUS_POLL_INTERVAL_MS = 1000;

// A player that stops answering must not wedge the poller forever: every call
// carries a deadline so a hung session fails the fetch instead of pinning it.
const DBUS_CALL_TIMEOUT_MS = 2000;

const BROWSER_MPRIS_PATTERNS = ['chromium', 'firefox', 'chrome', 'brave', 'edge', 'opera', 'vivaldi', 'mozilla'];

// Some call sites hold a GLib.Variant and others the plain value, so unwrap only
// when there is actually a variant to unwrap.
export function unpackVariantValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value.deep_unpack === 'function') return value.deep_unpack();
    return value;
}

function isBrowserPlayer(playerName) {
    const lower = playerName.toLowerCase();
    return BROWSER_MPRIS_PATTERNS.some(browserPattern => lower.includes(browserPattern));
}

// Browsers append a volatile ".instanceNNN" suffix to their MPRIS bus name, so it
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

export async function getActiveMediaPlayer(config = {}, preferredPlayer = '', cancellable = null) {
    try {
        const response = await Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null, null,
            Gio.DBusCallFlags.NONE, DBUS_CALL_TIMEOUT_MS, cancellable
        );
        if (cancellable !== null && cancellable.is_cancelled()) return null;
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

        // Right after a control press the player is mid-transition and its state is
        // unreliable, so the last action target is honoured unconditionally for a
        // short window instead of re-deciding where the command goes.
        if (preferredPlayer && mediaPlayers.includes(preferredPlayer) && isWithinActionLockWindow()) {
            return preferredPlayer;
        }

        // Stays on the player being followed, so a short-lived "Playing" session
        // elsewhere (e.g. a YouTube hover preview) cannot take over the track.
        if (preferredPlayer && mediaPlayers.includes(preferredPlayer)) {
            const preferredProperties = await fetchPlayerProperties(preferredPlayer, cancellable);
            const preferredStatus = unpackVariantValue(preferredProperties?.['PlaybackStatus']);
            if (preferredStatus === 'Playing')
                return preferredPlayer;
        }

        const candidates = [];
        for (const player of mediaPlayers) {
            if (cancellable !== null && cancellable.is_cancelled()) return null;
            const properties = await fetchPlayerProperties(player, cancellable);
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

        // A browser exposes several instances of itself while handing media between
        // them; they are one logical app, so collapse onto the best before ranking.
        const strongestPerApp = new Map();
        for (const candidate of candidates) {
            const appKey = normalizePlayerBusName(candidate.player);
            const incumbent = strongestPerApp.get(appKey);
            if (!incumbent || candidate.score > incumbent.score)
                strongestPerApp.set(appKey, candidate);
        }

        const ranked = [...strongestPerApp.values()].sort((a, b) => b.score - a.score);

        // A title-less session still beats a null player: null makes the widget call
        // resetWidgetState(), throwing away the current track position over one
        // blank frame.
        return ranked[0].player;
    } catch (_error) {
        return null;
    }
}

export async function fetchPlayerProperties(playerName, cancellable = null) {
    try {
        const response = await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']),
            null,
            Gio.DBusCallFlags.NONE, DBUS_CALL_TIMEOUT_MS, cancellable
        );
        return response.deep_unpack()[0];
    } catch (_error) {
        return null;
    }
}

export async function fetchPlayerPosition(playerName, cancellable = null) {
    if (!playerName) return null;
    try {
        const response = await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null,
            Gio.DBusCallFlags.NONE, DBUS_CALL_TIMEOUT_MS, cancellable
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

async function callPlayerMethod(playerName, method) {
    if (!playerName) return;
    try {
        await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            method,
            null, null,
            Gio.DBusCallFlags.NONE, DBUS_CALL_TIMEOUT_MS, null
        );
    } catch (error) {
        // A player that does not implement a control (Firefox has no Next)
        // answers "not available now"; that is a normal reply, not a fault.
        console.debug(`Gridgets: ${method} unavailable on ${playerName}:`, error.message);
    }
}

// A cached bus name can stop having an owner, so re-resolve before issuing a
// command.
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

export async function resolveBusOwner(playerName, cancellable = null) {
    try {
        const reply = await Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'GetNameOwner',
            new GLib.Variant('(s)', [playerName]),
            null,
            Gio.DBusCallFlags.NONE, DBUS_CALL_TIMEOUT_MS, cancellable
        );
        return reply.deep_unpack()[0];
    } catch (_error) {
        return null;
    }
}
