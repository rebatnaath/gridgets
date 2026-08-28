import { resolveSystemSchemeColors } from '../utils/widgetUtils.js';

const SYSTEM_DARK = resolveSystemSchemeColors('prefer-dark');
const SYSTEM_LIGHT = resolveSystemSchemeColors('prefer-light');

export const THEMES = [
    {
        id: 'adwaita-dark',
        name: 'Adwaita Dark',
        ...SYSTEM_DARK,
        accent: '#3584e4',
    },
    {
        id: 'adwaita-light',
        name: 'Adwaita Light',
        ...SYSTEM_LIGHT,
        accent: '#3584e4',
    },
    {
        id: 'catppuccin-mocha',
        name: 'Catppuccin Mocha',
        bg: '#1e1e2e',
        fg: '#cdd6f4',
        accent: '#cba6f7',
    },
    {
        id: 'catppuccin-latte',
        name: 'Catppuccin Latte',
        bg: '#eff1f5',
        fg: '#4c4f69',
        accent: '#8839ef',
    },
    {
        id: 'gruvbox-dark',
        name: 'Gruvbox Dark',
        bg: '#282828',
        fg: '#ebdbb2',
        accent: '#458588',
    },
    {
        id: 'gruvbox-light',
        name: 'Gruvbox Light',
        bg: '#f2f5e9',
        fg: '#3c3836',
        accent: '#458588',
    },
    {
        id: 'dracula',
        name: 'Dracula',
        bg: '#282a36',
        fg: '#f8f8f2',
        accent: '#bd93f9',
    },
    {
        id: 'nord',
        name: 'Nord',
        bg: '#2e3440',
        fg: '#eceff4',
        accent: '#5e81ac',
    },
    {
        id: 'rose-pine',
        name: 'Rosé Pine',
        bg: '#191724',
        fg: '#e0def4',
        accent: '#c4a7e7',
    },
    {
        id: 'everforest-dark',
        name: 'Everforest Dark',
        bg: '#2d353b',
        fg: '#d3c6aa',
        accent: '#a7c08d',
    },
];

export function applyTheme(settings, themeId) {
    const theme = THEMES.find(t => t.id === themeId);
    if (!theme) return;

    settings.set_string('global-background-color', theme.bg);
    settings.set_string('global-foreground-color', theme.fg);
    settings.set_string('accent-color-override', theme.accent);
}
