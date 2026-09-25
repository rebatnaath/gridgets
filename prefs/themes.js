import { THEME_PRESETS, findThemePreset } from '../utils/themePresets.js';

export { THEME_PRESETS as THEMES, findThemePreset } from '../utils/themePresets.js';

export function applyTheme(settings, themeId) {
    const theme = findThemePreset(themeId);
    if (!theme) return;

    if (theme.bg && theme.fg) {
        settings.set_string('global-background-color', theme.bg);
        settings.set_string('global-foreground-color', theme.fg);
    }
    if (theme.card)
        settings.set_string('global-card-color', theme.card);
    if (theme.highlight)
        settings.set_string('global-highlight-color', theme.highlight);

    if (theme.id === 'custom') {
        const lastTheme = findThemePreset(settings.get_string('last-selected-theme')) || findThemePreset('adwaita');
        if (lastTheme?.bg && lastTheme?.fg) {
            settings.set_string('global-background-color', lastTheme.bg);
            settings.set_string('global-foreground-color', lastTheme.fg);
        }
        if (lastTheme?.card)
            settings.set_string('global-card-color', lastTheme.card);
        if (lastTheme?.highlight)
            settings.set_string('global-highlight-color', lastTheme.highlight);
        if (lastTheme?.accent)
            settings.set_string('accent-color-override', lastTheme.accent);
    } else {
        settings.set_string('last-selected-theme', theme.id);
        if (theme.accent)
            settings.set_string('accent-color-override', theme.accent);
    }
    settings.set_string('theme', theme.id);
}
