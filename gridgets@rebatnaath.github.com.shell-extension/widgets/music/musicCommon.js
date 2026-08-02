import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';

/** Symbolic icon names */
export const PLAY_ICON = 'media-playback-start-symbolic';
export const PAUSE_ICON = 'media-playback-pause-symbolic';
export const SEEK_BACK_ICON = 'media-seek-backward-symbolic';
export const SEEK_FORWARD_ICON = 'media-seek-forward-symbolic';
export const FALLBACK_ICON = 'audio-x-generic-symbolic';

/** Polling and seek constants */
export const DBUS_POLL_INTERVAL_MS = 1000;
export const SEEK_OFFSET_MICROSECONDS = 5000000;
export const MICROSECONDS_PER_SECOND = 1000000;

/** Styling constants */
export const BORDER_RADIUS_PILL = 99;

/** Cache directory for downloaded remote album art */
const MUSIC_ART_CACHE_DIR = `${GLib.get_user_cache_dir()}/gridgets/music-art`;

/** Local file paths for already-downloaded remote artwork URLs */
const artworkFileCache = new Map();

/** Queues of callbacks waiting on an in-flight download for each URL */
const artworkDownloadQueue = new Map();

/** Time thresholds for MPRIS position tracking */
const RECENT_SEEK_WINDOW_MICROSECONDS = 1500000;
const SPURIOUS_ZERO_THRESHOLD_MICROSECONDS = 3000000;
const POSITION_DIFF_THRESHOLD_MICROSECONDS = 2000000;

/** Known browser MPRIS process name patterns */
const BROWSER_MPRIS_PATTERNS = ['chromium', 'firefox', 'chrome', 'brave', 'edge', 'opera', 'vivaldi', 'mozilla'];

/** Clutter mouse button constants */
const BUTTON_PRIMARY = 1;

