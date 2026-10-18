import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { buildTypographyGroup, createSwitchRow, createColorRow } from './aestheticControls.js';
import { THEMES, findThemePreset, applyTheme } from './themes.js';
import { DEFAULT_BG_COLOR, DEFAULT_FG_COLOR, resolveSystemAccentColor, resolveSurfaceShades } from '../utils/widgetUtils.js';

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

const PALETTE_SWATCH_SIZE_PX = 30;
const PALETTE_SWATCH_RADIUS_PX = 8;
// A preset theme fixes the colours, so the swatches fade back to read as uneditable.
const PALETTE_DISABLED_OPACITY = 0.55;

/**
 * A single Palette row replaces the five per-colour rows: one swatch per colour in the
 * order the subtitle names them. The swatches carry no label, so a tooltip is the only
 * thing that says which colour each one is, and only the custom theme can be edited
 * because a preset theme owns its own colours.
 */
function buildPaletteRow(settings, interfaceSettings) {
    const row = new Adw.ActionRow({ title: 'Palette' });
    const swatchBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(swatchBox);

    // Preview values for the surface swatches when nothing is stored yet. Prefer the
    // active preset's own surfaces so the swatch previews what the widget will use, and
    // only fall back to deriving when the preset omits them.
    const activeTheme = findThemePreset(settings.get_string('theme'));
    const previewSurfaces = activeTheme?.card && activeTheme?.highlight
        ? { card: activeTheme.card, highlight: activeTheme.highlight }
        : resolveSurfaceShades(settings.get_string('global-background-color') || DEFAULT_BG_COLOR);

    const definitions = [
        { label: 'Background Color', key: 'global-background-color', fallback: DEFAULT_BG_COLOR },
        { label: 'Card Color', key: 'global-card-color', fallback: previewSurfaces.card },
        { label: 'Highlight Color', key: 'global-highlight-color', fallback: previewSurfaces.highlight },
        { label: 'Text Color', key: 'global-foreground-color', fallback: DEFAULT_FG_COLOR },
        { label: 'Accent Color', key: 'accent-color-override', fallback: resolveSystemAccentColor(interfaceSettings) },
    ];

    const isCustomTheme = () => settings.get_string('theme') === 'custom';
    const readColor = def => settings.get_string(def.key) || def.fallback;

    const swatches = definitions.map(def => {
        const area = new Gtk.DrawingArea({
            width_request: PALETTE_SWATCH_SIZE_PX,
            height_request: PALETTE_SWATCH_SIZE_PX,
            valign: Gtk.Align.CENTER,
        });
        const rgba = new Gdk.RGBA();
        rgba.parse(readColor(def));

        // GTK's own tooltip waits out a system delay before showing. A swatch is tiny, so
        // the name is shown on a popover the moment the pointer arrives instead.
        const labelPopover = new Gtk.Popover({ autohide: false, has_arrow: true });
        labelPopover.set_child(new Gtk.Label({
            label: def.label,
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 12,
            margin_end: 12,
        }));
        labelPopover.set_parent(area);
        const hover = new Gtk.EventControllerMotion();
        area.add_controller(hover);
        hover.connect('enter', () => labelPopover.popup());
        hover.connect('leave', () => labelPopover.popdown());
        area.connect('destroy', () => labelPopover.unparent());

        area.set_draw_func((widget, cr, width, height) => {
            const radius = PALETTE_SWATCH_RADIUS_PX;
            cr.newSubPath();
            cr.arc(radius, radius, radius, Math.PI, 1.5 * Math.PI);
            cr.arc(width - radius, radius, radius, 1.5 * Math.PI, 2 * Math.PI);
            cr.arc(width - radius, height - radius, radius, 0, 0.5 * Math.PI);
            cr.arc(radius, height - radius, radius, 0.5 * Math.PI, Math.PI);
            cr.closePath();
            cr.setSourceRGBA(rgba.red, rgba.green, rgba.blue, rgba.alpha);
            cr.fillPreserve();
            // A faint rim keeps a swatch readable when its colour matches the page.
            cr.setSourceRGBA(0, 0, 0, 0.15);
            cr.setLineWidth(1);
            cr.stroke();
        });

        const click = new Gtk.GestureClick();
        area.add_controller(click);
        click.connect('released', () => {
            if (!isCustomTheme()) {
                // A preset owns its colours, so the click cannot do anything; say so
                // rather than leaving it looking broken.
                const theme = findThemePreset(settings.get_string('theme'));
                row.get_root().add_toast(new Adw.Toast({
                    title: `${theme ? theme.name : 'The selected theme'} sets these colors. Choose the Custom theme to edit them.`,
                }));
                return;
            }

            const initial = new Gdk.RGBA();
            initial.parse(readColor(def));
            const dialog = new Gtk.ColorDialog({ with_alpha: true, modal: true });
            dialog.choose_rgba(row.get_root(), initial, null, (source, result) => {
                let chosen = null;
                try {
                    chosen = source.choose_rgba_finish(result);
                } catch (error) {
                    // Closing the picker without choosing is expected, not a failure.
                    return;
                }
                if (chosen)
                    settings.set_string(def.key, chosen.to_string());
            });
        });

        swatchBox.append(area);
        return { area, rgba, def };
    });

    const refresh = () => {
        const editable = isCustomTheme();
        for (const { area, rgba, def } of swatches) {
            rgba.parse(readColor(def));
            area.set_opacity(editable ? 1 : PALETTE_DISABLED_OPACITY);
            area.queue_draw();
        }
        const theme = findThemePreset(settings.get_string('theme'));
        row.set_subtitle(isCustomTheme()
            ? 'Background, card, highlight, text, accent. Used by widgets in the custom theme.'
            : `Background, card, highlight, text, accent. Set by the ${theme ? theme.name : 'selected'} theme.`);
    };
    refresh();

    // The colour keys are rewritten when a theme is chosen, but watching the theme as
    // well covers two presets that share a colour so the subtitle still follows.
    const watchedKeys = [...definitions.map(def => def.key), 'theme'];
    const changedIds = watchedKeys.map(key => settings.connect(`changed::${key}`, refresh));
    row.connect('destroy', () => {
        for (const id of changedIds)
            settings.disconnect(id);
    });

    return row;
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

    group.add(buildPaletteRow(settings, interfaceSettings));

    let updatingThemeModel = false;

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
        } finally {
            updatingThemeModel = false;
        }
    };

    themeRow.connect('notify::selected', () => {
        if (updatingThemeModel)
            return;
        const theme = getAvailableThemes(followSystemRow.get_active())[themeRow.get_selected()];
        if (!theme)
            return;
        applyTheme(settings, theme.id);
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

function buildImageGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Images',
        description: 'Configure image and slideshow widgets.',
    });
    group.add(createSwitchRow(
        'Animate GIFs',
        'Play animated GIFs automatically.',
        settings,
        'image-animate-gif'
    ).row);
    group.add(createSwitchRow(
        'Show Image Captions',
        'Show captions on image and GIF widgets.',
        settings,
        'image-show-caption'
    ).row);
    group.add(createSwitchRow(
        'Show Slideshow Captions',
        'Show captions on slideshow widgets.',
        settings,
        'slideshow-show-caption'
    ).row);
    group.add(createSwitchRow(
        'Caption Scrim',
        'Fade a dark gradient behind image and slideshow captions so they stay readable over a light picture.',
        settings,
        'image-caption-scrim'
    ).row);
    group.add(createColorRow(
        'Caption Text Color',
        'Caption colour for image and slideshow widgets that follow the global setting.',
        settings,
        'global-caption-color',
        '#ffffff'
    ));
    return group;
}

function buildWeatherGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Weather',
        description: 'Configure weather widget appearance.',
    });
    group.add(createSwitchRow(
        'Dynamic Weather Color',
        'Adjust widget colors for the current weather and time.',
        settings,
        'weather-dynamic-color'
    ).row);
    group.add(createSwitchRow(
        'Dynamic Weather Overlay',
        'Show an overlay image based on weather conditions.',
        settings,
        'weather-dynamic-image'
    ).row);
    return group;
}

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });
    const interfaceSettings = Gio.Settings.new('org.gnome.desktop.interface');

    page.add(buildThemeGroup(settings, interfaceSettings));
    page.add(buildTypographyGroup(settings));
    page.add(buildImageGroup(settings));
    page.add(buildWeatherGroup(settings));

    return page;
}
