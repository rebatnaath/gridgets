/**
 * ============================================================================
 * PREFERENCES: AESTHETIC CONTROLS
 * 
 * Reusable GTK4 / Libadwaita control builders and aesthetic groups for both
 * global appearance settings and per-widget individual customization.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';

/**
 * Creates a bounded numeric scale row.
 */
export function createScaleRow(title, subtitle, settings, key, min = 0, max = 50) {
    const row = new Adw.ActionRow({ title, subtitle });
    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, 1);
    scale.set_size_request(200, -1);
    scale.set_valign(Gtk.Align.CENTER);
    scale.set_draw_value(true);
    settings.bind(key, scale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(scale);
    return row;
}

/**
 * Creates a color picker button row bound to a GSettings key.
 */
export function createColorRow(title, subtitle, settings, key, defaultVal = '#ffffff') {
    const row = new Adw.ActionRow({ title, subtitle });
    const btn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key) || defaultVal);
    btn.set_rgba(rgba);
    btn.connect('color-set', () => {
        settings.set_string(key, btn.get_rgba().to_string());
    });
    row.add_suffix(btn);
    return row;
}

/**
 * Creates a toggle switch row bound to a GSettings key.
 */
export function createSwitchRow(title, subtitle, settings, key) {
    const row = new Adw.ActionRow({ title, subtitle });
    const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(sw);
    return { row, switch: sw };
}

/**
 * Builds the global aesthetics preferences group for default styling across all widgets.
 */
export function buildGlobalAestheticsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Aesthetics',
        description: 'Tweak the default visual style applied to all widgets.',
    });

    group.add(createScaleRow('Corner Rounding', 'Adjust how rounded widget corners are by default.', settings, 'border-radius'));
    group.add(createScaleRow('Border Width', 'Global default border width for all widgets.', settings, 'global-border-width'));
    group.add(createColorRow('Border Color', 'Global default border color.', settings, 'global-border-color', 'rgb(255,255,255)'));
    group.add(createColorRow('Global Background Color', 'Global default background color.', settings, 'global-background-color', '#1a1b26'));
    group.add(createColorRow('Global Foreground/Text Color', 'Global default text color.', settings, 'global-foreground-color', '#ffffff'));

    const fontRow = new Adw.ActionRow({
        title: 'Global Font Family',
        subtitle: 'Choose the default font used across all widgets.',
    });
    const fontBtn = new Gtk.FontButton({ valign: Gtk.Align.CENTER });
    const currentFont = settings.get_string('global-font-family') || "'Poppins', sans-serif";
    const fontDesc = Pango.FontDescription.from_string(currentFont.replace(/'/g, '').replace(/, sans-serif/i, '').trim());
    if (fontDesc.get_size() === 0) {
        fontDesc.set_size(11 * Pango.SCALE);
    }
    fontBtn.set_font(fontDesc.to_string());
    fontBtn.connect('font-set', () => {
        const desc = Pango.FontDescription.from_string(fontBtn.get_font());
        const family = desc.get_family();
        settings.set_string('global-font-family', `'${family}', sans-serif`);
    });
    fontRow.add_suffix(fontBtn);
    group.add(fontRow);

    return group;
}
