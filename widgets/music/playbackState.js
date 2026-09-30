import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import {
    unpackVariantValue,
    extractTrackMetadata,
    resolveBusOwner,
    getActiveMediaPlayer,
    fetchPlayerProperties,
    fetchPlayerPosition,
} from './mpris.js';
import { setAlbumColor, resolveArtworkLayerStyle, applyArtworkToBackground } from './cover.js';

const PLAY_ICON = 'media-playback-start-symbolic';
const PAUSE_ICON = 'media-playback-pause-symbolic';

const RECENT_SEEK_WINDOW_MICROSECONDS = 1500000;
const SPURIOUS_ZERO_THRESHOLD_MICROSECONDS = 3000000;
const POSITION_JUMP_RESYNC_THRESHOLD_MICROSECONDS = 3000000;

// A newly reported track must stay "Playing" for this long before the widget adopts it.
// A YouTube hover preview holds a real media session for as long as the pointer rests on
// it, so switching instantly would hijack the widget. Long enough to outlast a stray
// hover, short enough not to hold up a real change: while the clock runs, nothing in the
// widget changes, so the status, the metadata and the artwork all still describe the
// previous track.
const TRACK_ADOPT_DELAY_MICROSECONDS = 1200000;

let seekedSignalId = 0;
const activeMusicWidgetInstances = new Set();

/** Clears all tracked instances; called from the extension's disable(). */
export function clearMusicPlaybackState() {
    if (seekedSignalId) {
        Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        seekedSignalId = 0;
    }
    activeMusicWidgetInstances.clear();
}

export const MICROSECONDS_PER_SECOND = 1000000;

