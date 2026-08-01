/**
 * ============================================================================
 * PREFERENCES ENTRY POINT
 * 
 * Main ExtensionPreferences implementation for GNOME 45+.
 * Delegates page construction to modular handlers in the prefs/ directory.
 * ============================================================================
 */

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildAppearancePage } from './prefs/appearancePage.js';
import { buildStorePage } from './prefs/storePage.js';
import { buildGlobalSettingsPage } from './prefs/globalSettingsPage.js';
import { buildIndividualSettingsPage } from './prefs/individualSettingsPage.js';

export default class GridgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 600);
        window.set_search_enabled(true);

        const settings = this.getSettings();
        const extensionPath = this.path || this.dir.get_path();

        window.add(buildStorePage(window, settings, extensionPath));
        window.add(buildAppearancePage(settings));
        window.add(buildGlobalSettingsPage(settings));
        window.add(buildIndividualSettingsPage(window, settings));
    }
}
