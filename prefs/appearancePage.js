import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { buildGlobalAestheticsGroup, createColorRow, createSwitchRow } from './aestheticControls.js';
import { THEMES, findThemePreset, applyTheme } from './themes.js';
import { DEFAULT_BG_COLOR, DEFAULT_FG_COLOR, resolveSystemAccentColor } from '../utils/widgetUtils.js';

function isSystemThemeSelected(settings) {
    return settings.get_string('theme') === 'adwaita';
}

function getAvailableThemes(followSystemTheme) {
    return THEMES.filter(theme => {
        if (theme.id === 'adwaita')
            return followSystemTheme;
        if (theme.id === 'adwaita-light' || theme.id === 'adwaita-dark')
            return !followSystemTheme;
        return true;
    });
}

function getThemeAccentColor(settings) {
    const themeId = settings.get_string('theme');
    if (themeId === 'custom') {
        return settings.get_string('accent-color-override')
            || resolveSystemAccentColor(Gio.Settings.new('org.gnome.desktop.interface'));
    }
    const theme = findThemePreset(themeId);
    return theme?.accent || resolveSystemAccentColor(Gio.Settings.new('org.gnome.desktop.interface'));
}

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });

    const themeGroup = new Adw.PreferencesGroup({
        title: 'Theme Presets',
        description: 'Choose a built-in colour scheme. Select Custom to edit global colours.',
    });

    const followSystemRow = new Adw.SwitchRow({
        title: 'Follow System Light/Dark Theme',
        subtitle: 'Use Adwaita System, or select a separate light or dark variant.',
    });
    followSystemRow.set_active(isSystemThemeSelected(settings));
    themeGroup.add(followSystemRow);

    const themeRow = new Adw.ComboRow({
        title: 'Color Theme',
        subtitle: 'Adwaita System follows the GNOME light/dark preference.',
    });
    themeGroup.add(themeRow);

    const backgroundRow = createColorRow('Global Background Color', 'Editable in Custom mode only.', settings, 'global-background-color', DEFAULT_BG_COLOR);
    const foregroundRow = createColorRow('Global Foreground/Text Color', 'Editable in Custom mode only.', settings, 'global-foreground-color', DEFAULT_FG_COLOR);
    themeGroup.add(backgroundRow);
    themeGroup.add(foregroundRow);

    const accentRow = new Adw.ActionRow({
        title: 'Accent Color',
        subtitle: 'Custom accent colour; predefined themes use their own accent.',
    });
    const accentButton = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const accentColor = new Gdk.RGBA();
    accentRow.add_suffix(accentButton);
    themeGroup.add(accentRow);

    let updatingThemeModel = false;

    const updateAccentButton = () => {
        accentColor.parse(getThemeAccentColor(settings));
        accentButton.set_rgba(accentColor);
    };

    const updateColorSensitivity = () => {
        const isCustom = settings.get_string('theme') === 'custom';
        backgroundRow.set_sensitive(isCustom);
        foregroundRow.set_sensitive(isCustom);
        backgroundRow.set_subtitle(isCustom ? 'Custom background applied to all widgets.' : 'Select Custom theme to edit this colour.');
        foregroundRow.set_subtitle(isCustom ? 'Custom text colour applied to all widgets.' : 'Select Custom theme to edit this colour.');
        accentRow.set_sensitive(isCustom);
        accentRow.set_subtitle(isCustom ? 'Custom accent colour applied to all widgets.' : 'Accent follows the selected predefined theme.');
        updateAccentButton();
    };

    const updateThemeModel = () => {
        if (updatingThemeModel) return;
        updatingThemeModel = true;
        try {
            const availableThemes = getAvailableThemes(followSystemRow.get_active());
            const model = new Gtk.StringList();
            availableThemes.forEach(theme => model.append(theme.name));
            themeRow.set_model(model);

            const currentThemeId = settings.get_string('theme');
            const currentIndex = availableThemes.findIndex(theme => theme.id === currentThemeId);
            themeRow.selected = currentIndex >= 0 ? currentIndex : 0;
            updateColorSensitivity();
        } finally {
            updatingThemeModel = false;
        }
    };

    accentButton.connect('color-set', () => {
        settings.set_string('accent-color-override', accentButton.get_rgba().to_string());
    });

    themeRow.connect('notify::selected', () => {
        if (updatingThemeModel) return;
        const theme = getAvailableThemes(followSystemRow.get_active())[themeRow.get_selected()];
        if (!theme) return;
        applyTheme(settings, theme.id);
        updateColorSensitivity();
    });

    followSystemRow.connect('notify::active', () => {
        const followSystemTheme = followSystemRow.get_active();
        const currentThemeId = settings.get_string('theme');
        if (followSystemTheme && currentThemeId !== 'adwaita') {
            applyTheme(settings, 'adwaita');
        } else if (!followSystemTheme && currentThemeId === 'adwaita') {
            const interfaceSettings = Gio.Settings.new('org.gnome.desktop.interface');
            const systemTheme = interfaceSettings.get_string('color-scheme');
            applyTheme(settings, systemTheme === 'prefer-light' || systemTheme === 'default' ? 'adwaita-light' : 'adwaita-dark');
        }
        updateThemeModel();
    });

    updateThemeModel();
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
