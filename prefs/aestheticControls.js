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
    const currentFont = settings.get_string('global-font-family');
    fontBtn.set_font(currentFont.replace(/'/g, '').replace(/, sans-serif/, '') + ' 11');
    fontBtn.connect('font-set', () => {
        const desc = Pango.FontDescription.from_string(fontBtn.get_font());
        const family = desc.get_family();
        settings.set_string('global-font-family', `'${family}', sans-serif`);
    });
    fontRow.add_suffix(fontBtn);
    group.add(fontRow);

    return group;
}

/**
 * Builds per-widget aesthetic override controls for edit dialogs.
 */
export function buildWidgetAestheticOverridesGroup(widget, onWidgetUpdated) {
    const group = new Adw.PreferencesGroup({
        title: 'Appearance Overrides',
        description: 'Override global default aesthetic styles for this specific widget.',
    });

    // 1. Border Radius Override
    const radiusRow = new Adw.ActionRow({
        title: 'Override Corner Rounding',
        subtitle: 'Set custom corner rounding for this widget.',
    });
    const radiusSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: !!widget.overrideBorderRadius });
    const radiusScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 50, 1);
    radiusScale.set_size_request(160, -1);
    radiusScale.set_valign(Gtk.Align.CENTER);
    radiusScale.set_draw_value(true);
    radiusScale.set_value(widget.borderRadius !== undefined ? widget.borderRadius : 16);
    radiusScale.set_sensitive(!!widget.overrideBorderRadius);

    radiusSwitch.connect('notify::active', () => {
        const active = radiusSwitch.get_active();
        widget.overrideBorderRadius = active;
        radiusScale.set_sensitive(active);
        onWidgetUpdated();
    });
    radiusScale.connect('value-changed', () => {
        widget.borderRadius = Math.round(radiusScale.get_value());
        onWidgetUpdated();
    });

    radiusRow.add_suffix(radiusScale);
    radiusRow.add_suffix(radiusSwitch);
    group.add(radiusRow);

    // 2. Border Width Override
    const borderRow = new Adw.ActionRow({
        title: 'Override Border Width',
        subtitle: 'Set custom border width for this widget.',
    });
    const borderSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: !!widget.overrideBorderWidth });
    const borderScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 10, 1);
    borderScale.set_size_request(160, -1);
    borderScale.set_valign(Gtk.Align.CENTER);
    borderScale.set_draw_value(true);
    borderScale.set_value(widget.borderWidth !== undefined ? widget.borderWidth : 0);
    borderScale.set_sensitive(!!widget.overrideBorderWidth);

    borderSwitch.connect('notify::active', () => {
        const active = borderSwitch.get_active();
        widget.overrideBorderWidth = active;
        borderScale.set_sensitive(active);
        onWidgetUpdated();
    });
    borderScale.connect('value-changed', () => {
        widget.borderWidth = Math.round(borderScale.get_value());
        onWidgetUpdated();
    });

    borderRow.add_suffix(borderScale);
    borderRow.add_suffix(borderSwitch);
    group.add(borderRow);

    // 3. Border Color Override
    const borderColorRow = new Adw.ActionRow({
        title: 'Custom Border Color',
        subtitle: 'Specific border color for this widget.',
    });
    const borderColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER });
    const bColor = new Gdk.RGBA();
    bColor.parse(widget.borderColor || 'rgba(255,255,255,0.2)');
    borderColorBtn.set_rgba(bColor);
    borderColorBtn.connect('color-set', () => {
        widget.borderColor = borderColorBtn.get_rgba().to_string();
        onWidgetUpdated();
    });
    borderColorRow.add_suffix(borderColorBtn);
    group.add(borderColorRow);

    return group;
}
