import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildAppearancePage } from './prefs/appearancePage.js';
import { buildStorePage } from './prefs/storePage.js';
import { buildGlobalSettingsPage } from './prefs/globalSettingsPage.js';
import { buildIndividualSettingsPage } from './prefs/individualSettingsPage.js';
import { buildInsightsPage } from './prefs/insightsPage.js';

/** Returns a window size that always fits the primary monitor with margins. */
function fitWindowToMonitor() {
    const DEFAULT_W = 800;
    const DEFAULT_H = 600;
    const display = Gdk.Display.get_default();
    if (!display) return { width: DEFAULT_W, height: DEFAULT_H, smallScreen: false };

    const monitors = display.get_monitors();
    if (monitors.get_n_items() === 0) return { width: DEFAULT_W, height: DEFAULT_H, smallScreen: false };

    const monitor = monitors.get_item(0);
    // get_geometry() already reports logical (application) pixels.
    const geometry = monitor.get_geometry();
    const usableWidth = geometry.width;
    const usableHeight = geometry.height;

    return {
        width: Math.min(DEFAULT_W, Math.floor(usableWidth * 0.9)),
        height: Math.min(DEFAULT_H, Math.floor(usableHeight * 0.85)),
        smallScreen: usableWidth < 1100 || usableHeight < 750,
    };
}

export default class GridgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const { width, height, smallScreen } = fitWindowToMonitor();
        // AdwPreferencesWindow is a breakpoint window: it has NO minimum size
        // of its own, and libadwaita requires width/height-request to be set
        // explicitly (they define the smallest supported size). Without them,
        // Adwaita logs "exceeds AdwBreakpointBin width" on every resize pass.
        const reqWidth = Math.min(width, 800);
        const reqHeight = Math.min(height, 600);
        window.width_request = reqWidth;
        window.height_request = reqHeight;
        window.set_default_size(width, height);
        // On small screens (e.g. nested-shell testing) a fixed-size window is
        // cramped or overflows; fill the monitor instead.
        if (smallScreen)
            window.maximize();
        window.set_search_enabled(true);

        const settings = this.getSettings();
        const extensionPath = this.path;

        const pages = [
            ['Store', buildStorePage(window, settings, extensionPath)],
            ['Appearance', buildAppearancePage(settings)],
            ['Global', buildGlobalSettingsPage(settings)],
            ['Individual', buildIndividualSettingsPage(window, settings)],
            ['Insights', buildInsightsPage(settings)],
        ];

        for (const [name, page] of pages) {
            window.add(page);
        }
    }
}
