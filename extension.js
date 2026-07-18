/**
 * ============================================================================
 * EXTENSION ENTRY POINT 
 * 
 * This file is the main entry point for the GNOME Shell extension. It handles
 * the initialization, enabling, and disabling of the extension, as well as
 * listening to monitor changes to adjust the desktop grid dynamically.
 * ============================================================================
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DesktopGrid } from './desktopGrid.js';

export default class GridgetsExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this.desktopGrid = null;
        this.monitorsChangedId = null;
        this.settings = null;
    }

    enable() {
        this.settings = this.getSettings('org.gnome.shell.extensions.gridgets');
        this.createAndShowGrid();

        this.monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed',
            () => this.rebuildGrid()
        );
    }

    disable() {
        if (this.monitorsChangedId !== null) {
            Main.layoutManager.disconnect(this.monitorsChangedId);
            this.monitorsChangedId = null;
        }
        
        this.removeGrid();
        this.settings = null;
    }

    createAndShowGrid() {
        this.desktopGrid = new DesktopGrid(this.settings, this.dir.get_path());
        Main.layoutManager._backgroundGroup.add_child(this.desktopGrid.container);
    }

    removeGrid() {
        if (this.desktopGrid !== null) {
            Main.layoutManager._backgroundGroup.remove_child(this.desktopGrid.container);
            this.desktopGrid.destroy();
            this.desktopGrid = null;
        }
    }

    rebuildGrid() {
        this.removeGrid();
        this.createAndShowGrid();
    }
}