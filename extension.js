// This project uses LLMs as a helper (templates, boilerplate, auto-completion, git-push, commit, readme and docs generation)
// while the majority of the code is written and verified by a human.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DesktopGrid } from './desktopGrid/index.js';
import { copyDesktopIcon, cutDesktopIcon, startIconRename } from './desktopGrid/iconActions.js';
import { getSelectedIcon, onSelectionChanged, clearIconSelection } from './desktopIcons/desktopIconWidget.js';
import { clearMoodStoreCache } from './utils/moodStore.js';
import { clearGeocodeCache } from './widgets/weather/weatherCommon.js';
import { clearArtworkCaches } from './widgets/music/artwork.js';
import { clearRssEngines } from './utils/rssEngine.js';
import { clearArticleImageCache } from './utils/articleImage.js';
import { clearLastGoodCaches } from './utils/lastGoodCache.js';
import { clearConnectivityWatch } from './utils/connectivity.js';
import { resetSystemMonitorEngines } from './utils/systemMonitorEngine.js';
import { clearEnsuredDirectories } from './utils/widgetUtils.js';
import { findThemePreset } from './utils/themePresets.js';
import { clearMusicPlaybackState } from './widgets/music/playbackState.js';
import { clearMusicPolls, clearMusicRetainedState } from './widgets/music/index.js';
import { clearPlayerControlState } from './widgets/music/mpris.js';
import { screenTimeEngine } from './utils/screenTimeEngine.js';
import { APP_LAUNCHERS_KEY, SHOW_APP_LAUNCHERS_KEY } from './desktopIcons/appLaunchers.js';
import {
    SHOW_DESKTOP_ICONS_KEY,
    SHOW_HIDDEN_DESKTOP_ICONS_KEY,
    startDesktopIconWatch,
    stopDesktopIconWatch,
    syncDesktopIcons,
} from './desktopIcons/desktopIcons.js';

// Extensions that draw their own desktop icons. Running alongside one of them puts two
// sets of icons on the same wallpaper, which is why enabling this warns rather than
// silently rendering over the other.
const DESKTOP_ICON_EXTENSION_UUIDS = Object.freeze([
    'gtk4-ding@smedius.gitlab.com',
    'ding@smedius.gnome.org',
]);

// Same order as the bindings _addIconShortcuts registers, which is what lets the removal
// walk the ids without carrying the names alongside them.
const ICON_SHORTCUT_NAMES = Object.freeze([
    'rename-selected-icon',
    'cut-selected-icon',
    'copy-selected-icon',
]);