function formatMicroseconds(microseconds) {
    if (!microseconds || microseconds < 0) return '00:00';
    const totalSeconds = Math.floor(microseconds / MICROSECONDS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function updateTimerLabel(state) {
    if (state.timerLabelLeft && state.timerLabelRight) {
        const position = state.currentPositionMicro || 0;
        const length = state.trackLengthMicro || 0;
        state.timerLabelLeft.set_text(formatMicroseconds(position));
        state.timerLabelRight.set_text(formatMicroseconds(length));
    }
    if (state.progressFill && state.progressBg) {
        const position = state.currentPositionMicro || 0;
        const length = state.trackLengthMicro || 0;
        const ratio = length > 0 ? Math.min(1, position / length) : 0;
        const bgWidth = state.progressBg.get_width();
        if (bgWidth > 0) state._lastProgressBgWidth = bgWidth;
        const width = state._lastProgressBgWidth || 0;
        const fillWidth = Math.floor(width * ratio);
        state.progressFill.set_width(fillWidth);
    }
}

export function resetWidgetState(state) {
    state.artworkCss = null;
    state.backgroundLayer.style = resolveArtworkLayerStyle(state);
    if (state.playPauseIcon) state.playPauseIcon.set_icon_name(PLAY_ICON);
    state.currentPositionMicro = 0;
    state.trackLengthMicro = 0;
    state.playbackStatus = 'Stopped';
    state.adoptedTrackKey = null;
    state.pendingTrackKey = null;
    state.pendingTrackSinceMicro = 0;
    state.lastTrackKey = null;
    updateTimerLabel(state);
    if (state.titleLabel) state.titleLabel.set_text('Not Playing');
    if (state.artistLabel) state.artistLabel.set_text('Unknown Artist');
    if (state.albumLabel) state.albumLabel.hide();
    setAlbumColor(state, null);
    state.lastArtUrl = null;
    state.resolvedArtUrl = null;
    state.resolvedArtPath = undefined;
    state.resolvedArtMisses = 0;
    state.lastAppliedArtPath = null;
    state.lastAppliedArtStyleSignature = null;
}

export function applyPlayerState(properties, state) {
    const track = extractTrackMetadata(properties);

    // Firefox reports the same mpris:trackid for a hover preview and for the video
    // actually playing, so the visible metadata has to be part of the key.
    const trackKey = `${track.trackId}|${track.title}|${track.artist}`;
    if (state.adoptedTrackKey !== null && trackKey !== state.adoptedTrackKey) {
        const nowMicro = GLib.get_monotonic_time();
        if (state.pendingTrackKey !== trackKey) {
            state.pendingTrackKey = trackKey;
            state.pendingTrackSinceMicro = nowMicro;
        }
        if (nowMicro - state.pendingTrackSinceMicro < TRACK_ADOPT_DELAY_MICROSECONDS)
            return;
        state.adoptedTrackKey = trackKey;
    } else {
        state.adoptedTrackKey = trackKey;
    }
    state.pendingTrackKey = null;

    // Below the adoption check, so the icon changes with the rest of the widget. The
    // position ticker keys off playbackStatus, and reading a "Playing" from a track whose
    // metadata is still being held advanced the old track's position for the delay.
    const playbackStatus = unpackVariantValue(properties['PlaybackStatus']) || 'Stopped';
    state.playbackStatus = playbackStatus;
    if (state.playPauseIcon) {
        state.playPauseIcon.set_icon_name(playbackStatus === 'Playing' ? PAUSE_ICON : PLAY_ICON);
    }

    // Keyed the way adoption is, not on the title: a single and its album version share
    // a title but are different recordings, and one of them would otherwise inherit the
    // other's position and length.
    const isNewTrack = state.lastTrackKey !== trackKey;

    if (isNewTrack) {
        state.lastTrackKey = trackKey;
        state.currentPositionMicro = 0;
    }

    if (track.lengthMicro > 0) {
        state.trackLengthMicro = track.lengthMicro;
    } else if (isNewTrack) {
        state.trackLengthMicro = 0;
    }
    if (track.artUrl) {
        state.lastArtUrl = track.artUrl;
    } else if (isNewTrack) {
        // Firefox advertises no art URL for several seconds after a track change, and
        // with two profiles running the widget may be following whichever one reported
        // Playing. Clearing here left the cover blank for most of a track, so the last
        // one is held until this track's own art arrives and replaces it.
        if (state.lastLoggedMissingArt !== trackKey) {
            state.lastLoggedMissingArt = trackKey;
            console.error(`Gridgets: new track "${track.title}" has no art URL yet, holding the current cover`);
        }
    }

    const positionMicro = unpackVariantValue(properties['Position']);
    const now = GLib.get_monotonic_time();
    const recentSeek = state.lastSeekTimestamp && (now - state.lastSeekTimestamp < RECENT_SEEK_WINDOW_MICROSECONDS);

    if (positionMicro !== undefined && positionMicro !== null && positionMicro >= 0) {
        const isSpuriousZero = (positionMicro === 0 && (state.currentPositionMicro || 0) > SPURIOUS_ZERO_THRESHOLD_MICROSECONDS);
        if (!isSpuriousZero) {
            const currentPos = state.currentPositionMicro || 0;
            const diff = Math.abs(positionMicro - currentPos);
            if (isNewTrack) {
                state.currentPositionMicro = positionMicro;
            } else if (recentSeek) {
                state.currentPositionMicro = positionMicro;
            } else if (diff > POSITION_JUMP_RESYNC_THRESHOLD_MICROSECONDS) {
                state.currentPositionMicro = positionMicro;
            }
        }
    }

    if (state.playbackStatus !== 'Playing' || !state.timerId) {
        updateTimerLabel(state);
    }

    if (state.titleLabel) state.titleLabel.set_text(track.title);
    if (state.artistLabel) state.artistLabel.set_text(track.artist);

    if (state.albumLabel) {
        if (track.album && track.album !== track.title) {
            state.albumLabel.set_text(track.album);
            state.albumLabel.show();
        } else {
            state.albumLabel.hide();
        }
    }

    void applyArtworkToBackground(state.backgroundLayer, state.lastArtUrl || track.artUrl, state.config, state);
}

export async function fetchMusicDataForConfig(config, callback, preferredPlayer, cancellable) {
    // Checked before every callback because a cancelled fetch and an idle player
    // both surface as "no data", and only the latter may reset the widget.
    const activePlayer = await getActiveMediaPlayer(config, preferredPlayer, cancellable);
    if (cancellable.is_cancelled()) return;
    if (activePlayer === null) {
        callback({ activePlayer: null, properties: null });
        return;
    }

    const properties = await fetchPlayerProperties(activePlayer, cancellable);
    if (cancellable.is_cancelled()) return;
    if (properties === null) {
        callback({ activePlayer: null, properties: null });
        return;
    }

    const livePosition = await fetchPlayerPosition(activePlayer, cancellable);
    if (cancellable.is_cancelled()) return;
    if (livePosition !== null && livePosition !== undefined)
        properties['Position'] = new GLib.Variant('x', livePosition);

    callback({ activePlayer, properties });
}

function isSeekSenderMatch(state, senderUniqueName) {
    if (!state.container || isActorDestroyed(state.container)) return Promise.resolve(false);
    if (!state.currentPlayer) return Promise.resolve(false);
    if (state.currentPlayer === senderUniqueName) return Promise.resolve(true);
    return resolveBusOwner(state.currentPlayer)
        .then(owner => owner !== null && owner === senderUniqueName);
}

// Shared across all instances to avoid duplicate D-Bus subscriptions.
function setupDbusSignalListeners() {
    if (seekedSignalId === 0) {
        seekedSignalId = Gio.DBus.session.signal_subscribe(
            null,
            'org.mpris.MediaPlayer2.Player',
            'Seeked',
            null, null,
            Gio.DBusSignalFlags.NONE,
            (_connection, senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                const unpacked = parameters.deep_unpack();
                let rawPosition = unpacked[0];
                if (typeof rawPosition === 'number' || typeof rawPosition === 'bigint') {
                    const position = Number(rawPosition);
                    const now = GLib.get_monotonic_time();
                    for (const state of activeMusicWidgetInstances) {
                        isSeekSenderMatch(state, senderName).then(isBoundToSender => {
                            if (!isBoundToSender) return;
                            // isSeekSenderMatch checks before awaiting the D-Bus
                            // round trip, so re-check before touching actors.
                            if (isActorDestroyed(state.container)) return;
                            state.currentPositionMicro = position;
                            state.lastSeekTimestamp = now;
                            updateTimerLabel(state);
                        });
                    }
                }
            }
        );
    }
}

export function registerMusicWidgetInstance(state) {
    activeMusicWidgetInstances.add(state);
    setupDbusSignalListeners();
}

export function unregisterMusicWidgetInstance(state) {
    activeMusicWidgetInstances.delete(state);
    if (activeMusicWidgetInstances.size === 0 && seekedSignalId !== 0) {
        Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        seekedSignalId = 0;
    }
}

export function notifyPlayPauseAllInstances(playerName) {
    for (const state of activeMusicWidgetInstances) {
        if (!playerName || !state.currentPlayer || state.currentPlayer === playerName) {
            const isPlaying = state.playbackStatus === 'Playing';
            state.playbackStatus = isPlaying ? 'Paused' : 'Playing';
            if (state.playPauseIcon) {
                state.playPauseIcon.set_icon_name(isPlaying ? PLAY_ICON : PAUSE_ICON);
            }
        }
    }
}
