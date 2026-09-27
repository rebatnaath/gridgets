import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const RECONNECT_DEBOUNCE_SECONDS = 3;

const subscribers = new Set();
let signalId = 0;
let debounceSourceId = 0;
let lastKnownAvailable = null;

/**
 * Gio.NetworkMonitor reports a default route, not a working internet connection, so a
 * TRUE here only means "worth trying". Callers should still handle a failed fetch; this
 * is for not retrying into a known-dead network and for recovering promptly when it
 * comes back.
 */
function readAvailable() {
    return Gio.NetworkMonitor.get_default().get_network_available();
}

function notifySubscribers(available) {
    // A throwing subscriber is logged and kept: unsubscribing it would silently cost
    // that widget its reconnect recovery for the rest of the session, and the throw is
    // as likely to be transient as it is to be a defect.
    for (const subscriber of [...subscribers]) {
        try {
            subscriber(available);
        } catch (error) {
            console.error('Gridgets: connectivity subscriber failed:', error);
        }
    }
}

function handleNetworkChanged(_monitor, available) {
    if (!available) {
        lastKnownAvailable = false;
        notifySubscribers(false);
        return;
    }
    // The network often flaps through several states while it settles; wait for it to
    // hold before telling widgets to retry, so a reconnect costs one fetch, not five.
    if (debounceSourceId)
        GLib.Source.remove(debounceSourceId);
    debounceSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RECONNECT_DEBOUNCE_SECONDS, () => {
        debounceSourceId = 0;
        const stillAvailable = readAvailable();
        if (!stillAvailable || stillAvailable === lastKnownAvailable)
            return GLib.SOURCE_REMOVE;
        lastKnownAvailable = stillAvailable;
        notifySubscribers(true);
        return GLib.SOURCE_REMOVE;
    });
}

function connect() {
    if (signalId !== 0)
        return;
    const monitor = Gio.NetworkMonitor.get_default();
    lastKnownAvailable = readAvailable();
    signalId = monitor.connect('network-changed', handleNetworkChanged);
}

function disconnect() {
    if (signalId !== 0) {
        Gio.NetworkMonitor.get_default().disconnect(signalId);
        signalId = 0;
    }
    if (debounceSourceId) {
        GLib.Source.remove(debounceSourceId);
        debounceSourceId = 0;
    }
    lastKnownAvailable = null;
}

/**
 * Subscribes to connectivity changes. The callback fires with the current state
 * immediately, then on every settled change. Returns an unsubscribe function.
 */
export function subscribeToConnectivity(callback) {
    subscribers.add(callback);
    connect();
    callback(lastKnownAvailable);
    return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0)
            disconnect();
    };
}

/**
 * Subscribes to settled connectivity changes only, swallowing the immediate call that
 * reports the current state. A widget that has already fetched once during creation
 * wants this, otherwise coming up costs two requests and the first is cancelled before
 * it leaves.
 */
export function subscribeToSettledConnectivity(callback) {
    let isSettled = false;
    return subscribeToConnectivity(available => {
        if (!isSettled) {
            isSettled = true;
            return;
        }
        callback(available);
    });
}

export function isNetworkAvailable() {
    return readAvailable();
}

/** Releases the monitor when the extension is disabled. */
export function clearConnectivityWatch() {
    subscribers.clear();
    disconnect();
}
