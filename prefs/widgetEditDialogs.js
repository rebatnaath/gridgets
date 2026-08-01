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
import { getWidgets, saveWidgets, isAnimatedImageFile } from '../utils/widgetUtils.js';
import { openImageFileDialog } from './fileDialogs.js';
import { createLiveCitySearchRow, buildIconSelectionControls } from './widgetAddDialogs.js';
import { getConnectedMonitorsCount } from './globalSettingsPage.js';


export function buildWidgetEditPanel(parentWindow, widget, settings, onSavedCallback) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 12,
        margin_end: 12,
    });

    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 10 });
    box.append(grid);

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
        rowIdx = buildCommandSettings(grid, rowIdx, widget, settings, saveHandlers, parentWindow);
    } else if (widget.type === 'image' || widget.imagePath) {
        rowIdx = buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, parentWindow);
        if (widget.imagePath && isAnimatedImageFile(widget.imagePath)) {
            rowIdx = buildGifSettings(grid, rowIdx, widget, settings, saveHandlers);
        }
    }

    const saveBtn = new Gtk.Button({
        label: 'Save Changes',
        css_classes: ['suggested-action'],
        halign: Gtk.Align.END,
        margin_top: 8,
    });

    saveBtn.connect('clicked', () => {
        const widgets = getWidgets(settings);
        const index = widgets.findIndex(w => w.id === widget.id);
        if (index !== -1) {
            saveHandlers.forEach(handler => handler(widgets[index]));
            saveWidgets(settings, widgets);
            if (onSavedCallback) onSavedCallback(widgets[index]);
        }
    });

    box.append(saveBtn);
    return box;
}

