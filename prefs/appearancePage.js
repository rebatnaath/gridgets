import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { buildGlobalAestheticsGroup, createColorRow, createSwitchRow } from './aestheticControls.js';
import { THEMES, findThemePreset, applyTheme } from './themes.js';
import { CALENDAR_WEEKDAY_NAMES, DEFAULT_BG_COLOR, DEFAULT_FG_COLOR, resolveSystemAccentColor, resolveSurfaceShades } from '../utils/widgetUtils.js';

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

function getThemeAccentColor(settings, interfaceSettings) {
    const themeId = settings.get_string('theme');
    if (themeId === 'custom') {
        return settings.get_string('accent-color-override')
            || resolveSystemAccentColor(interfaceSettings);
    }
    const theme = findThemePreset(themeId);
    return theme?.accent || resolveSystemAccentColor(interfaceSettings);
}

function buildThemeGroup(settings, interfaceSettings) {
    const group = new Adw.PreferencesGroup({
        title: 'Theme',
        description: 'Choose a color theme for the desktop grid and widgets.',
    });

    const followSystemRow = new Adw.SwitchRow({
        title: 'Follow System Light/Dark Theme',
        subtitle: 'Use the system appearance.',
    });
    followSystemRow.set_active(isSystemThemeSelected(settings));
    group.add(followSystemRow);

    const themeRow = new Adw.ComboRow({
        title: 'Color Theme',
        subtitle: 'Select a predefined theme.',
    });
    group.add(themeRow);

    const backgroundRow = createColorRow(
        'Background Color',
        'Used by widgets in the custom theme.',
        settings,
        'global-background-color',
        DEFAULT_BG_COLOR
    );
    const foregroundRow = createColorRow(
        'Text Color',
        'Used by widgets in the custom theme.',
        settings,
        'global-foreground-color',
        DEFAULT_FG_COLOR
    );
    // Preview values for the surface pickers when nothing is stored yet. Prefer
    // the active preset's own surfaces so the swatch previews what the widget
    // will use, and only fall back to deriving when the preset omits them.
    const activeTheme = findThemePreset(settings.get_string('theme'));
    const previewSurfaces = activeTheme?.card && activeTheme?.highlight
        ? { card: activeTheme.card, highlight: activeTheme.highlight }
        : resolveSurfaceShades(settings.get_string('global-background-color') || DEFAULT_BG_COLOR);

    const cardRow = createColorRow(
        'Card Color',
        'Raised surfaces such as headers and secondary buttons.',
        settings,
        'global-card-color',
        previewSurfaces.card
    );
    const highlightRow = createColorRow(
        'Highlight Color',
        'Active states, borders and chart tracks.',
        settings,
        'global-highlight-color',
        previewSurfaces.highlight
    );
    group.add(backgroundRow);
    group.add(foregroundRow);
    group.add(cardRow);
    group.add(highlightRow);

    const accentRow = new Adw.ActionRow({
        title: 'Accent Color',
        subtitle: 'Used for highlights and selected values.',
    });
    const accentButton = new Gtk.ColorButton({
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Choose the custom accent color',
    });
    const accentColor = new Gdk.RGBA();
    accentRow.add_suffix(accentButton);
    group.add(accentRow);

    let updatingThemeModel = false;

    const updateAccentButton = () => {
        accentColor.parse(getThemeAccentColor(settings, interfaceSettings));
        accentButton.set_rgba(accentColor);
    };

    const updateColorSensitivity = () => {
        const isCustom = settings.get_string('theme') === 'custom';
        backgroundRow.set_sensitive(isCustom);
        foregroundRow.set_sensitive(isCustom);
        cardRow.set_sensitive(isCustom);
        highlightRow.set_sensitive(isCustom);
        accentRow.set_sensitive(isCustom);
        backgroundRow.set_subtitle(isCustom
            ? 'Used by widgets in the custom theme.'
            : 'Available in the custom theme.');
        foregroundRow.set_subtitle(isCustom
            ? 'Used by widgets in the custom theme.'
            : 'Available in the custom theme.');
        cardRow.set_subtitle(isCustom
            ? 'Raised surfaces such as headers and secondary buttons.'
            : 'Defined by the selected theme.');
        highlightRow.set_subtitle(isCustom
            ? 'Active states, borders and chart tracks.'
            : 'Defined by the selected theme.');
        accentRow.set_subtitle(isCustom
            ? 'Used for highlights and selected values.'
            : 'Defined by the selected theme.');
        updateAccentButton();
    };

    const updateThemeModel = () => {
        if (updatingThemeModel)
            return;
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
        if (updatingThemeModel)
            return;
        const theme = getAvailableThemes(followSystemRow.get_active())[themeRow.get_selected()];
        if (!theme)
            return;
        applyTheme(settings, theme.id);
        updateColorSensitivity();
    });

    followSystemRow.connect('notify::active', () => {
        const followSystemTheme = followSystemRow.get_active();
        const currentThemeId = settings.get_string('theme');
        if (followSystemTheme && currentThemeId !== 'adwaita') {
            applyTheme(settings, 'adwaita');
        } else if (!followSystemTheme && currentThemeId === 'adwaita') {
            const systemTheme = interfaceSettings.get_string('color-scheme');
            applyTheme(settings, systemTheme === 'prefer-light' || systemTheme === 'default'
                ? 'adwaita-light'
                : 'adwaita-dark');
        }
        updateThemeModel();
    });

    updateThemeModel();
    return group;
}

function buildDesktopGridGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop Grid',
        description: 'Configure how widgets are aligned on the desktop.',
    });
    group.add(createSwitchRow(
        'Show Grid Overlay',
        'Display alignment guides while editing the desktop.',
        settings,
        'show-grid'
    ).row);
    return group;
}

function buildCalendarGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Calendar',
        description: 'Customize the month calendar appearance.',
    });

    const firstDayRow = new Adw.ComboRow({
        title: 'First Day of Week',
        subtitle: 'Use the calendar default or choose a day.',
        model: new Gtk.StringList({
            strings: ['Calendar default', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        }),
    });
    firstDayRow.selected = Math.max(0, settings.get_int('calendar-first-day') + 1);
    firstDayRow.connect('notify::selected', () => {
        settings.set_int('calendar-first-day', firstDayRow.selected - 1);
    });
    group.add(firstDayRow);

    const accentWeekendRow = createSwitchRow(
        'Accent Weekend Days',
        'Highlight the selected weekend columns.',
        settings,
        'calendar-weekend-accent'
    ).row;
    group.add(accentWeekendRow);

    const selectedWeekendDays = new Set(
        settings.get_strv('calendar-weekend-days')
            .filter(day => CALENDAR_WEEKDAY_NAMES.includes(day))
    );
    const weekendRows = [];
    let updatingWeekendDays = false;

    const updateWeekendRows = () => {
        const enabled = settings.get_boolean('calendar-weekend-accent');
        weekendRows.forEach(row => row.set_sensitive(enabled));
    };

    CALENDAR_WEEKDAY_NAMES.forEach(dayName => {
        const row = new Adw.SwitchRow({
            title: dayName[0].toUpperCase() + dayName.slice(1),
        });
        row.set_active(selectedWeekendDays.has(dayName));
        row.connect('notify::active', () => {
            if (updatingWeekendDays)
                return;
            if (row.get_active()) {
                if (selectedWeekendDays.size >= 2) {
                    updatingWeekendDays = true;
                    row.set_active(false);
                    updatingWeekendDays = false;
                    return;
                }
                selectedWeekendDays.add(dayName);
            } else {
                selectedWeekendDays.delete(dayName);
            }
            settings.set_strv('calendar-weekend-days', [...selectedWeekendDays]);
        });
        weekendRows.push(row);
        group.add(row);
    });

    updateWeekendRows();
    const weekendSettingsId = settings.connect('changed::calendar-weekend-accent', updateWeekendRows);
    group.connect('destroy', () => settings.disconnect(weekendSettingsId));
    return group;
}

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });
    const interfaceSettings = Gio.Settings.new('org.gnome.desktop.interface');

    page.add(buildThemeGroup(settings, interfaceSettings));
    page.add(buildGlobalAestheticsGroup(settings));
    page.add(buildDesktopGridGroup(settings));
    page.add(buildCalendarGroup(settings));

    return page;
}
