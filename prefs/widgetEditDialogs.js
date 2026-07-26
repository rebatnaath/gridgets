/**
 * ============================================================================
 * PREFERENCES: WIDGET EDIT DIALOGS
 * 
 * GTK Dialog for modifying properties of an existing desktop widget.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { getWidgets, saveWidgets } from '../utils/widgetUtils.js';

export function openWidgetEditDialog(parentWindow, widget, settings) {
    const typeLabels = {
        weather: 'Weather', time: 'Time', music: 'Music',
        pomodoro: 'Pomodoro', slideshow: 'Slideshow',
        'cpu-ram': 'CPU and RAM', 'network-speed': 'Network Speed',
        notes: 'Quick Notes', clipboard: 'Clipboard History',
        command: 'Command Launcher'
    };
    const typeLabel = typeLabels[widget.type] || 'Image';
    const dialog = new Gtk.Dialog({
        title: `Edit ${typeLabel} Widget`,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });
    
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Save', Gtk.ResponseType.OK);
    
    const content = dialog.get_content_area();
    content.set_margin_top(15);
    content.set_margin_bottom(15);
    content.set_margin_start(15);
    content.set_margin_end(15);
    content.set_spacing(10);
    
    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 12 });
    content.append(grid);
    
    const saveHandlers = [];
    let rowIdx = 0;
    
    rowIdx = buildStandardSettings(grid, rowIdx, widget, settings, saveHandlers);
    
    if (widget.type === 'weather') {
        rowIdx = buildWeatherSettings(grid, rowIdx, widget, settings, saveHandlers);
    } else if (widget.type === 'time') {
        rowIdx = buildTimeSettings(grid, rowIdx, widget, settings, saveHandlers);
    } else if (widget.type === 'music') {
        rowIdx = buildMusicSettings(grid, rowIdx, widget, settings, saveHandlers);
    } else if (widget.type === 'slideshow') {
        rowIdx = buildSlideshowSettings(grid, rowIdx, widget, settings, saveHandlers);
    } else if (widget.type === 'command') {
        rowIdx = buildCommandSettings(grid, rowIdx, widget, settings, saveHandlers, dialog);
    } else if (widget.type === 'image' || widget.imagePath) {
        rowIdx = buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, dialog);
        if (widget.imagePath && widget.imagePath.toLowerCase().endsWith('.gif')) {
            rowIdx = buildGifSettings(grid, rowIdx, widget, settings, saveHandlers);
        }
    }

    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const widgets = getWidgets(settings);
            const index = widgets.findIndex(w => w.id === widget.id);
            if (index !== -1) {
                saveHandlers.forEach(handler => handler(widgets[index]));
                saveWidgets(settings, widgets);
            }
        }
        dlg.destroy();
    });
    
    dialog.show();
}

function buildStandardSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const isImageOrSlideshow = widget.type === 'slideshow' || widget.type === 'image' || widget.imagePath;

    // Corner rounding
    const radiusSwitchLabel = new Gtk.Label({ label: 'Custom Corner Rounding:', xalign: 0, hexpand: true });
    const radiusSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    radiusSwitch.set_active(widget.overrideRadius === true || widget.overrideBorderRadius === true);
    grid.attach(radiusSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(radiusSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    const radiusLabel = new Gtk.Label({ label: 'Corner Radius:', xalign: 0, hexpand: true });
    const radiusSpin = Gtk.SpinButton.new_with_range(0, 100, 1);
    radiusSpin.set_valign(Gtk.Align.CENTER);
    radiusSpin.set_halign(Gtk.Align.END);
    radiusSpin.set_value(widget.borderRadius !== undefined ? widget.borderRadius : settings.get_int('border-radius'));
    grid.attach(radiusLabel, 0, rowIdx, 1, 1);
    grid.attach(radiusSpin, 1, rowIdx, 1, 1);
    rowIdx++;
    
    radiusSpin.set_sensitive(radiusSwitch.get_active());
    radiusSwitch.connect('notify::active', () => {
        radiusSpin.set_sensitive(radiusSwitch.get_active());
    });

    // Border Switch for width and color
    const borderSwitchLabel = new Gtk.Label({ label: 'Custom Border:', xalign: 0, hexpand: true });
    const borderSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    borderSwitch.set_active(widget.overrideBorder === true || widget.overrideBorderWidth === true);
    grid.attach(borderSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(borderSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    // Border Width
    const widthLabel = new Gtk.Label({ label: 'Border Width:', xalign: 0, hexpand: true });
    const widthSpin = Gtk.SpinButton.new_with_range(0, 50, 1);
    widthSpin.set_valign(Gtk.Align.CENTER);
    widthSpin.set_halign(Gtk.Align.END);
    widthSpin.set_value(widget.borderWidth !== undefined ? widget.borderWidth : settings.get_int('global-border-width'));
    grid.attach(widthLabel, 0, rowIdx, 1, 1);
    grid.attach(widthSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    // Border Color
    const borderColorLabel = new Gtk.Label({ label: 'Border Color:', xalign: 0, hexpand: true });
    const borderColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const borderRgba = new Gdk.RGBA();
    borderRgba.parse(widget.borderColor || settings.get_string('global-border-color') || 'rgb(255,255,255)');
    borderColorBtn.set_rgba(borderRgba);
    grid.attach(borderColorLabel, 0, rowIdx, 1, 1);
    grid.attach(borderColorBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    borderColorBtn.set_sensitive(borderSwitch.get_active());
    widthSpin.set_sensitive(borderSwitch.get_active());
    borderSwitch.connect('notify::active', () => {
        borderColorBtn.set_sensitive(borderSwitch.get_active());
        widthSpin.set_sensitive(borderSwitch.get_active());
    });

    let bgColorBtn, fgColorBtn, fontBtn, colorSwitch;

    if (!isImageOrSlideshow) {
        // Color Switch
        const colorSwitchLabel = new Gtk.Label({ label: 'Custom Colors & Font:', xalign: 0, hexpand: true });
        colorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        colorSwitch.set_active(widget.overrideColors === true);
        grid.attach(colorSwitchLabel, 0, rowIdx, 1, 1);
        grid.attach(colorSwitch, 1, rowIdx, 1, 1);
        rowIdx++;

        // Background color
        const bgColorLabel = new Gtk.Label({ label: 'Background Color:', xalign: 0, hexpand: true });
        bgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const bgRgba = new Gdk.RGBA();
        bgRgba.parse(widget.bgColor || settings.get_string('global-background-color') || '#1a1b26');
        bgColorBtn.set_rgba(bgRgba);
        grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(bgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        // Foreground color
        const fgColorLabel = new Gtk.Label({ label: 'Text/Icon Color:', xalign: 0, hexpand: true });
        fgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const fgRgba = new Gdk.RGBA();
        fgRgba.parse(widget.fgColor || settings.get_string('global-foreground-color') || '#ffffff');
        fgColorBtn.set_rgba(fgRgba);
        grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        // Font Family
        const fontLabel = new Gtk.Label({ label: 'Font Family:', xalign: 0, hexpand: true });
        fontBtn = new Gtk.FontButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const currentFont = widget.fontFamily || settings.get_string('global-font-family') || 'Sans 11';
        fontBtn.set_font(currentFont.replace(/'/g, '').replace(/, sans-serif/, '') + ' 11');
        grid.attach(fontLabel, 0, rowIdx, 1, 1);
        grid.attach(fontBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        bgColorBtn.set_sensitive(colorSwitch.get_active());
        fgColorBtn.set_sensitive(colorSwitch.get_active());
        fontBtn.set_sensitive(colorSwitch.get_active());

        colorSwitch.connect('notify::active', () => {
            const active = colorSwitch.get_active();
            bgColorBtn.set_sensitive(active);
            fgColorBtn.set_sensitive(active);
            fontBtn.set_sensitive(active);
        });
    }

    saveHandlers.push((target) => {
        target.overrideRadius = radiusSwitch.get_active();
        target.overrideBorderRadius = radiusSwitch.get_active();
        target.borderRadius = Math.round(radiusSpin.get_value());
        
        target.overrideBorder = borderSwitch.get_active();
        target.overrideBorderWidth = borderSwitch.get_active();
        target.borderWidth = Math.round(widthSpin.get_value());
        target.borderColor = borderColorBtn.get_rgba().to_string();

        if (!isImageOrSlideshow && colorSwitch) {
            target.overrideColors = colorSwitch.get_active();
            target.bgColor = bgColorBtn.get_rgba().to_string();
            target.fgColor = fgColorBtn.get_rgba().to_string();
            
            const desc = Pango.FontDescription.from_string(fontBtn.get_font());
            const family = desc.get_family();
            target.fontFamily = `'${family}', sans-serif`;
        }
    });

    return rowIdx;
}

function buildWeatherSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const layoutLabel = new Gtk.Label({ label: 'Layout Style:', xalign: 0, hexpand: true });
    const layoutCombo = new Gtk.DropDown({
        model: Gtk.StringList.new(['Standard (3x3)', 'Minimal (4x2)', 'Detailed Forecast (6x4)']),
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END
    });
    
    const layoutMap = ['standard', 'simple', 'forecast'];
    const currentIdx = layoutMap.indexOf(widget.layout || 'standard');
    layoutCombo.set_selected(currentIdx >= 0 ? currentIdx : 0);
    
    grid.attach(layoutLabel, 0, rowIdx, 1, 1);
    grid.attach(layoutCombo, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.layout = layoutMap[layoutCombo.get_selected()];
    });

    return rowIdx;
}

function buildTimeSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const formatLabel = new Gtk.Label({ label: 'Use 24-Hour Format:', xalign: 0, hexpand: true });
    const formatSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    formatSwitch.set_active(widget.use24h !== undefined ? widget.use24h : settings.get_boolean('time-format-24h'));
    
    grid.attach(formatLabel, 0, rowIdx, 1, 1);
    grid.attach(formatSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.use24h = formatSwitch.get_active();
    });

    return rowIdx;
}

function buildMusicSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const showControlsLabel = new Gtk.Label({ label: 'Show Player Controls:', xalign: 0, hexpand: true });
    const showControlsSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showControlsSwitch.set_active(widget.showControls !== false);
    
    grid.attach(showControlsLabel, 0, rowIdx, 1, 1);
    grid.attach(showControlsSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.showControls = showControlsSwitch.get_active();
    });

    return rowIdx;
}

function buildSlideshowSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const intervalLabel = new Gtk.Label({ label: 'Change Interval (Seconds):', xalign: 0, hexpand: true });
    const intervalSpin = Gtk.SpinButton.new_with_range(5, 3600, 5);
    intervalSpin.set_valign(Gtk.Align.CENTER);
    intervalSpin.set_halign(Gtk.Align.END);
    intervalSpin.set_value(widget.intervalSeconds || 30);
    
    grid.attach(intervalLabel, 0, rowIdx, 1, 1);
    grid.attach(intervalSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.intervalSeconds = Math.round(intervalSpin.get_value());
    });

    return rowIdx;
}

function buildGifSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const animateLabel = new Gtk.Label({ label: 'Animate GIF:', xalign: 0, hexpand: true });
    const animateSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    animateSwitch.set_active(widget.animateGif !== false);
    
    grid.attach(animateLabel, 0, rowIdx, 1, 1);
    grid.attach(animateSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.animateGif = animateSwitch.get_active();
    });

    return rowIdx;
}

function buildCommandSettings(grid, rowIdx, widget, settings, saveHandlers, dialog) {
    const nameLabel = new Gtk.Label({ label: 'Command Name:', xalign: 0, hexpand: true });
    const nameEntry = new Gtk.Entry({ text: widget.commandName || '', hexpand: true });
    grid.attach(nameLabel, 0, rowIdx, 1, 1);
    grid.attach(nameEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0, hexpand: true });
    const cmdEntry = new Gtk.Entry({ text: widget.commandString || '', hexpand: true });
    grid.attach(cmdLabel, 0, rowIdx, 1, 1);
    grid.attach(cmdEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.commandName = nameEntry.get_text().trim() || 'Quick Launch';
        target.commandString = cmdEntry.get_text().trim() || 'echo "Hello World"';
    });

    return rowIdx;
}

function buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, dialog) {
    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({ text: widget.caption || '', hexpand: true });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.caption = captionEntry.get_text().trim();
    });

    return rowIdx;
}
