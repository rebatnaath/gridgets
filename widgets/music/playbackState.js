import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { PLAY_ICON, PAUSE_ICON } from './icons.js';
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

const RECENT_SEEK_WINDOW_MICROSECONDS = 1500000;
const SPURIOUS_ZERO_THRESHOLD_MICROSECONDS = 3000000;
const POSITION_JUMP_RESYNC_THRESHOLD_MICROSECONDS = 3000000;

let seekedSignalId = 0;
const activeMusicWidgetInstances = new Set();

/** Clears all tracked instances; called from the extension's disable(). */
export function clearMusicPlaybackState() {
    activeMusicWidgetInstances.clear();
    if (seekedSignalId) {
        global.display.disconnect(seekedSignalId);
        seekedSignalId = 0;
    }
}

export const MICROSECONDS_PER_SECOND = 1000000;

export function formatMicroseconds(microseconds) {
    if (!microseconds || microseconds < 0) return '00:00';
    const totalSeconds = Math.floor(microseconds / MICROSECONDS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function updateTimerLabel(state) {
    if (state.timerLabelLeft && state.timerLabelRight) {
        const pos = state.currentPositionMicro || 0;
        const len = state.trackLengthMicro || 0;
        state.timerLabelLeft.set_text(formatMicroseconds(pos));
        state.timerLabelRight.set_text(formatMicroseconds(len));
    }
    if (state.progressFill && state.progressBg) {
        const pos = state.currentPositionMicro || 0;
        const len = state.trackLengthMicro || 0;
        const ratio = len > 0 ? Math.min(1, pos / len) : 0;
        const bgWidth = state.progressBg.get_width();
        if (bgWidth > 0) state._lastProgressBgWidth = bgWidth;
        const width = state._lastProgressBgWidth || 0;
        const fillWidth = Math.floor(width * ratio);
        state.progressFill.set_width(fillWidth);
        state._lastFillWidth = fillWidth;
    }
}

export function resetWidgetState(state) {
    state.artworkCss = null;
    state.backgroundLayer.style = resolveArtworkLayerStyle(state);
    if (state.playPauseIcon) state.playPauseIcon.set_icon_name(PLAY_ICON);
    state.currentPositionMicro = 0;
    state.trackLengthMicro = 0;
    state.playbackStatus = 'Stopped';
    updateTimerLabel(state);
    if (state.titleLabel) state.titleLabel.set_text('Not Playing');
    if (state.artistLabel) state.artistLabel.set_text('Unknown Artist');
    if (state.albumLabel) state.albumLabel.hide();
    setAlbumColor(state, null);
    state.lastArtUrl = null;
    state.lastAppliedArtPath = null;
    state.lastAppliedArtStyleSignature = null;
}

export function applyPlayerState(properties, state) {
    const playbackStatus = unpackVariantValue(properties['PlaybackStatus']) || 'Stopped';
    const isPlaying = playbackStatus === 'Playing';
    state.playbackStatus = playbackStatus;
    if (state.playPauseIcon) state.playPauseIcon.set_icon_name(isPlaying ? PAUSE_ICON : PLAY_ICON);

    const track = extractTrackMetadata(properties);

    const isNewTrack = state.lastTrackTitle !== track.title;

    if (isNewTrack) {
        state.lastTrackTitle = track.title;
        state.currentPositionMicro = 0;
    }

    state.trackId = track.trackId;
    if (track.lengthMicro > 0) {
        state.trackLengthMicro = track.lengthMicro;
    } else if (isNewTrack) {
        state.trackLengthMicro = 0;
    }
    if (track.artUrl) {
        state.lastArtUrl = track.artUrl;
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

    applyArtworkToBackground(state.backgroundLayer, state.lastArtUrl || track.artUrl, state.config, state);
}

export function fetchMusicDataForConfig(config, callback) {
    (async () => {
        const activePlayer = await getActiveMediaPlayer(config);
        if (activePlayer) {
            const properties = await fetchPlayerProperties(activePlayer);
            if (properties) {
                const livePosition = await fetchPlayerPosition(activePlayer);
                if (livePosition !== null && livePosition !== undefined) {
                    properties['Position'] = new GLib.Variant('x', livePosition);
                }
                callback({ activePlayer, properties });
                return;
            }
        }
        callback({ activePlayer: null, properties: null });
    })();
}

function isSeekSenderMatch(state, senderUniqueName) {
    if (!state.container || isActorDestroyed(state.container)) return false;
    if (!state.currentPlayer) return false;
    if (state.currentPlayer === senderUniqueName) return true;
    return resolveBusOwner(state.currentPlayer).then(owner => owner !== null && owner === senderUniqueName);
}

// Shared across all instances to avoid duplicate D-Bus subscriptions.
export function setupDbusSignalListeners() {
    if (seekedSignalId === 0) {
        seekedSignalId = Gio.DBus.session.signal_subscribe(
            null,
            'org.mpris.MediaPlayer2.Player',
            'Seeked',
            null, null,
            Gio.DBusSignalFlags.NONE,
            (_connection, senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                const unpacked = parameters.deep_unpack();
                let rawPos = unpacked[0];
                if (typeof rawPos === 'number' || typeof rawPos === 'bigint') {
                    const pos = Number(rawPos);
                    const now = GLib.get_monotonic_time();
                    for (const state of activeMusicWidgetInstances) {
                        isSeekSenderMatch(state, senderName).then(isBoundToSender => {
                            if (!isBoundToSender) return;
                            state.currentPositionMicro = pos;
                            state.lastSeekTimestamp = now;
                            updateTimerLabel(state);
                        });
                    }
                }
            }
        );
    }
}

// Adds the widget to the global set so D-Bus Seeked signals reach it.
export function registerMusicWidgetInstance(state) {
    activeMusicWidgetInstances.add(state);
    setupDbusSignalListeners();
}

// Removes the widget from the global set and cleans up D-Bus listener when empty.
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