/** Formats microseconds into MM:SS display format. */
export function formatMicroseconds(microseconds) {
    if (!microseconds || microseconds < 0) return '00:00';
    const totalSeconds = Math.floor(microseconds / MICROSECONDS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** Creates background artwork layer widget with default styling. */
export function createBackgroundLayer(config) {
    const borderRadius = config.appliedBorderRadius || 0;
    const backgroundColor = resolveWidgetBackgroundColor(config);
    return new St.Widget({
        style: `background-color: ${backgroundColor}; background-size: cover; border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
}

/** Creates a circular media control button with symbolic icon child. */
export function createIconButton(iconName, iconSize, buttonMargin, textColor) {
    const button = new St.Button({
        reactive: true,
        can_focus: true,
        style: `margin: 0px ${buttonMargin}px; border-radius: ${BORDER_RADIUS_PILL}px;`,
    });

    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        style: `color: ${textColor}; icon-shadow: 0px 4px 6px rgba(0,0,0,0.9);`,
    });

    button.set_child(icon);
    button.iconRef = icon;
    return button;
}

/** Checks if player bus name belongs to a web browser. */
export function isBrowserPlayer(playerName) {
    const lower = playerName.toLowerCase();
    return BROWSER_MPRIS_PATTERNS.some(b => lower.includes(b));
}

/** Queries D-Bus for active MPRIS media players matching configuration criteria. */
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

/**
 * Fetches MPRIS properties for target player.
 *
 * @param {string} playerName - MPRIS bus name
 * @returns {Promise<Object|null>} Properties map or null
 */
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

/**
 * Queries player for current playback position in microseconds.
 *
 * @param {string} playerName - MPRIS bus name
 * @returns {Promise<number|null>} Position in microseconds or null
 */
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
            const unpackedVal = (typeof rawVariant.unpack === 'function') ? rawVariant.unpack() : rawVariant;
            const pos = Number(unpackedVal);
            if (!isNaN(pos) && pos >= 0) return pos;
        }
        return null;
    } catch (_error) {
        return null;
    }
}

/** Toggles play/pause state for a media player. */
export async function togglePlayPause(playerName) {
    if (!playerName) return;
    try {
        await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            'PlayPause',
            null, null,
            Gio.DBusCallFlags.NONE, -1, null
        );
    } catch (error) {
        console.error(`Error executing PlayPause on player ${playerName}:`, error);
    }
}

/** Seeks forward or backward in active track by offset microseconds. */
export async function seekPlayer(playerName, offsetMicroseconds, trackId = '/org/mpris/MediaPlayer2/TrackList/NoTrack') {
    if (!playerName) return;
    try {
        const currentPos = await fetchPlayerPosition(playerName);
        if (currentPos !== null) {
            const targetPos = Math.max(0, currentPos + offsetMicroseconds);
            let validTrackId = (typeof trackId === 'string' && trackId.startsWith('/'))
                ? trackId
                : '/org/mpris/MediaPlayer2/TrackList/NoTrack';

            try {
                await Gio.DBus.session.call(
                    playerName,
                    '/org/mpris/MediaPlayer2',
                    'org.mpris.MediaPlayer2.Player',
                    'SetPosition',
                    new GLib.Variant('(ox)', [validTrackId, targetPos]),
                    null,
                    Gio.DBusCallFlags.NONE, -1, null
                );
                return;
            } catch (_error) {
            }
        }

        await Gio.DBus.session.call(
            playerName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            'Seek',
            new GLib.Variant('(x)', [offsetMicroseconds]),
            null,
            Gio.DBusCallFlags.NONE, -1, null
        );
    } catch (error) {
        console.error(`Error seeking player ${playerName}:`, error);
    }
}

/**
 * Converts a GVariant value to a plain JS value.
 * GJS's deep_unpack() leaves a{sv} dict values wrapped in GVariant, so each
 * value must be unpacked individually. deep_unpack() is used (not unpack())
 * because array-typed variants (e.g. xesam:artist as "as") only yield plain
 * strings when deep-unpacked.
 */
export function unpackVariantValue(value) {
    if (value && typeof value.deep_unpack === 'function')
        return value.deep_unpack();
    return value;
}

/** Extracts normalized track metadata object from D-Bus properties. */
export function extractTrackMetadata(properties) {
    const rawMeta = properties['Metadata'];
    const metadata = (rawMeta && typeof rawMeta.deep_unpack === 'function') ? rawMeta.deep_unpack() : (rawMeta || {});

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

/** Returns a stable cache file path for a remote artwork URL. */
function getArtworkCachePath(artUrl) {
    const urlHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, artUrl, -1);
    return GLib.build_filenamev([MUSIC_ART_CACHE_DIR, urlHash]);
}

/**
 * Resolves an MPRIS artwork URL to a local file path.
 * Remote http(s) URLs are downloaded once into the user cache directory since
 * St CSS backgrounds cannot load remote URLs directly.
 */
export function ensureLocalArtwork(artUrl, callback) {
    if (!artUrl) {
        callback(null);
        return;
    }

    if (!artUrl.startsWith('http://') && !artUrl.startsWith('https://')) {
        callback(artUrl);
        return;
    }

    if (artworkFileCache.has(artUrl)) {
        callback(artworkFileCache.get(artUrl));
        return;
    }

    const filePath = getArtworkCachePath(artUrl);
    const localFile = Gio.File.new_for_path(filePath);
    if (localFile.query_exists(null)) {
        artworkFileCache.set(artUrl, filePath);
        callback(filePath);
        return;
    }

    const pending = artworkDownloadQueue.get(artUrl);
    if (pending) {
        pending.push(callback);
        return;
    }
    artworkDownloadQueue.set(artUrl, [callback]);

    try {
        const cacheDir = Gio.File.new_for_path(MUSIC_ART_CACHE_DIR);
        if (!cacheDir.query_exists(null)) {
            cacheDir.make_directory_with_parents(null);
        }
    } catch (e) {
        const queued = artworkDownloadQueue.get(artUrl);
        artworkDownloadQueue.delete(artUrl);
        queued?.forEach(cb => cb(null));
        return;
    }

    Gio.File.new_for_uri(artUrl).copy_async(
        localFile,
        Gio.FileCopyFlags.OVERWRITE,
        GLib.PRIORITY_DEFAULT,
        null,
        null,
        (source, result) => {
            const queued = artworkDownloadQueue.get(artUrl);
            artworkDownloadQueue.delete(artUrl);
            try {
                source.copy_finish(result);
                artworkFileCache.set(artUrl, filePath);
                queued?.forEach(cb => cb(filePath));
            } catch (e) {
                queued?.forEach(cb => cb(null));
            }
        }
    );
}

/** Updates background layer artwork image or fallback background color. */
export function applyArtworkToBackground(backgroundLayer, artUrl, config, state) {
    const borderRadius = config.appliedBorderRadius !== undefined ? `${config.appliedBorderRadius}px` : '0px';
    const backgroundColor = resolveWidgetBackgroundColor(config);

    const applyStyle = (localPath) => {
        if (!state?.container || state.container.isDestroyed) return;
        if (!localPath) {
            backgroundLayer.style = `background-color: ${backgroundColor}; border-radius: ${borderRadius};`;
            return;
        }
        const imageUrl = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
        backgroundLayer.style = `background-image: url("${imageUrl}"); background-size: cover; border-radius: ${borderRadius};`;
    };

    if (!artUrl) {
        applyStyle(null);
        return;
    }

    ensureLocalArtwork(artUrl, applyStyle);
}

/** Updates timer readout label text. */
export function updateTimerLabel(state) {
    if (!state.timerLabel) return;
    const pos = state.currentPositionMicro || 0;
    const len = state.trackLengthMicro || 0;
    state.timerLabel.set_text(`${formatMicroseconds(pos)} / ${formatMicroseconds(len)}`);
}

/** Resets music widget state and UI to stopped defaults. */
export function resetWidgetState(state) {
    const borderRadius = state.config.appliedBorderRadius !== undefined ? `${state.config.appliedBorderRadius}px` : '0px';
    const backgroundColor = resolveWidgetBackgroundColor(state.config);
    state.backgroundLayer.style = `background-color: ${backgroundColor}; border-radius: ${borderRadius};`;
    state.playPauseIcon.set_icon_name(FALLBACK_ICON);
    state.currentPositionMicro = 0;
    state.trackLengthMicro = 0;
    state.playbackStatus = 'Stopped';
    updateTimerLabel(state);
    if (state.titleLabel) state.titleLabel.set_text('Not Playing');
    if (state.artistLabel) state.artistLabel.set_text('Unknown Artist');
    if (state.albumLabel) state.albumLabel.hide();
    state.lastArtUrl = null;
}

/** Applies fetched MPRIS player properties to update widget UI. */
export function applyPlayerState(properties, state) {
    const playbackStatus = unpackVariantValue(properties['PlaybackStatus']) || 'Stopped';
    const isPlaying = playbackStatus === 'Playing';
    state.playbackStatus = playbackStatus;
    state.playPauseIcon.set_icon_name(isPlaying ? PAUSE_ICON : PLAY_ICON);

    const track = extractTrackMetadata(properties);

    if (state.lastTrackTitle !== track.title) {
        state.lastTrackTitle = track.title;
        state.currentPositionMicro = 0;
    }

    state.trackId = track.trackId;
    state.trackLengthMicro = track.lengthMicro;

    const positionMicro = unpackVariantValue(properties['Position']);
    const now = GLib.get_monotonic_time();
    const recentSeek = state.lastSeekTimestamp && (now - state.lastSeekTimestamp < RECENT_SEEK_WINDOW_MICROSECONDS);

    if (positionMicro !== undefined && positionMicro !== null && positionMicro >= 0) {
        const isSpuriousZero = (positionMicro === 0 && (state.currentPositionMicro || 0) > SPURIOUS_ZERO_THRESHOLD_MICROSECONDS);
        if (!isSpuriousZero) {
            const diff = Math.abs(positionMicro - (state.currentPositionMicro || 0));
            if (!recentSeek || diff > POSITION_DIFF_THRESHOLD_MICROSECONDS) {
                state.currentPositionMicro = positionMicro;
            }
        }
    }

    updateTimerLabel(state);

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

    let resolvedArtUrl = track.artUrl || state.lastArtUrl;
    if (track.artUrl) state.lastArtUrl = track.artUrl;

    applyArtworkToBackground(state.backgroundLayer, resolvedArtUrl, state.config, state);
}

/**
 * Asynchronously fetches player properties and position for active music widget.
 *
 * @param {Object} config - Widget configuration object
 * @param {Function} callback - Result callback receiving { activePlayer, properties }
 */
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

/**
 * Resolves Clutter alignment parameters based on configured control position.
 *
 * @param {string} position - Configured position string
 * @param {boolean} isLargeLayout - True if 2-panel layout
 * @returns {{ xAlign: Clutter.ActorAlign, yAlign: Clutter.ActorAlign }}
 */
export function resolveControlsAlignment(position, isLargeLayout) {
    if (isLargeLayout)
        return { xAlign: Clutter.ActorAlign.CENTER, yAlign: Clutter.ActorAlign.CENTER };

    let xAlign = Clutter.ActorAlign.CENTER;
    let yAlign = Clutter.ActorAlign.END;

    if (position.includes('left')) xAlign = Clutter.ActorAlign.START;
    if (position.includes('right')) xAlign = Clutter.ActorAlign.END;
    if (position.includes('top')) yAlign = Clutter.ActorAlign.START;
    if (position.includes('middle')) yAlign = Clutter.ActorAlign.CENTER;

    return { xAlign, yAlign };
}

/**
 * Connects click signal handler to control buttons with edit-mode guard.
 *
 * @param {St.Button} button - Target button actor
 * @param {Object} state - Mutable widget state
 * @param {Function} action - Execution handler callback
 */
export function connectControlButton(button, state, action) {
    button.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        if (!state.container.editMode || state.container.editMode === 0) {
            action();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

/**
 * Applies responsive scaling to music playback control buttons and timer label.
 * Shared between small and large layout scaler callbacks to eliminate duplication.
 *
 * @param {Object} state - Mutable widget state containing button/label refs
 * @param {number} scale - Current responsive scale factor
 * @param {string} fontFamily - Font family string
 * @param {string} textColor - Text color string
 */
export function updateControlButtonScaling(state, scale, fontFamily, textColor) {
    const BASE_SEEK_SIZE = 32;
    const BASE_PLAY_SIZE = 38;
    const BASE_BUTTON_MARGIN = 16;
    const BASE_TIMER_FONT_SIZE = 14;

    const seekSize = Math.max(16, Math.round(BASE_SEEK_SIZE * scale));
    const playSize = Math.max(20, Math.round(BASE_PLAY_SIZE * scale));
    const buttonMargin = Math.max(4, Math.round(BASE_BUTTON_MARGIN * scale));
    const timerFontSize = Math.max(10, Math.round(BASE_TIMER_FONT_SIZE * scale));
    const buttonStyle = (margin) => `margin: 0px ${margin}px; border-radius: ${BORDER_RADIUS_PILL}px;`;

    if (state.seekBackBtn) {
        state.seekBackBtn.style = buttonStyle(buttonMargin);
        if (state.seekBackBtn.iconRef) state.seekBackBtn.iconRef.set_icon_size(seekSize);
    }
    if (state.playPauseBtn) {
        state.playPauseBtn.style = buttonStyle(buttonMargin);
        if (state.playPauseBtn.iconRef) state.playPauseBtn.iconRef.set_icon_size(playSize);
    }
    if (state.seekForwardBtn) {
        state.seekForwardBtn.style = buttonStyle(buttonMargin);
        if (state.seekForwardBtn.iconRef) state.seekForwardBtn.iconRef.set_icon_size(seekSize);
    }
    if (state.timerLabel) {
        state.timerLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${timerFontSize}px; font-weight: bold; text-shadow: 0px 2px 4px rgba(0,0,0,0.8); margin-top: ${Math.max(2, Math.round(8 * scale))}px;`;
    }
}

let seekedSignalId = 0;
const activeMusicWidgetInstances = new Set();

/**
 * Sets up module-level D-Bus signal subscription for MPRIS Seeked events.
 */
export function setupDbusSignalListeners() {
    if (seekedSignalId === 0) {
        try {
            seekedSignalId = Gio.DBus.session.signal_subscribe(
                null,
                'org.mpris.MediaPlayer2.Player',
                'Seeked',
                null, null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                    try {
                        const unpacked = parameters.deep_unpack();
                        let rawPos = unpacked[0];
                        if (rawPos && typeof rawPos.unpack === 'function') {
                            rawPos = rawPos.unpack();
                        }
                        if (typeof rawPos === 'number' || typeof rawPos === 'bigint') {
                            const pos = Number(rawPos);
                            const now = GLib.get_monotonic_time();
                            for (const state of activeMusicWidgetInstances) {
                                state.currentPositionMicro = pos;
                                state.lastSeekTimestamp = now;
                                updateTimerLabel(state);
                            }
                        }
                    } catch (_error) {
                    }
                }
            );
        } catch (_error) {
        }
    }
}

/** Registers an active music widget instance. */
export function registerMusicWidgetInstance(state) {
    activeMusicWidgetInstances.add(state);
    setupDbusSignalListeners();
}

/** Unregisters a music widget instance and cleans up global signal listener when empty. */
export function unregisterMusicWidgetInstance(state) {
    activeMusicWidgetInstances.delete(state);
    if (activeMusicWidgetInstances.size === 0 && seekedSignalId !== 0) {
        try {
            Gio.DBus.session.signal_unsubscribe(seekedSignalId);
        } catch (_error) {
        }
        seekedSignalId = 0;
    }
}

/** Broadcasts seek position update across all active widget instances. */
export function notifySeekAllInstances(playerName, offsetMicroseconds) {
    const now = GLib.get_monotonic_time();
    for (const state of activeMusicWidgetInstances) {
        if (!playerName || !state.currentPlayer || state.currentPlayer === playerName) {
            const len = state.trackLengthMicro || 0;
            const currentPos = state.currentPositionMicro || 0;
            let nextPos = currentPos + offsetMicroseconds;
            if (nextPos < 0) nextPos = 0;
            if (len > 0 && nextPos > len) nextPos = len;

            state.currentPositionMicro = nextPos;
            state.lastSeekTimestamp = now;
            updateTimerLabel(state);
        }
    }
}

/** Broadcasts play/pause state toggle across all active widget instances. */
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

/** Builds playback controls layout actor. */
export function buildControlsColumn(config, state, width = 240, height = 140) {
    const dynScale = Math.max(0.5, Math.min(width / 240, height / 140));
    const scale = (config.layoutScale || 1) * dynScale;
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveWidgetFontFamily(config);
    const margin = Math.floor(12 * scale);

    const isLargeLayout = config.isLargeLayout === true;
    const controlsPosition = config.controlsPosition || 'bottom-center';
    const { xAlign, yAlign } = resolveControlsAlignment(controlsPosition, isLargeLayout);

    const controlsColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: xAlign,
        y_align: yAlign,
        style: isLargeLayout ? `margin-top: ${margin}px;` : `margin: ${margin}px;`,
    });

    const buttonRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const defaultIconSize = 32;
    const largePlaySize = Math.floor(48 * scale);
    const largeSeekSize = Math.floor(32 * scale);
    const buttonMargin = Math.floor(16 * scale);

    const seekBackBtn = createIconButton(
        SEEK_BACK_ICON,
        isLargeLayout ? largeSeekSize : defaultIconSize,
        buttonMargin, textColor
    );
    const playPauseBtn = createIconButton(
        FALLBACK_ICON,
        isLargeLayout ? largePlaySize : defaultIconSize,
        buttonMargin, textColor
    );
    const seekForwardBtn = createIconButton(
        SEEK_FORWARD_ICON,
        isLargeLayout ? largeSeekSize : defaultIconSize,
        buttonMargin, textColor
    );

    if (config.showBackward !== false) buttonRow.add_child(seekBackBtn);
    if (config.showPlay !== false) buttonRow.add_child(playPauseBtn);
    if (config.showForward !== false) buttonRow.add_child(seekForwardBtn);

    let timerLabel = null;
    if (config.showTimer === true) {
        timerLabel = new St.Label({
            text: '00:00 / 00:00',
            x_align: Clutter.ActorAlign.CENTER,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.floor(14 * scale)}px; font-weight: bold; text-shadow: 0px 2px 4px rgba(0,0,0,0.8); margin-top: ${Math.floor(8 * scale)}px;`,
        });
    }

    if (buttonRow.get_n_children() > 0) controlsColumn.add_child(buttonRow);
    if (timerLabel) controlsColumn.add_child(timerLabel);

    state.controlsColumn = controlsColumn;
    state.seekBackBtn = seekBackBtn;
    state.playPauseBtn = playPauseBtn;
    state.seekForwardBtn = seekForwardBtn;
    state.playPauseIcon = playPauseBtn.iconRef;
    state.timerLabel = timerLabel;

    connectControlButton(seekBackBtn, state, () => {
        notifySeekAllInstances(state.currentPlayer, -SEEK_OFFSET_MICROSECONDS);
        seekPlayer(state.currentPlayer, -SEEK_OFFSET_MICROSECONDS, state.trackId);
    });

    connectControlButton(playPauseBtn, state, () => {
        notifyPlayPauseAllInstances(state.currentPlayer);
        togglePlayPause(state.currentPlayer);
    });

    connectControlButton(seekForwardBtn, state, () => {
        notifySeekAllInstances(state.currentPlayer, SEEK_OFFSET_MICROSECONDS);
        seekPlayer(state.currentPlayer, SEEK_OFFSET_MICROSECONDS, state.trackId);
    });

    return controlsColumn;
}
