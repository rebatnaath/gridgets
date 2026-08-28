import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import { buildGlobalAestheticsGroup, createSwitchRow } from './aestheticControls.js';
import { DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';
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
    const matchedThemeIndex = THEMES.findIndex(t => t.id === currentThemeId);
    const currentIdx = currentThemeId && matchedThemeIndex !== -1 ? matchedThemeIndex + 1 : 0;

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
            settings.set_string('accent-color-override', '');
            return;
        }
        const theme = THEMES[idx - 1];
        if (theme) {
            applyTheme(settings, theme.id);
            settings.set_string('theme', theme.id);
        }
    });

    themeGroup.add(themeRow);

    const accentRow = new Adw.ActionRow({
        title: 'Accent Color Override',
        subtitle: 'Manually set the accent color. Leave empty to use the system or theme default.',
    });
    const accentBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const accentRgba = new Gdk.RGBA();
    const currentAccent = settings.get_string('accent-color-override');
    accentRgba.parse(currentAccent || '#3584e4');
    accentBtn.set_rgba(accentRgba);
    accentBtn.connect('color-set', () => {
        settings.set_string('accent-color-override', accentBtn.get_rgba().to_string());
    });
    accentRow.add_suffix(accentBtn);
    themeGroup.add(accentRow);

    page.add(themeGroup);

    page.add(buildGlobalAestheticsGroup(settings));

    const gridGroup = new Adw.PreferencesGroup({
        title: 'Desktop Grid Layout',
        description: 'Configure desktop grid layout visibility.',
    });

    gridGroup.add(createSwitchRow('Visualize Grid Overlay', 'Show grid lines on the desktop for easier widget alignment.', settings, 'show-grid').row);

    page.add(gridGroup);
    return page;
}
