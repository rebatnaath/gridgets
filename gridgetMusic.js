/**
 * ============================================================================
 * MUSIC PLAYER WIDGET (gridgetMusic.js)
 * 
 * This module creates a media control widget that interfaces with active
 * MPRIS-compatible media players via D-Bus. It displays track metadata and
 * provides playback controls.
 * ============================================================================
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetBackgroundColor, buildBaseWidgetStyle, resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY } from './widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup } from './widgetUIUtils.js';
import { PollingEngine } from './systemMonitorEngine.js';

const PLAY_ICON = 'media-playback-start-symbolic';
const PAUSE_ICON = 'media-playback-pause-symbolic';
const SEEK_BACK_ICON = 'media-seek-backward-symbolic';
const SEEK_FORWARD_ICON = 'media-seek-forward-symbolic';
const FALLBACK_ICON = 'audio-x-generic-symbolic';
const DEFAULT_TEXT_PANEL_COLOR = 'rgba(0,0,0,0.6)';

// D-Bus is polled at this interval because MPRIS PropertiesChanged signals
// are unreliable across players — polling ensures consistent position updates.
const DBUS_POLL_INTERVAL_MS = 1000;
const SEEK_OFFSET_MICROSECONDS = 5000000;

function formatMicroseconds(microseconds) {
    if (!microseconds || microseconds < 0) return '00:00';
    const totalSeconds = Math.floor(microseconds / 1000000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}



function createBackgroundLayer(config) {
    const borderRadius = config.appliedBorderRadius || 0;
    const backgroundColor = resolveWidgetBackgroundColor(config);
    return new St.Widget({
        style: `background-color: ${backgroundColor}; background-size: cover; background-position: center; border-radius: ${borderRadius}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
}

function createIconButton(iconName, iconSize, buttonMargin, textColor) {
    const button = new St.Button({
        reactive: true,
        can_focus: true,
        style: `margin: 0 ${buttonMargin}px; border-radius: 50%;`,
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

// D-Bus communication
async function getActiveMediaPlayer() {
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
        const mediaPlayers = busNames.filter(name => name.startsWith('org.mpris.MediaPlayer2.'));
        return mediaPlayers.length > 0 ? mediaPlayers[0] : null;
    } catch (error) {
        return null;
    }
}

async function fetchPlayerProperties(playerName) {
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
    } catch (error) {
        return null;
    }
}

async function togglePlayPause(playerName) {
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
        // Player may have exited between poll cycles
    }
}

async function seekPlayer(playerName, offsetMicroseconds) {
    if (!playerName) return;
    try {
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
        // Player may have exited between poll cycles
    }
}

//  State management 
function extractTrackMetadata(properties) {
    const metadata = properties['Metadata']?.deep_unpack() || {};

    const title = metadata['xesam:title']?.unpack() || 'Unknown Title';
    const rawArtists = metadata['xesam:artist']?.unpack() || [];
    let artistNames = Array.isArray(rawArtists) ? rawArtists : [rawArtists];
    artistNames = artistNames.map(a => (a && typeof a.unpack === 'function') ? a.unpack() : a);
    const artist = artistNames.length > 0 && artistNames[0] ? artistNames.join(', ') : 'Unknown Artist';
    const album = metadata['xesam:album']?.unpack() || '';
    const artUrl = metadata['mpris:artUrl']?.unpack() || '';
    const lengthMicro = metadata['mpris:length']?.unpack() || 0;

    return { title, artist, album, artUrl, lengthMicro };
}

function applyArtworkToBackground(backgroundLayer, artUrl, config) {
    const radiusMatch = backgroundLayer.style.match(/border-radius:\s*([^;]+);/);
    const radius = radiusMatch ? radiusMatch[1] : '0px';
    const backgroundColor = resolveWidgetBackgroundColor(config);

    if (!artUrl) {
        backgroundLayer.style = `background-color: ${backgroundColor}; border-radius: ${radius};`;
        return;
    }

    let imageUrl = artUrl;
    if (imageUrl.startsWith('file://')) {
        imageUrl = `file://${imageUrl.replace('file://', '')}`;
    } else if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        imageUrl = `file://${imageUrl}`;
    }

    backgroundLayer.style = `background-image: url("${imageUrl}"); background-size: cover; background-position: center; border-radius: ${radius};`;
}

function resetWidgetState(state) {
    const radiusMatch = state.backgroundLayer.style.match(/border-radius:\s*([^;]+);/);
    const radius = radiusMatch ? radiusMatch[1] : '0px';
    const backgroundColor = resolveWidgetBackgroundColor(state.config);
    state.backgroundLayer.style = `background-color: ${backgroundColor}; border-radius: ${radius};`;
    state.playPauseIcon.set_icon_name(FALLBACK_ICON);
    if (state.timerLabel) state.timerLabel.set_text('00:00 / 00:00');
    if (state.titleLabel) state.titleLabel.set_text('Not Playing');
    if (state.artistLabel) state.artistLabel.set_text('Unknown Artist');
    if (state.albumLabel) state.albumLabel.hide();
    state.lastArtUrl = null;
}

function applyPlayerState(properties, state) {
    const playbackStatus = properties['PlaybackStatus']?.unpack() || 'Stopped';
    const isPlaying = playbackStatus === 'Playing';
    state.playPauseIcon.set_icon_name(isPlaying ? PAUSE_ICON : PLAY_ICON);

    const track = extractTrackMetadata(properties);

    if (state.timerLabel) {
        const positionMicro = properties['Position']?.unpack();
        if (positionMicro !== undefined && positionMicro !== null) {
            state.timerLabel.set_text(
                `${formatMicroseconds(positionMicro)} / ${formatMicroseconds(track.lengthMicro)}`
            );
        }
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

    // If the player drops the art URL temporarily, reuse the last known one
    let resolvedArtUrl = track.artUrl;
    if (!resolvedArtUrl && state.lastArtUrl) {
        resolvedArtUrl = state.lastArtUrl;
    } else if (resolvedArtUrl) {
        state.lastArtUrl = resolvedArtUrl;
    }

    applyArtworkToBackground(state.backgroundLayer, resolvedArtUrl, state.config);
}

function fetchMusicData(callback) {
    (async () => {
        const activePlayer = await getActiveMediaPlayer();
        if (activePlayer) {
            const properties = await fetchPlayerProperties(activePlayer);
            if (properties) {
                callback({ activePlayer, properties });
                return;
            }
        }
        callback({ activePlayer: null, properties: null });
    })();
}

const musicEngine = new PollingEngine(DBUS_POLL_INTERVAL_MS, fetchMusicData);


//  Control buttons
function buildControlButtons(config, state) {
    const scale = config.layoutScale || 1;
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const margin = Math.floor(16 * scale);

    const isLargeLayout = config.isLargeLayout === true;
    const controlsPosition = config.controlsPosition || 'bottom-center';

    const { xAlign, yAlign } = resolveControlsAlignment(controlsPosition, isLargeLayout);

    const controlsColumn = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: xAlign,
        y_align: yAlign,
        style: isLargeLayout ? `margin-top: ${margin}px;` : `margin: ${margin}px;`,
    });

    const buttonRow = new St.BoxLayout({
        vertical: false,
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
    if (config.showTimer !== false) {
        timerLabel = new St.Label({
            text: '00:00 / 00:00',
            x_align: Clutter.ActorAlign.CENTER,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.floor(14 * scale)}px; font-weight: bold; text-shadow: 0px 2px 4px rgba(0,0,0,0.8); margin-top: ${Math.floor(8 * scale)}px;`,
        });
    }

    if (buttonRow.get_n_children() > 0) controlsColumn.add_child(buttonRow);
    if (timerLabel) controlsColumn.add_child(timerLabel);

    state.playPauseIcon = playPauseBtn.iconRef;
    state.timerLabel = timerLabel;

    connectControlButton(seekBackBtn, state,
        () => seekPlayer(state.currentPlayer, -SEEK_OFFSET_MICROSECONDS));
    connectControlButton(playPauseBtn, state,
        () => togglePlayPause(state.currentPlayer));
    connectControlButton(seekForwardBtn, state,
        () => seekPlayer(state.currentPlayer, SEEK_OFFSET_MICROSECONDS));

    return controlsColumn;
}

function resolveControlsAlignment(position, isLargeLayout) {
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

function connectControlButton(button, state, action) {
    button.connect('button-press-event', (actor, event) => {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

        const isNotInEditMode = !state.container.editMode || state.container.editMode === 0;
        if (isNotInEditMode) {
            action();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

//  Layout builders

function buildSmallLayout(config, state) {
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;

    const controlsBox = buildControlButtons(config, state);

    state.container.add_child(backgroundLayer);
    state.container.add_child(controlsBox);
}

function buildLargeLayout(config, state, width) {
    const cornerRadius = config.appliedBorderRadius || 0;
    const scale = config.layoutScale;
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textPanelColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const halfWidth = Math.floor(width / 2);

    const splitContainer = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${textPanelColor}; border-radius: ${cornerRadius}px;`,
    });

    const imagePanel = new St.Widget({
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        style: `background-color: ${textPanelColor}; border-radius: ${cornerRadius}px 0px 0px ${cornerRadius}px;`,
    });
    state.backgroundLayer = imagePanel;

    const infoPanel = new St.BoxLayout({
        vertical: true,
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `padding: ${Math.floor(24 * scale)}px;`,
    });

    const titleLabel = new St.Label({
        text: 'Not Playing',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.floor(24 * scale)}px; font-weight: bold; margin-bottom: ${Math.floor(4 * scale)}px;`,
    });
    const artistLabel = new St.Label({
        text: 'Unknown Artist',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.8; font-size: ${Math.floor(18 * scale)}px; margin-bottom: ${Math.floor(4 * scale)}px;`,
    });
    const albumLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.6; font-size: ${Math.floor(18 * scale)}px; margin-bottom: ${Math.floor(24 * scale)}px;`,
    });

    state.titleLabel = titleLabel;
    state.artistLabel = artistLabel;
    state.albumLabel = albumLabel;

    infoPanel.add_child(titleLabel);
    infoPanel.add_child(artistLabel);
    infoPanel.add_child(albumLabel);

    const controlsBox = buildControlButtons(config, state);
    infoPanel.add_child(controlsBox);

    splitContainer.add_child(imagePanel);
    splitContainer.add_child(infoPanel);
    state.container.add_child(splitContainer);
}

// Public entry point 

export function createMusicNode(config, width, height, xPosition, yPosition) {
    const playerContainer = createWidgetContainer(config, width, height, xPosition, yPosition);

    const state = {
        container: playerContainer,
        backgroundLayer: null,
        playPauseIcon: null,
        timerLabel: null,
        titleLabel: null,
        artistLabel: null,
        albumLabel: null,
        config: config,
        timerId: null,
        lastArtUrl: null,
        currentPlayer: null,
    };

    const isLargeLayout = config.width === config.height * 2;

    if (isLargeLayout) {
        config.isLargeLayout = true;
        config.layoutScale = config.height / 4;
        buildLargeLayout(config, state, width);
    } else {
        buildSmallLayout(config, state);
    }

    const onMusicData = (data) => {
        if (data.properties) {
            state.currentPlayer = data.activePlayer;
            applyPlayerState(data.properties, state);
        } else {
            if (state.currentPlayer !== null) {
                resetWidgetState(state);
                state.currentPlayer = null;
            }
        }
    };

    musicEngine.subscribe(onMusicData);

    playerContainer.connect('destroy', () => {
        musicEngine.unsubscribe(onMusicData);
    });

    return playerContainer;
}
