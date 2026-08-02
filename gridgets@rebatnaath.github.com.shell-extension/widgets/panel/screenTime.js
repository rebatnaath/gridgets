import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** How often to tick the in-focus app's counter, in milliseconds. */
const TICK_INTERVAL_MS = 1000;

/** Maximum number of apps shown in the menu. */
const MAX_VISIBLE_APPS = 8;

/** Width of the usage bar in pixels. */
const BAR_WIDTH_PX = 120;

/** Formats a total-seconds value as HH:MM:SS or MM:SS. */
function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0)
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;

    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/** Returns today's date as YYYY-MM-DD in local time. */
function todayDateString() {
    const now = GLib.DateTime.new_now_local();
    return `${now.get_year()}-${now.get_month().toString().padStart(2, '0')}-${now.get_day_of_month().toString().padStart(2, '0')}`;
}

export const ScreenTimeIndicator = GObject.registerClass(
class ScreenTimeIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Gridgets Screen Time', false);

        /** Seconds spent per app name today. Keys are app display names. */
        this._appSeconds = new Map();

        /** The app name that is currently in focus (or null). */
        this._focusedAppName = null;

        /** Timestamp (GLib monotonic, microseconds) when focus on current app started. */
        this._focusStartMicro = null;

        /** The date string for which data was last collected; resets at midnight. */
        this._trackedDate = todayDateString();

        this._tickSourceId = null;
        this._focusSignalId = 0;

        this._buildPanelIcon();
        this._buildInitialMenu();
        this._connectFocusSignal();
        this._startTicker();
    }

    destroy() {
        if (this._tickSourceId) {
            GLib.Source.remove(this._tickSourceId);
            this._tickSourceId = null;
        }

        if (this._focusSignalId > 0) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = 0;
        }

        super.destroy();
    }

    // ── Private: setup ───────────────────────────────────────────────────────

    _buildPanelIcon() {
        const icon = new St.Icon({
            icon_name: 'preferences-system-time-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);
    }

    _buildInitialMenu() {
        this._headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });

        const headingLabel = new St.Label({
            text: 'Screen Time Today',
            style: 'font-weight: bold;',
            x_expand: true,
        });
        this._headerItem.add_child(headingLabel);

        this._totalLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 0.9em; opacity: 0.8;',
        });
        this._headerItem.add_child(this._totalLabel);

        this.menu.addMenuItem(this._headerItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._appSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._appSection);
    }

    _connectFocusSignal() {
        this._focusSignalId = global.display.connect('notify::focus-window', () => {
            this._onFocusChanged();
        });
        // Capture whatever is currently focused at startup.
        this._onFocusChanged();
    }

    _startTicker() {
        this._tickSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ── Private: tracking ────────────────────────────────────────────────────

    _onFocusChanged() {
        const now = GLib.get_monotonic_time();

        // Flush elapsed time into the previously focused app.
        if (this._focusedAppName && this._focusStartMicro !== null) {
            const elapsedSeconds = Math.floor((now - this._focusStartMicro) / 1_000_000);
            if (elapsedSeconds > 0)
                this._addSeconds(this._focusedAppName, elapsedSeconds);
        }

        this._focusedAppName = this._resolveCurrentAppName();
        this._focusStartMicro = this._focusedAppName ? now : null;
    }

    _tick() {
        // Roll over at midnight.
        const today = todayDateString();
        if (today !== this._trackedDate) {
            this._trackedDate = today;
            this._appSeconds.clear();
        }

        // Accumulate one second for the currently focused app.
        if (this._focusedAppName)
            this._addSeconds(this._focusedAppName, 1);

        if (this.menu.isOpen)
            this._rebuildAppList();
    }

    _addSeconds(appName, seconds) {
        this._appSeconds.set(appName, (this._appSeconds.get(appName) ?? 0) + seconds);
    }

    _resolveCurrentAppName() {
        const focusedWindow = global.display.focus_window;
        if (!focusedWindow) return null;

        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.get_window_app(focusedWindow);
        if (!app) return null;

        return app.get_name() || app.get_id() || null;
    }

    // ── Private: menu rendering ──────────────────────────────────────────────

    _rebuildAppList() {
        this._appSection.removeAll();

        const totalSeconds = [...this._appSeconds.values()].reduce((sum, seconds) => sum + seconds, 0);
        this._totalLabel.set_text(`Total: ${formatDuration(totalSeconds)}`);

        if (this._appSeconds.size === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No usage recorded yet.', { reactive: false });
            this._appSection.addMenuItem(emptyItem);
            return;
        }

        // Sort by descending usage, cap at MAX_VISIBLE_APPS
        const sorted = [...this._appSeconds.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_VISIBLE_APPS);

        const topSeconds = sorted[0][1];

        for (const [appName, seconds] of sorted) {
            this._appSection.addMenuItem(this._buildAppRow(appName, seconds, topSeconds, totalSeconds));
        }
    }

    _buildAppRow(appName, seconds, maxSeconds, totalSeconds) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });

        const nameLabel = new St.Label({
            text: appName,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'min-width: 120px;',
        });

        const barFill = maxSeconds > 0 ? Math.round((seconds / maxSeconds) * BAR_WIDTH_PX) : 0;
        const bar = new St.Widget({
            style: `background-color: rgba(94,129,244,0.7); border-radius: 3px; height: 6px; width: ${barFill}px;`,
        });

        const barTrack = new St.BoxLayout({
            style: `background-color: rgba(255,255,255,0.12); border-radius: 3px; height: 6px; width: ${BAR_WIDTH_PX}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        barTrack.add_child(bar);

        const percentage = totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0;
        const timeLabel = new St.Label({
            text: `${formatDuration(seconds)} (${percentage}%)`,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'min-width: 90px; text-align: right; font-size: 0.85em; opacity: 0.8;',
        });

        item.add_child(nameLabel);
        item.add_child(barTrack);
        item.add_child(timeLabel);

        return item;
    }

    // Rebuild the list when the menu opens.
    _onOpenStateChanged(_menu, isOpen) {
        if (isOpen)
            this._rebuildAppList();
    }
});
