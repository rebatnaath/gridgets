import GLib from 'gi://GLib';
import { WIDE_MUSIC_LAYOUT_ASPECT_RATIO } from '../../utils/widgetUtils.js';
import { connectTimerCleanup, createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { DBUS_POLL_INTERVAL_MS } from './mpris.js';
import {
    MICROSECONDS_PER_SECOND,
    fetchMusicDataForConfig,
    applyPlayerState,
    resetWidgetState,
    updateTimerLabel,
    registerMusicWidgetInstance,
    unregisterMusicWidgetInstance,
} from './playbackState.js';
import { buildSmallLayout } from './musicSmall.js';
import { buildLargeLayout } from './musicLarge.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const LARGE_LAYOUT_BASE_HEIGHT = 240;

/** Shared D-Bus pollers keyed by player-filter config, so N widgets make 1 poll/s total. */
const activeMusicPolls = new Map();

/**
 * Registers a per-second D-Bus fetch tick for a widget; widgets with identical
 * player filters share one poller. Returns the release function.
 */
function beginMusicPolling(config, onPollTick) {
    const pollKey = `${config.ignoreBrowsers !== false}|${(config.playerFilter || '').trim()}`;
    let poll = activeMusicPolls.get(pollKey);
    if (!poll) {
        poll = { timerId: null, onTicks: new Set() };
        activeMusicPolls.set(pollKey, poll);
        poll.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
            for (const onTick of [...poll.onTicks])
                onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }
    poll.onTicks.add(onPollTick);

    let released = false;
    return () => {
        if (released) return;
        released = true;
        poll.onTicks.delete(onPollTick);
        if (poll.onTicks.size === 0 && poll.timerId) {
            GLib.Source.remove(poll.timerId);
            poll.timerId = null;
            activeMusicPolls.delete(pollKey);
        }
    };
}

export function createMusicNode(config, width, height, xPosition, yPosition) {
    const playerContainer = createWidgetContainer(config, width, height, xPosition, yPosition);

    const state = {
        container: playerContainer,
        backgroundLayer: null,
        artworkCss: null,
        playPauseIcon: null,
        timerLabelLeft: null,
        timerLabelRight: null,
        titleLabel: null,
        artistLabel: null,
        albumLabel: null,
        config: config,
        timerId: null,
        artworkRetryWaits: null,
        lastArtUrl: null,
        currentPlayer: null,
        currentPositionMicro: 0,
        trackLengthMicro: 0,
        playbackStatus: 'Stopped',
        lastSeekTimestamp: 0,
    };

    registerMusicWidgetInstance(state);
    registerWidgetCleanup(playerContainer, () => {
        unregisterMusicWidgetInstance(state);
        if (state.artworkRetryWaits) {
            for (const wait of [...state.artworkRetryWaits]) {
                wait.settle(false);
            }
        }
    });

    const isLargeLayout = height > 0 && width / height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
    config.isLargeLayout = isLargeLayout;

    if (isLargeLayout) {
        config.layoutScale = height / LARGE_LAYOUT_BASE_HEIGHT;
        buildLargeLayout(config, state, width);
    } else {
        buildSmallLayout(config, state);
    }

    const onMusicData = (data) => {
        if (isActorDestroyed(playerContainer)) return;
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
        if (isActorDestroyed(playerContainer)) return;
        fetchMusicDataForConfig(config, onMusicData);
    };

    updateMusicData();

    const releasePolling = beginMusicPolling(config, updateMusicData);

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DBUS_POLL_INTERVAL_MS, () => {
        if (isActorDestroyed(playerContainer)) return GLib.SOURCE_REMOVE;
        if (state.playbackStatus === 'Playing') {
            const len = state.trackLengthMicro || 0;
            const prevPos = state.currentPositionMicro || 0;
            const nextPos = prevPos + MICROSECONDS_PER_SECOND;
            state.currentPositionMicro = (len > 0) ? Math.min(len, nextPos) : nextPos;
            updateTimerLabel(state);
        }
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(playerContainer, state);
    registerWidgetCleanup(playerContainer, releasePolling);

    return playerContainer;
}
