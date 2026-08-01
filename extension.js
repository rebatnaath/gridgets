// This project uses llms as a helper such as in creating templates, boilerplate and auto-complete while
// majority of the code is still written and verified by a human.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DesktopGrid } from './desktopGrid.js';
import { ScreenTimeIndicator } from './widgets/panel/screenTime.js';
import { StorePanelButton } from './widgets/panel/storePanel.js';

export default class GridgetsExtension extends Extension {
    enable() {
        this._desktopGrids = [];
        this._monitorsChangedId = 0;
        this._settingSignalIds = [];
        this._screenTimeIndicator = null;
        this._storePanelButton = null;
        this._settings = this.getSettings();

        this._settingSignalIds.push(
            this._settings.connect('changed::global-monitor', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::panel-screen-time', () => this._syncPanelWidgets())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::panel-store-button', () => this._syncPanelWidgets())
        );

        this._createAndShowGrids();
        this._syncPanelWidgets();

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._rebuildGrids();
        });
    }

    disable() {
        if (this._monitorsChangedId > 0) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._settings && this._settingSignalIds.length > 0) {
            this._settingSignalIds.forEach(id => this._settings.disconnect(id));
            this._settingSignalIds = [];
        }
        this._settings = null;

        this._removeAllGrids();
        this._removeScreenTimeIndicator();
        this._removeStorePanelButton();
    }

    _syncPanelWidgets() {
        const screenTimeEnabled = this._settings.get_boolean('panel-screen-time');
        if (screenTimeEnabled && !this._screenTimeIndicator) {
            this._screenTimeIndicator = new ScreenTimeIndicator();
            Main.panel.addToStatusArea('gridgets-screen-time', this._screenTimeIndicator);
            this._screenTimeIndicator.menu.connect('open-state-changed', (_menu, isOpen) => {
                this._screenTimeIndicator._onOpenStateChanged(_menu, isOpen);
            });
        } else if (!screenTimeEnabled) {
            this._removeScreenTimeIndicator();
        }

        const storeEnabled = this._settings.get_boolean('panel-store-button');
        if (storeEnabled && !this._storePanelButton) {
            this._storePanelButton = new StorePanelButton(this._settings);
            Main.panel.addToStatusArea('gridgets-store', this._storePanelButton);
        } else if (!storeEnabled) {
            this._removeStorePanelButton();
        }
    }

    _removeScreenTimeIndicator() {
        if (this._screenTimeIndicator) {
            this._screenTimeIndicator.destroy();
            this._screenTimeIndicator = null;
        }
    }

    _removeStorePanelButton() {
        if (this._storePanelButton) {
            this._storePanelButton.destroy();
            this._storePanelButton = null;
        }
    }

    _createAndShowGrids() {
        if (this._desktopGrids.length > 0)
            return;

        const settings = this._settings || this.getSettings();
        const monitorMode = settings.get_string('global-monitor') || 'primary';
        const nMonitors = global.display.get_n_monitors();

        if (nMonitors === 0) {
            const grid = new DesktopGrid(this.path, settings, this.metadata, null);
            Main.layoutManager._backgroundGroup.add_child(grid);
            this._desktopGrids.push(grid);
            return;
        }

        if (monitorMode === 'each' && nMonitors > 1) {
            for (let i = 0; i < nMonitors; i++) {
                const grid = new DesktopGrid(this.path, settings, this.metadata, i);
                Main.layoutManager._backgroundGroup.add_child(grid);
                this._desktopGrids.push(grid);
            }
        } else if (monitorMode === 'primary') {
            const primaryIdx = global.display.get_primary_monitor();
            const grid = new DesktopGrid(this.path, settings, this.metadata, primaryIdx);
            Main.layoutManager._backgroundGroup.add_child(grid);
            this._desktopGrids.push(grid);
        } else if (monitorMode === 'all') {
            const grid = new DesktopGrid(this.path, settings, this.metadata, null);
            Main.layoutManager._backgroundGroup.add_child(grid);
            this._desktopGrids.push(grid);
        } else {
            const targetIdx = parseInt(monitorMode, 10);
            const primaryIdx = global.display.get_primary_monitor();
            const validIdx = (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < nMonitors) ? targetIdx : primaryIdx;
            const grid = new DesktopGrid(this.path, settings, this.metadata, validIdx);
            Main.layoutManager._backgroundGroup.add_child(grid);
            this._desktopGrids.push(grid);
        }
    }

    _removeAllGrids() {
        this._desktopGrids.forEach(grid => {
            if (grid.parent) {
                grid.parent.remove_child(grid);
            }
            grid.destroy();
        });
        this._desktopGrids = [];
    }

    _rebuildGrids() {
        this._removeAllGrids();
        this._createAndShowGrids();
    }
}
