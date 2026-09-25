import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { DEFAULT_FONT_FAMILY, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';

// Fallback point size when input has no explicit size.
const DEFAULT_FONT_SIZE_PT = 11;

// Applies DEFAULT_FONT_SIZE_PT when the input carries no explicit size.
export function createNormalizedFontDescription(currentFont) {
    const cleaned = (currentFont || '').replace(/'/g, '').replace(/, sans-serif/i, '').trim();
    const fontDesc = cleaned
        ? Pango.FontDescription.from_string(cleaned)
        : new Pango.FontDescription();
    if (fontDesc.get_size() === 0)
        fontDesc.set_size(DEFAULT_FONT_SIZE_PT * Pango.SCALE);
    return fontDesc;
}

export function createColorRow(title, subtitle, settings, key, defaultVal = DEFAULT_FG_COLOR) {
    const row = new Adw.ActionRow({ title, subtitle });
    const btn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const rgba = new Gdk.RGBA();
    // An unset value falls back to a preview colour so the swatch still shows
    // what the widget will actually use instead of a blank one.
    const fallback = defaultVal || DEFAULT_FG_COLOR;
    const refresh = () => {
        const current = settings.get_string(key) || fallback;
        // Keep the last good colour if the stored value cannot be parsed.
        if (rgba.parse(current))
            btn.set_rgba(rgba);
    };
    refresh();
    btn.connect('color-set', () => {
        settings.set_string(key, btn.get_rgba().to_string());
    });
    // Selecting a different theme rewrites these keys, so the swatch has to
    // follow it or it keeps showing the previously selected theme's colour.
    settings.connect(`changed::${key}`, refresh);
    row.add_suffix(btn);
    return row;
}

export function createSwitchRow(title, subtitle, settings, key) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return { row };
}

export function buildGlobalAestheticsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Aesthetics',
        description: 'Tweak the default visual style applied to all widgets.',
    });

    const useCustomFontRow = new Adw.SwitchRow({
        title: 'Use Custom Font',
        subtitle: 'Enable to use a custom font family instead of the system default.',
    });
    settings.bind('global-use-custom-font', useCustomFontRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(useCustomFontRow);

    const fontRow = new Adw.ActionRow({
        title: 'Global Font Family',
        subtitle: 'Choose the default font used across all widgets.',
    });
    const fontBtn = new Gtk.FontButton({ valign: Gtk.Align.CENTER });
    const currentFont = settings.get_string('global-font-family') || DEFAULT_FONT_FAMILY;
    fontBtn.set_font(createNormalizedFontDescription(currentFont).to_string());
    fontBtn.connect('font-set', () => {
        const desc = Pango.FontDescription.from_string(fontBtn.get_font());
        const family = desc.get_family();
        if (family) {
            settings.set_string('global-font-family', `'${family}', sans-serif`);
        }
    });
    fontRow.add_suffix(fontBtn);
    group.add(fontRow);

    const useCustomFont = settings.get_boolean('global-use-custom-font');
    fontBtn.set_sensitive(useCustomFont);
    fontRow.set_subtitle(useCustomFont
        ? 'Choose the default font used across all widgets.'
        : 'Enable "Use Custom Font" above to change the font.');

    const customFontChangedId = settings.connect('changed::global-use-custom-font', () => {
        const active = settings.get_boolean('global-use-custom-font');
        fontBtn.set_sensitive(active);
        fontRow.set_subtitle(active
            ? 'Choose the default font used across all widgets.'
            : 'Enable "Use Custom Font" above to change the font.');
    });
    group.connect('destroy', () => settings.disconnect(customFontChangedId));

    return group;
}
