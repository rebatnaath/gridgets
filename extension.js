/**
 * GRIDGETS EXTENSION MAIN ENTRY POINT
 * Subclasses GNOME Shell 45+ Extension class to manage DesktopGrid lifecycle.
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DesktopGrid } from './desktopGrid.js';

export default class GridgetsExtension extends Extension {
    enable() {
        this._desktopGrid = null;
        this._monitorsChangedId = 0;

        this._createAndShowGrid();

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._rebuildGrid();
        });
    }

    disable() {
        if (this._monitorsChangedId > 0) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        this._removeGrid();
    }

    _createAndShowGrid() {
        if (this._desktopGrid)
            return;

        const settings = this.getSettings('org.gnome.shell.extensions.gridgets');
        this._desktopGrid = new DesktopGrid(this.path, settings, this.metadata);
        Main.layoutManager._backgroundGroup.add_child(this._desktopGrid);
    }

    _removeGrid() {
        if (!this._desktopGrid)
            return;

        Main.layoutManager._backgroundGroup.remove_child(this._desktopGrid);
        this._desktopGrid.destroy();
        this._desktopGrid = null;
    }

    _rebuildGrid() {
        this._removeGrid();
        this._createAndShowGrid();
    }
}