export default class GridgetsExtension extends Extension {
    enable() {
        this._desktopGrids = [];
        this._monitorsChangedId = 0;
        this._settingSignalIds = [];
        this._interfaceSignalId = 0;
        this._accentSignalId = 0;
        this._focusWindowId = 0;
        this._settings = this.getSettings();
        this._interfaceSettings = Gio.Settings.new('org.gnome.desktop.interface');
        this._iconShortcutIds = [];

        this._migrateOldThemeSettings();
        this._watchIconSelection();
        this._watchFocusWindow();

        this._settingSignalIds.push(
            this._settings.connect('changed::global-monitor', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::theme', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::accent-color-override', () => this._rebuildGrids())
        );
        // Synced before the grids are built so icons are part of the first layout rather
        // than appearing a moment later, and the key is not watched by the grids either:
        // this rebuild is the only rebuild for it.
        this._settingSignalIds.push(
            this._settings.connect(`changed::${SHOW_DESKTOP_ICONS_KEY}`, () => {
                if (this._settings.get_boolean(SHOW_DESKTOP_ICONS_KEY)) {
                    this._warnIfDesktopIconsExtensionEnabled();
                    syncDesktopIcons(this._settings);
                    startDesktopIconWatch(this._settings);
                } else {
                    stopDesktopIconWatch();
                }
                this._rebuildGrids();
            })
        );

        if (this._settings.get_boolean(SHOW_DESKTOP_ICONS_KEY)) {
            this._warnIfDesktopIconsExtensionEnabled();
            syncDesktopIcons(this._settings);
            startDesktopIconWatch(this._settings);
        }

        // Watched here for the same reason as SHOW_DESKTOP_ICONS_KEY, and for one more:
        // which entries change is only known once the folder has been read again, so a
        // grid reacting to this key on its own would rebuild before the layout knew.
        this._settingSignalIds.push(
            this._settings.connect(`changed::${SHOW_HIDDEN_DESKTOP_ICONS_KEY}`, () => {
                if (!this._settings.get_boolean(SHOW_DESKTOP_ICONS_KEY))
                    return;
                syncDesktopIcons(this._settings);
                this._rebuildGrids();
            })
        );

        // Same reason as the two keys above: the set of entries is only known once the
        // folder and the chosen launchers have been read again, so the sync happens here
        // and the grids are told to rebuild afterwards rather than reacting on their own.
        for (const key of [SHOW_APP_LAUNCHERS_KEY, APP_LAUNCHERS_KEY]) {
            this._settingSignalIds.push(
                this._settings.connect(`changed::${key}`, () => {
                    if (!this._settings.get_boolean(SHOW_DESKTOP_ICONS_KEY))
                        return;
                    syncDesktopIcons(this._settings);
                    this._rebuildGrids();
                })
            );
        }

        this._screenTimeRelease = screenTimeEngine.acquire();

        this._createAndShowGrids();

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._rebuildGrids();
        });

        this._interfaceSignalId = this._interfaceSettings.connect('changed::color-scheme', () => {
            this._rebuildGrids();
        });

        if (this._interfaceSettings.settings_schema.has_key('accent-color')) {
            this._accentSignalId = this._interfaceSettings.connect('changed::accent-color', () => {
                this._rebuildGrids();
            });
        }
    }

    disable() {
        if (this._focusWindowId > 0) {
            global.display.disconnect(this._focusWindowId);
            this._focusWindowId = 0;
        }
        if (this._stopWatchingIconSelection) {
            this._stopWatchingIconSelection();
            this._stopWatchingIconSelection = null;
        }
        this._removeIconShortcuts();
        if (this._monitorsChangedId > 0) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._interfaceSettings && this._interfaceSignalId > 0) {
            this._interfaceSettings.disconnect(this._interfaceSignalId);
            this._interfaceSignalId = 0;
        }
        if (this._interfaceSettings && this._accentSignalId > 0) {
            this._interfaceSettings.disconnect(this._accentSignalId);
            this._accentSignalId = 0;
        }
        this._interfaceSettings = null;
        if (this._settings && this._settingSignalIds.length > 0) {
            this._settingSignalIds.forEach(id => this._settings.disconnect(id));
            this._settingSignalIds = [];
        }
        this._settings = null;

        stopDesktopIconWatch();
        this._removeAllGrids();
        if (this._screenTimeRelease) {
            this._screenTimeRelease();
            this._screenTimeRelease = null;
        }
        clearMoodStoreCache();
        clearGeocodeCache();
        clearArtworkCaches();
        clearRssEngines();
        clearArticleImageCache();
        clearLastGoodCaches();
        clearConnectivityWatch();
        resetSystemMonitorEngines();
        clearMusicPlaybackState();
        clearMusicPolls();
        clearMusicRetainedState();
        clearPlayerControlState();
        clearEnsuredDirectories();
    }

    _migrateOldThemeSettings() {
        const currentTheme = this._settings.get_string('theme');
        if (!currentTheme || !findThemePreset(currentTheme))
            this._settings.set_string('theme', 'adwaita');
    }

    /**
     * Binds the three desktop-icon shortcuts for exactly as long as one of them is
     * selected.
     *
     * A Meta keybinding rather than a key handler on the grid: the grid only sees a key
     * press while something inside it holds focus, and a desktop icon never does, so a
     * handler there would fire only after a click and not at all in the overview.
     *
     * Mutter holds an accelerator away from every other application for as long as a
     * binding for it exists, so leaving them registered permanently would take Ctrl+X,
     * Ctrl+C and F2 out of the file manager and out of every text field for as long as the
     * extension is enabled. Registering on selection gives them up again the moment the
     * selection goes.
     */
    _watchIconSelection() {
        this._stopWatchingIconSelection = onSelectionChanged(selection => {
            if (selection)
                this._addIconShortcuts();
            else
                this._removeIconShortcuts();
        });
    }

    /**
     * Drops the desktop icon selection when a window takes focus.
     *
     * A file manager keeps its own selection, so an icon left lit here after the user has
     * moved on to a window is the one selection that is stale: the shortcuts stay bound to
     * it and nothing on screen says it is no longer what the next keystroke will act on.
     */
    _watchFocusWindow() {
        this._focusWindowId = global.display.connect('notify::focus-window', () => {
            clearIconSelection();
        });
    }

    _addIconShortcuts() {
        if (this._iconShortcutIds.length > 0)
            return;
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        this._iconShortcutIds = [
            Main.wm.addKeybinding('rename-selected-icon', this._settings, Meta.KeyBindingFlags.NONE, modes,
                () => this._actOnSelectedIcon((grid, node, widgetData) => startIconRename(grid, node, widgetData))),
            Main.wm.addKeybinding('cut-selected-icon', this._settings, Meta.KeyBindingFlags.NONE, modes,
                () => this._actOnSelectedIcon((grid, node, widgetData) => cutDesktopIcon(node, widgetData))),
            Main.wm.addKeybinding('copy-selected-icon', this._settings, Meta.KeyBindingFlags.NONE, modes,
                () => this._actOnSelectedIcon((grid, node, widgetData) => copyDesktopIcon(node, widgetData))),
        ];
    }

    _removeIconShortcuts() {
        // Checked by id: an unbound key registers no binding at all, and removing it by
        // name anyway is what mutter warns about.
        this._iconShortcutIds.forEach((id, index) => {
            if (id)
                Main.wm.removeKeybinding(ICON_SHORTCUT_NAMES[index]);
        });
        this._iconShortcutIds = [];
    }

    /** Runs an action on the selected icon. Only reachable while the bindings are held. */
    _actOnSelectedIcon(action) {
        const selection = getSelectedIcon();
        if (!selection)
            return;
        action(selection.grid, selection.actor, selection.widgetData);
    }

    _warnIfDesktopIconsExtensionEnabled() {
        const shellSettings = Gio.Settings.new('org.gnome.shell');
        const enabled = shellSettings.get_strv('enabled-extensions');
        const conflict = DESKTOP_ICON_EXTENSION_UUIDS.find(uuid => enabled.includes(uuid));
        if (conflict) {
            console.error(`Gridgets: ${conflict} draws its own desktop icons and will paint them over the grid's. Turn it off in the Extensions app to avoid seeing two sets.`);
        }
    }

    _spawnGrid(monitorIndex) {
        const grid = new DesktopGrid(this.path, this._settings, this.metadata, monitorIndex, this._interfaceSettings);
        // _backgroundGroup is private Shell API, but it is the only layer that
        // renders above the wallpaper while staying below every window; GNOME
        // Shell exposes no public accessor for that position.
        Main.layoutManager._backgroundGroup.add_child(grid);
        this._desktopGrids.push(grid);
    }

    _createAndShowGrids() {
        if (this._desktopGrids.length > 0)
            return;

        const settings = this._settings;
        const monitorMode = settings.get_string('global-monitor') || 'primary';
        const nMonitors = global.display.get_n_monitors();

        if (nMonitors === 0) {
            this._spawnGrid(null);
            return;
        }

        if (monitorMode === 'each' && nMonitors > 1) {
            for (let i = 0; i < nMonitors; i++)
                this._spawnGrid(i);
        } else if (monitorMode === 'primary') {
            this._spawnGrid(global.display.get_primary_monitor());
        } else if (monitorMode === 'all') {
            this._spawnGrid(null);
        } else {
            const targetIdx = parseInt(monitorMode, 10);
            const primaryIdx = global.display.get_primary_monitor();
            const validIdx = (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < nMonitors) ? targetIdx : primaryIdx;
            this._spawnGrid(validIdx);
        }
    }

    _removeAllGrids() {
        this._desktopGrids.forEach(grid => grid.destroy());
        this._desktopGrids = [];
    }

    _rebuildGrids() {
        this._removeAllGrids();
        this._createAndShowGrids();
    }
}
