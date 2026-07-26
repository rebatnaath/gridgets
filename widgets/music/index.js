/**
 * ============================================================================
 * MUSIC WIDGET PACKAGE ENTRY POINT
 * ============================================================================
 */

import GLib from 'gi://GLib';
import { createWidgetContainer, connectTimerCleanup } from '../../utils/widgetUIUtils.js';
import { DBUS_POLL_INTERVAL_MS, fetchMusicDataForConfig, applyPlayerState, resetWidgetState, updateTimerLabel, registerMusicWidgetInstance, unregisterMusicWidgetInstance } from './musicCommon.js';
import { buildSmallLayout } from './musicSmall.js';
import { buildLargeLayout } from './musicLarge.js';

/** Layout ratio and scaling constants */
const LARGE_LAYOUT_ASPECT_RATIO = 2;
const LARGE_LAYOUT_BASE_HEIGHT = 4;
const ONE_SECOND_MICROSECONDS = 1000000;

/** Creates a music player widget instance (supporting small and large 2-panel layouts). */
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
        currentPositionMicro: 0,
        trackLengthMicro: 0,
        playbackStatus: 'Stopped',
        lastSeekTimestamp: 0,
        isDestroyed: false,
    };

    registerMusicWidgetInstance(state);
    playerContainer.connect('destroy', () => {
        state.isDestroyed = true;
        unregisterMusicWidgetInstance(state);
    });

    const isLargeLayout = config.width === config.height * LARGE_LAYOUT_ASPECT_RATIO;

    if (isLargeLayout) {
        config.isLargeLayout = true;
        config.layoutScale = config.height / LARGE_LAYOUT_BASE_HEIGHT;
        buildLargeLayout(config, state, width);
    } else {
        buildSmallLayout(config, state);
    }

    const onMusicData = (data) => {
        if (state.isDestroyed) return;
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

    const updateMusicData = () => {
        if (state.isDestroyed) return;
        fetchMusicDataForConfig(config, onMusicData);
    };

    state.triggerRefresh = updateMusicData;
    updateMusicData();

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
        if (state.isDestroyed) return GLib.SOURCE_REMOVE;
        if (state.playbackStatus === 'Playing') {
            const len = state.trackLengthMicro || 0;
            const nextPos = (state.currentPositionMicro || 0) + ONE_SECOND_MICROSECONDS;
            state.currentPositionMicro = (len > 0) ? Math.min(len, nextPos) : nextPos;
            updateTimerLabel(state);
        }
        updateMusicData();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(playerContainer, state);

    return playerContainer;
}
