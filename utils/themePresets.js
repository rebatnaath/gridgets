export const THEME_PRESETS = Object.freeze([
    { id: 'adwaita', name: 'Adwaita (System)' },
    { id: 'adwaita-light', name: 'Adwaita Light', bg: '#fafafb', fg: '#323237', card: '#ebebed', highlight: '#dfdfe1' },
    { id: 'adwaita-dark', name: 'Adwaita Dark', bg: '#222226', fg: '#ffffff', card: '#343437', highlight: '#4e4e51' },
    { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', bg: '#1e1e2e', fg: '#cdd6f4', card: '#30303f', highlight: '#4b4b58', accent: '#cba6f7' },
    { id: 'catppuccin-latte', name: 'Catppuccin Latte', bg: '#eff1f5', fg: '#4c4f69', card: '#e3e5e9', highlight: '#d2d4d8', accent: '#8839ef' },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', bg: '#282828', fg: '#ebdbb2', card: '#393939', highlight: '#535353', accent: '#458588' },
    { id: 'gruvbox-light', name: 'Gruvbox Light', bg: '#f2f5e9', fg: '#3c3836', card: '#e6e9dd', highlight: '#d5d8cd', accent: '#458588' },
    { id: 'nord', name: 'Nord', bg: '#2e3440', fg: '#eceff4', card: '#3f444f', highlight: '#585d66', accent: '#5e81ac' },
    { id: 'rose-pine', name: 'Rosé Pine', bg: '#191724', fg: '#e0def4', card: '#2b2a36', highlight: '#474550', accent: '#c4a7e7' },
    { id: 'everforest-dark', name: 'Everforest Dark', bg: '#2d353b', fg: '#d3c6aa', card: '#3e454b', highlight: '#575d62', accent: '#a7c08d' },
    { id: 'dracula', name: 'Dracula', bg: '#282a36', fg: '#f8f8f2', card: '#393b46', highlight: '#53555e', accent: '#bd93f9' },
    { id: 'custom', name: 'Custom' },
]);

export function findThemePreset(themeId) {
    return THEME_PRESETS.find(theme => theme.id === themeId) || null;
}
