export const THEMES = [
    {
        id: 'gruvbox-dark',
        name: 'Gruvbox Dark',
        bg: '#282828',
        fg: '#ebdbb2',
        borderColor: '#d79921',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'gruvbox-light',
        name: 'Gruvbox Light',
        bg: '#fbf1c7',
        fg: '#3c3836',
        borderColor: '#b57614',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'catppuccin-mocha',
        name: 'Catppuccin Mocha',
        bg: '#1e1e2e',
        fg: '#cdd6f4',
        borderColor: '#89b4fa',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'catppuccin-latte',
        name: 'Catppuccin Latte',
        bg: '#eff1f5',
        fg: '#4c4f69',
        borderColor: '#1e66f5',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'nord',
        name: 'Nord',
        bg: '#2e3440',
        fg: '#d8dee9',
        borderColor: '#88c0d0',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'tokyo-night',
        name: 'Tokyo Night',
        bg: '#1a1b26',
        fg: '#a9b1d6',
        borderColor: '#7aa2f7',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'solarized-dark',
        name: 'Solarized Dark',
        bg: '#002b36',
        fg: '#839496',
        borderColor: '#268bd2',
        borderRadius: 16,
        borderWidth: 1,
    },
    {
        id: 'dracula',
        name: 'Dracula',
        bg: '#282a36',
        fg: '#f8f8f2',
        borderColor: '#bd93f9',
        borderRadius: 16,
        borderWidth: 1,
    },
];

export function applyTheme(settings, themeId) {
    const theme = THEMES.find(t => t.id === themeId);
    if (!theme) return;

    const currentBg = settings.get_string('global-background-color');
    const currentFg = settings.get_string('global-foreground-color');
    if (currentBg === theme.bg && currentFg === theme.fg)
        return;

    settings.set_string('global-background-color', theme.bg);
    settings.set_string('global-foreground-color', theme.fg);
    settings.set_string('global-border-color', theme.borderColor);
    settings.set_int('border-radius', theme.borderRadius);
    settings.set_int('global-border-width', theme.borderWidth);
}