export function openWidgetEditDialog(parentWindow, widget, settings) {
    const typeLabels = {
        weather: 'Weather', time: 'Time', music: 'Music',
        pomodoro: 'Pomodoro', slideshow: 'Slideshow',
        'cpu-ram': 'CPU and RAM', 'network-speed': 'Network Speed',
        'system-dashboard': 'System Dashboard',
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
    
    dialog.add_button('Close', Gtk.ResponseType.CLOSE);
    
    const content = dialog.get_content_area();
    content.set_margin_top(15);
    content.set_margin_bottom(15);
    content.set_margin_start(15);
    content.set_margin_end(15);
    
    const panel = buildWidgetEditPanel(parentWindow, widget, settings, () => {
        dialog.response(Gtk.ResponseType.CLOSE);
    });
    content.append(panel);

    dialog.connect('response', (dlg) => {
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
        const currentFont = widget.fontFamily || settings.get_string('global-font-family') || "'Poppins', sans-serif";
        const fontDesc = Pango.FontDescription.from_string(currentFont.replace(/'/g, '').replace(/, sans-serif/i, '').trim());
        if (fontDesc.get_size() === 0) {
            fontDesc.set_size(11 * Pango.SCALE);
        }
        fontBtn.set_font(fontDesc.to_string());
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

    // Target Monitor (only displayed if multiple monitors are connected)
    const monitorCount = getConnectedMonitorsCount();
    let monitorCombo = null;
    let monitorKeys = [];

    if (monitorCount > 1) {
        const monitorLabel = new Gtk.Label({ label: 'Target Monitor:', xalign: 0, hexpand: true });
        const monitorStrings = ['Default (Follow Global)', 'Primary Monitor'];
        monitorKeys = ['global', 'primary'];
        for (let i = 0; i < monitorCount; i++) {
            monitorStrings.push(`Monitor ${i + 1}`);
            monitorKeys.push(String(i));
        }

        monitorCombo = new Gtk.DropDown({
            model: Gtk.StringList.new(monitorStrings),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END
        });
        const currentWidgetMonitor = widget.monitor || 'global';
        const monitorIdx = monitorKeys.indexOf(currentWidgetMonitor);
        monitorCombo.set_selected(monitorIdx >= 0 ? monitorIdx : 0);
        grid.attach(monitorLabel, 0, rowIdx, 1, 1);
        grid.attach(monitorCombo, 1, rowIdx, 1, 1);
        rowIdx++;
    }

    saveHandlers.push((target) => {
        if (monitorCombo && monitorKeys.length > 0) {
            const selectedMonitorKey = monitorKeys[monitorCombo.get_selected()];
            if (selectedMonitorKey !== 'global') {
                target.monitor = selectedMonitorKey;
            } else {
                delete target.monitor;
            }
        }

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
    const currentLocation = { name: widget.location || 'London' };
    if (widget.lat !== undefined && widget.lon !== undefined) {
        currentLocation.lat = widget.lat;
        currentLocation.lon = widget.lon;
    }
    const cityPicker = createLiveCitySearchRow(grid, 'City Location:', currentLocation, rowIdx++);

    const dynamicColorLabel = new Gtk.Label({ label: 'Dynamic Weather Color:', xalign: 0, hexpand: true });
    const dynamicColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const isDynamicColorActive = widget.dynamicColor !== undefined
        ? widget.dynamicColor
        : settings.get_boolean('weather-dynamic-color');
    dynamicColorSwitch.set_active(isDynamicColorActive);
    grid.attach(dynamicColorLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicColorSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const dynamicOverlayLabel = new Gtk.Label({ label: 'Dynamic Weather Overlay:', xalign: 0, hexpand: true });
    const dynamicOverlaySwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const isDynamicOverlayActive = widget.dynamicImage !== undefined
        ? widget.dynamicImage
        : (widget.dynamicOverlay !== undefined ? widget.dynamicOverlay : settings.get_boolean('weather-dynamic-image'));
    dynamicOverlaySwitch.set_active(isDynamicOverlayActive);
    grid.attach(dynamicOverlayLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicOverlaySwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        const selectedCity = cityPicker.getSelectedCity();
        if (selectedCity && selectedCity.name) {
            target.location = selectedCity.name;
            if (selectedCity.lat !== undefined && selectedCity.lon !== undefined) {
                target.lat = selectedCity.lat;
                target.lon = selectedCity.lon;
            }
        }
        target.dynamicColor = dynamicColorSwitch.get_active();
        target.dynamicImage = dynamicOverlaySwitch.get_active();
        target.dynamicOverlay = dynamicOverlaySwitch.get_active();
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

    let primaryPicker, sec1Picker, sec2Picker;
    if (widget.layout === 'world' || widget.cities) {
        const defaultCities = widget.cities || [
            { name: 'London', timezone: 'Europe/London' },
            { name: 'New York', timezone: 'America/New_York' },
            { name: 'Moscow', timezone: 'Europe/Moscow' }
        ];
        primaryPicker = createLiveCitySearchRow(grid, 'Primary City (Top):', defaultCities[0] || { name: 'London', timezone: 'Europe/London' }, rowIdx++);
        sec1Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Left):', defaultCities[1] || { name: 'New York', timezone: 'America/New_York' }, rowIdx++);
        sec2Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Right):', defaultCities[2] || { name: 'Moscow', timezone: 'Europe/Moscow' }, rowIdx++);
    }

    saveHandlers.push((target) => {
        target.use24h = formatSwitch.get_active();
        if (primaryPicker && sec1Picker && sec2Picker) {
            target.cities = [
                primaryPicker.getSelectedCity(),
                sec1Picker.getSelectedCity(),
                sec2Picker.getSelectedCity()
            ];
        }
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

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({ text: widget.caption || 'My Slideshow', hexpand: true, placeholder_text: 'My Slideshow' });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showCaptionSwitch.set_active(widget.showCaption !== false && widget.showText !== false);
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const fgColorLabel = new Gtk.Label({ label: 'Caption Text Color:', xalign: 0, hexpand: true });
    const fgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const fgRgba = new Gdk.RGBA();
    fgRgba.parse(widget.fgColor || settings.get_string('global-foreground-color') || '#ffffff');
    fgColorBtn.set_rgba(fgRgba);
    grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.intervalSeconds = Math.round(intervalSpin.get_value());
        target.caption = captionEntry.get_text().trim() || 'My Slideshow';
        target.showCaption = showCaptionSwitch.get_active();
        target.showText = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba().to_string();
    });

    return rowIdx;
}

function buildGifSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const animateLabel = new Gtk.Label({ label: 'Animate GIF / WebP:', xalign: 0, hexpand: true });
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
    const nameEntry = new Gtk.Entry({ text: widget.commandName || '', placeholder_text: 'e.g. Quick Launch', hexpand: true });
    grid.attach(nameLabel, 0, rowIdx, 1, 1);
    grid.attach(nameEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0, hexpand: true });
    const cmdEntry = new Gtk.Entry({ text: widget.commandString || '', placeholder_text: 'e.g. echo "Hello World"', hexpand: true });
    grid.attach(cmdLabel, 0, rowIdx, 1, 1);
    grid.attach(cmdEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const showTextLabel = new Gtk.Label({ label: 'Show Label / Text:', xalign: 0, hexpand: true });
    const showTextSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showTextSwitch.set_active(widget.showText !== false);
    grid.attach(showTextLabel, 0, rowIdx, 1, 1);
    grid.attach(showTextSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const iconScaleLabel = new Gtk.Label({ label: 'Icon / Image Scale:', xalign: 0, hexpand: true });
    const iconScaleSpin = Gtk.SpinButton.new_with_range(0.5, 3.0, 0.1);
    iconScaleSpin.set_value(widget.iconScale !== undefined ? widget.iconScale : 1.0);
    grid.attach(iconScaleLabel, 0, rowIdx, 1, 1);
    grid.attach(iconScaleSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    const iconControls = buildIconSelectionControls(grid, rowIdx, widget.iconName || 'utilities-terminal-symbolic', widget.imagePath || '', dialog);
    rowIdx += 3;

    saveHandlers.push((target) => {
        target.commandName = nameEntry.get_text().trim() || 'Quick Launch';
        target.commandString = cmdEntry.get_text().trim() || 'echo "Hello World"';
        target.showText = showTextSwitch.get_active();
        target.iconScale = Math.round(iconScaleSpin.get_value() * 10) / 10;
        const { icon, iconPath } = iconControls.getIconConfig();
        target.iconName = icon;
        target.imagePath = iconPath;
    });

    return rowIdx;
}

function buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, dialog) {
    const imagePathLabel = new Gtk.Label({ label: 'Image File:', xalign: 0, hexpand: true });
    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    const imagePathEntry = new Gtk.Entry({ text: widget.imagePath || '', hexpand: true });
    const imageBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    imageBrowseBtn.connect('clicked', () => {
        openImageFileDialog(dialog, (selectedPath) => {
            if (selectedPath) {
                imagePathEntry.set_text(selectedPath);
            }
        });
    });

    imagePathBox.append(imagePathEntry);
    imagePathBox.append(imageBrowseBtn);
    grid.attach(imagePathLabel, 0, rowIdx, 1, 1);
    grid.attach(imagePathBox, 1, rowIdx, 1, 1);
    rowIdx++;

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({ text: widget.caption || 'My Image', hexpand: true, placeholder_text: 'My Image' });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showCaptionSwitch.set_active(widget.showCaption !== false && widget.showText !== false);
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const fgColorLabel = new Gtk.Label({ label: 'Caption Text Color:', xalign: 0, hexpand: true });
    const fgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const fgRgba = new Gdk.RGBA();
    fgRgba.parse(widget.fgColor || settings.get_string('global-foreground-color') || '#ffffff');
    fgColorBtn.set_rgba(fgRgba);
    grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.imagePath = imagePathEntry.get_text().trim();
        target.caption = captionEntry.get_text().trim() || 'My Image';
        target.showCaption = showCaptionSwitch.get_active();
        target.showText = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba().to_string();
    });

    return rowIdx;
}

