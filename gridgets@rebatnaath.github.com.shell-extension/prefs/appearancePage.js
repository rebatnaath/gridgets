/**
 * ============================================================================
 * PREFERENCES: APPEARANCE PAGE
 * 
 * Defines global appearance defaults (aesthetics) and desktop grid layout
 * configuration.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import { buildGlobalAestheticsGroup, createSwitchRow } from './aestheticControls.js';
import { getWidgets, getMinRequiredCols, DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';
import { THEMES, applyTheme } from './themes.js';

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });

    const themeGroup = new Adw.PreferencesGroup({
        title: 'Theme Presets',
        description: 'Choose a built-in colour scheme. Themes set global defaults; per-widget overrides are preserved.',
    });

    const model = new Gtk.StringList();
    model.append('No Theme');
    THEMES.forEach(t => model.append(t.name));

    const currentThemeId = settings.get_string('theme');
    const currentIdx = currentThemeId
        ? Math.max(0, THEMES.findIndex(t => t.id === currentThemeId)) + 1
        : 0;

    const themeRow = new Adw.ComboRow({
        title: 'Color Theme',
        subtitle: 'Select a preset theme to apply across all widgets.',
        model,
        selected: currentIdx,
    });

    themeRow.connect('notify::selected', () => {
        const idx = themeRow.get_selected();
        if (idx === 0) {
            settings.set_string('theme', '');
            settings.set_string('global-background-color', DEFAULT_BG_COLOR);
            settings.set_string('global-foreground-color', DEFAULT_FG_COLOR);
            settings.set_string('global-border-color', 'rgb(255,255,255)');
            settings.set_int('border-radius', 16);
            settings.set_int('global-border-width', 0);
            return;
        }
        const theme = THEMES[idx - 1];
        if (theme) {
            applyTheme(settings, theme.id);
            settings.set_string('theme', theme.id);
        }
    });

    themeGroup.add(themeRow);
    page.add(themeGroup);

    page.add(buildGlobalAestheticsGroup(settings));

    const gridGroup = new Adw.PreferencesGroup({
        title: 'Desktop Grid Layout',
        description: 'Configure grid columns and layout visibility.',
    });

    gridGroup.add(createSwitchRow('Visualize Grid Overlay', 'Show grid lines on the desktop for easier widget alignment.', settings, 'show-grid').row);

    const customSizeItem = createSwitchRow('Custom Grid Size', 'Manually specify the number of grid columns.', settings, 'grid-custom-size');
    gridGroup.add(customSizeItem.row);

    const fetchMinCols = () => getMinRequiredCols(getWidgets(settings));

    const minRequiredCols = fetchMinCols();
    const columnsRow = new Adw.ActionRow({
        title: 'Grid Columns',
        subtitle: minRequiredCols > 6
            ? `Number of columns across screen (minimum ${minRequiredCols} required to fit current widgets without overlap).`
            : 'Number of columns across the screen (default 28).',
    });

    const columnsSpin = Gtk.SpinButton.new_with_range(minRequiredCols, 60, 1);
    columnsSpin.set_valign(Gtk.Align.CENTER);
    settings.bind('grid-columns', columnsSpin.get_adjustment(), 'value', 0);

    const updateMinBounds = () => {
        const minCols = fetchMinCols();
        columnsSpin.get_adjustment().set_lower(minCols);
        if (columnsSpin.get_value() < minCols) {
            columnsSpin.set_value(minCols);
        }
        columnsRow.set_subtitle(
            minCols > 6
                ? `Number of columns across screen (minimum ${minCols} required to fit current widgets without overlap).`
                : 'Number of columns across the screen (default 28).'
        );
    };

    const widgetsSignalId = settings.connect('changed::widgets', updateMinBounds);
    page.connect('unrealize', () => {
        if (widgetsSignalId) settings.disconnect(widgetsSignalId);
    });

    columnsRow.add_suffix(columnsSpin);
    gridGroup.add(columnsRow);

    columnsRow.set_sensitive(customSizeItem.switch.get_active());
    customSizeItem.switch.connect('notify::active', () => {
        columnsRow.set_sensitive(customSizeItem.switch.get_active());
    });

    page.add(gridGroup);
    return page;
}
