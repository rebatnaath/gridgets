import { THEME_PRESETS, findThemePreset } from '../utils/themePresets.js';

export { THEME_PRESETS as THEMES, findThemePreset } from '../utils/themePresets.js';

export function applyTheme(settings, themeId) {
    const theme = findThemePreset(themeId);
    if (!theme) return;

    if (theme.bg && theme.fg) {
        settings.set_string('global-background-color', theme.bg);
        settings.set_string('global-foreground-color', theme.fg);
    }
    if (theme.id === 'custom') {
        settings.set_string('global-background-color', '#222226');
        settings.set_string('global-foreground-color', '#ffffff');
        settings.set_string('accent-color-override', '');
    } else if (theme.accent) {
        settings.set_string('accent-color-override', theme.accent);
    }
    settings.set_string('theme', theme.id);
}
