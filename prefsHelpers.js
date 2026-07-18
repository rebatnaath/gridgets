/**
 * ============================================================================
 * PREFERENCES HELPERS
 * 
 * This file contains utility functions for managing widgets in the
 * preferences UI. It handles populating the active widgets list,
 * opening widget edit dialogs, building settings for specific widgets,
 * and performing tasks like city search for the weather widget.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { deleteCacheFile, DEFAULT_BG_COLORS, checkOverlap } from './widgetUtils.js';

export const COLUMNS_COUNT = 28;
export const ROWS_COUNT = 16;
export const WIDGET_WIDTH = 2;
export const WIDGET_HEIGHT = 2;

let searchSession = null;

export function populateActiveWidgets(window, settings, group, extensionPath) {
        if (group.activeRows) {
            for (let row of group.activeRows) {
                group.remove(row);
            }
        }
        group.activeRows = [];

        let widgets = [];
        try {
            widgets = JSON.parse(settings.get_string('widgets'));
        } catch (e) {
            console.error('Failed to parse widgets:', e);
        }

        if (widgets.length === 0) {
            const emptyRow = new Adw.ActionRow({ title: 'No widgets added yet.' });
            group.add(emptyRow);
            group.activeRows.push(emptyRow);
            return;
        }

        for (const widget of widgets) {
            let name = 'Color Block';
            let iconName = 'image-x-generic-symbolic';
            
            if (widget.type === 'weather') {
                name = `Weather (${widget.location || 'London'})`;
                iconName = 'weather-few-clouds-symbolic';
            } else if (widget.type === 'time') {
                name = 'Time';
                iconName = 'preferences-system-time-symbolic';
            } else if (widget.type === 'music') {
                name = `Music (${widget.width}x${widget.height})`;
                iconName = 'audio-x-generic-symbolic';
            } else if (widget.type === 'pomodoro') {
                name = `Pomodoro (${widget.width}x${widget.height})`;
                iconName = 'alarm-symbolic';
            } else if (widget.type === 'slideshow') {
                const folderName = widget.slideshowFolder ? widget.slideshowFolder.split('/').pop() : 'Unknown';
                name = `Slideshow (${folderName})`;
                iconName = 'view-paged-symbolic';
            } else if (widget.type === 'cpu-ram') {
                name = `CPU and RAM Usage (${widget.width}x${widget.height})`;
                iconName = 'resources-symbolic';
            } else if (widget.type === 'network-speed') {
                name = `Network Speed (${widget.width}x${widget.height})`;
                iconName = 'network-workgroup-symbolic';
            } else if (widget.type === 'notes') {
                name = `Quick Notes (${widget.width}x${widget.height})`;
                iconName = 'text-editor-symbolic';
            } else if (widget.type === 'clipboard') {
                name = `Clipboard History (${widget.width}x${widget.height})`;
                iconName = 'edit-copy-symbolic';
            } else if (widget.type === 'command') {
                name = `Command: ${widget.commandName}`;
                iconName = 'system-run-symbolic';
            } else if (widget.imagePath) {
                const parts = widget.imagePath.split('/');
                name = parts[parts.length - 1];
            }

            const row = new Adw.ActionRow({
                title: name,
                subtitle: `Position: (Col: ${widget.x}, Row: ${widget.y}) - Size: ${widget.width}x${widget.height}`
            });

            const icon = new Gtk.Image({
                icon_name: iconName,
                pixel_size: 32,
                margin_end: 10
            });
            row.add_prefix(icon);

            const buttonsBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER
            });

            const editBtn = new Gtk.Button({
                icon_name: 'document-edit-symbolic',
                css_classes: ['flat']
            });
            editBtn.connect('clicked', () => openWidgetEditDialog(window, widget, settings));
            buttonsBox.append(editBtn);

            const deleteBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                css_classes: ['destructive-action']
            });

            deleteBtn.connect('clicked', () => {
                const newWidgets = widgets.filter(wid => wid.id !== widget.id);
                if (widget.type === 'notes')
                    deleteCacheFile(extensionPath, 'notes', widget.id);
                if (widget.type === 'clipboard')
                    deleteCacheFile(extensionPath, 'clipboard', widget.id);
                settings.set_string('widgets', JSON.stringify(newWidgets));
            });
            
            buttonsBox.append(deleteBtn);
            row.add_suffix(buttonsBox);
            group.add(row);
            group.activeRows.push(row);
        }
    }
    
export function openWidgetEditDialog(parentWindow, widget, settings) {
    const typeLabels = {
        weather: 'Weather', time: 'Time', music: 'Music',
        pomodoro: 'Pomodoro', slideshow: 'Slideshow',
        'cpu-ram': 'CPU and RAM', 'network-speed': 'Network Speed',
        notes: 'Quick Notes', clipboard: 'Clipboard History'
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
    } else if (widget.type === 'gif') {
        rowIdx = buildGifSettings(grid, rowIdx, widget, settings, saveHandlers);
    } else if (widget.type === 'command') {
        rowIdx = buildCommandSettings(grid, rowIdx, widget, settings, saveHandlers);
    }
    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            let widgets = JSON.parse(settings.get_string('widgets'));
            const index = widgets.findIndex(w => w.id === widget.id);
            if (index !== -1) {
                saveHandlers.forEach(handler => handler(widgets[index]));
                settings.set_string('widgets', JSON.stringify(widgets));
            }
        }
        dlg.destroy();
    });
    
    dialog.show();
}

function buildStandardSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const isImageOrSlideshow = widget.type === 'slideshow' || widget.type === 'image' || widget.imagePath;

    // Corner rounding
    const radiusSwitchLabel = new Gtk.Label({ label: 'Custom Corner Rounding:', xalign: 0 });
    const radiusSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    radiusSwitch.set_active(widget.overrideRadius === true);
    grid.attach(radiusSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(radiusSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    const radiusLabel = new Gtk.Label({ label: 'Corner Radius:', xalign: 0 });
    const radiusSpin = Gtk.SpinButton.new_with_range(0, 100, 1);
    radiusSpin.set_value(widget.borderRadius !== undefined ? widget.borderRadius : settings.get_int('border-radius'));
    grid.attach(radiusLabel, 0, rowIdx, 1, 1);
    grid.attach(radiusSpin, 1, rowIdx, 1, 1);
    rowIdx++;
    
    radiusSpin.set_sensitive(radiusSwitch.get_active());
    radiusSwitch.connect('notify::active', () => {
        radiusSpin.set_sensitive(radiusSwitch.get_active());
    });

    // Border Switch for width and color
    const borderSwitchLabel = new Gtk.Label({ label: 'Custom Border:', xalign: 0 });
    const borderSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    borderSwitch.set_active(widget.overrideBorder === true);
    grid.attach(borderSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(borderSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    // Border Width
    const widthLabel = new Gtk.Label({ label: 'Border Width:', xalign: 0 });
    const widthSpin = Gtk.SpinButton.new_with_range(0, 50, 1);
    widthSpin.set_value(widget.borderWidth !== undefined ? widget.borderWidth : settings.get_int('global-border-width'));
    grid.attach(widthLabel, 0, rowIdx, 1, 1);
    grid.attach(widthSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    // Border Color
    const borderColorLabel = new Gtk.Label({ label: 'Border Color:', xalign: 0 });
    const borderColorBtn = new Gtk.ColorButton();
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
        const colorSwitchLabel = new Gtk.Label({ label: 'Custom Colors & Font:', xalign: 0 });
        colorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
        colorSwitch.set_active(widget.overrideColors === true);
        grid.attach(colorSwitchLabel, 0, rowIdx, 1, 1);
        grid.attach(colorSwitch, 1, rowIdx, 1, 1);
        rowIdx++;

        // Background color
        const bgColorLabel = new Gtk.Label({ label: 'Background Color:', xalign: 0 });
        bgColorBtn = new Gtk.ColorButton();
        const bgRgba = new Gdk.RGBA();
        bgRgba.parse(widget.bgColor || settings.get_string('global-background-color') || '#1a1b26');
        bgColorBtn.set_rgba(bgRgba);
        bgColorBtn.set_use_alpha(true);
        grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(bgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;
        
        // Foreground color
        const fgColorLabel = new Gtk.Label({ label: 'Foreground Color:', xalign: 0 });
        fgColorBtn = new Gtk.ColorButton();
        const fgRgba = new Gdk.RGBA();
        fgRgba.parse(widget.fgColor || widget.textColor || settings.get_string('global-foreground-color') || '#ffffff');
        fgColorBtn.set_rgba(fgRgba);
        fgColorBtn.set_use_alpha(true);
        grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;
        
        // Font family
        const fontLabel = new Gtk.Label({ label: 'Font Family:', xalign: 0 });
        fontBtn = new Gtk.FontButton();
        const currentFont = widget.fontFamily || settings.get_string('global-font-family') || 'Sans';
        fontBtn.set_font(currentFont.replace(/'/g, '').replace(/, sans-serif/, '') + ' 11');
        grid.attach(fontLabel, 0, rowIdx, 1, 1);
        grid.attach(fontBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        bgColorBtn.set_sensitive(colorSwitch.get_active());
        fgColorBtn.set_sensitive(colorSwitch.get_active());
        fontBtn.set_sensitive(colorSwitch.get_active());
        colorSwitch.connect('notify::active', () => {
            bgColorBtn.set_sensitive(colorSwitch.get_active());
            fgColorBtn.set_sensitive(colorSwitch.get_active());
            fontBtn.set_sensitive(colorSwitch.get_active());
        });
    }

    let captionEntry, showTextSwitch;
    if (isImageOrSlideshow) {
        const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0 });
        captionEntry = new Gtk.Entry({
            placeholder_text: 'Caption text',
            hexpand: true,
            text: widget.caption || ''
        });
        grid.attach(captionLabel, 0, rowIdx, 1, 1);
        grid.attach(captionEntry, 1, rowIdx, 1, 1);
        rowIdx++;

        const showTextLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0 });
        showTextSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
        const globalShow = widget.type === 'slideshow' ? settings.get_boolean('slideshow-show-caption') : settings.get_boolean('image-show-caption');
        showTextSwitch.set_active(widget.showText !== undefined ? widget.showText : globalShow);
        grid.attach(showTextLabel, 0, rowIdx, 1, 1);
        grid.attach(showTextSwitch, 1, rowIdx, 1, 1);
        rowIdx++;
    }

    saveHandlers.push((widgetData) => {
        // Save Radius
        widgetData.overrideRadius = radiusSwitch.get_active();
        if (widgetData.overrideRadius) {
            widgetData.borderRadius = radiusSpin.get_value_as_int();
        } else {
            delete widgetData.borderRadius;
        }

        // Save Border
        widgetData.overrideBorder = borderSwitch.get_active();
        if (widgetData.overrideBorder) {
            widgetData.borderColor = borderColorBtn.get_rgba().to_string();
            widgetData.borderWidth = widthSpin.get_value_as_int();
        } else {
            delete widgetData.borderColor;
            delete widgetData.borderWidth;
        }
        
        if (!isImageOrSlideshow) {
            widgetData.overrideColors = colorSwitch.get_active();
            if (widgetData.overrideColors) {
                widgetData.bgColor = bgColorBtn.get_rgba().to_string();
                widgetData.fgColor = fgColorBtn.get_rgba().to_string();
                // Retain textColor if needed by existing widgets
                widgetData.textColor = fgColorBtn.get_rgba().to_string(); 
                
                const desc = Pango.FontDescription.from_string(fontBtn.get_font());
                const family = desc.get_family();
                widgetData.fontFamily = `'${family}', sans-serif`;
            } else {
                delete widgetData.bgColor;
                delete widgetData.fgColor;
                delete widgetData.textColor;
                delete widgetData.fontFamily;
            }
        }
        
        if (isImageOrSlideshow) {
            widgetData.caption = captionEntry.get_text().trim();
            widgetData.showText = showTextSwitch.get_active();
        }
    });

    return rowIdx;
}



function buildWeatherSettings(grid, rowIdx, widget, settings, saveHandlers) {
    let selectedLoc = widget.location;
    
    const locLabel = new Gtk.Label({ label: 'Change City:', xalign: 0 });
    const searchBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const searchEntry = new Gtk.Entry({ placeholder_text: widget.location || 'Search...', hexpand: true });
    const searchBtn = new Gtk.Button({ label: 'Search' });
    searchBox.append(searchEntry);
    searchBox.append(searchBtn);
    
    grid.attach(locLabel, 0, rowIdx, 1, 1);
    grid.attach(searchBox, 1, rowIdx, 1, 1);
    rowIdx++;
    
    const resultsList = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        css_classes: ['boxed-list']
    });
    resultsList.set_visible(false);
    grid.attach(resultsList, 0, rowIdx, 2, 1);
    rowIdx++;
    
    const doSearch = () => {
        const query = searchEntry.get_text();
        performCitySearch(query, resultsList, null, (loc) => {
            selectedLoc = loc;
            searchEntry.set_text(loc);
            let child = resultsList.get_first_child();
            while (child) {
                let next = child.get_next_sibling();
                resultsList.remove(child);
                child = next;
            }
            resultsList.set_visible(false);
        }, settings);
    };
    searchBtn.connect('clicked', doSearch);
    searchEntry.connect('activate', doSearch);
    
    const globalDynamicColor = settings.get_boolean('weather-dynamic-color');
    const globalDynamicImage = settings.get_boolean('weather-dynamic-image');
    
    let localDynamicColor = widget.dynamicColor !== undefined ? widget.dynamicColor : globalDynamicColor;
    let localDynamicImage = widget.dynamicImage !== undefined ? widget.dynamicImage : globalDynamicImage;

    const dynamicColorLabel = new Gtk.Label({ label: 'Dynamic Weather Color:', xalign: 0 });
    const dynamicColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    dynamicColorSwitch.set_active(localDynamicColor);
    grid.attach(dynamicColorLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicColorSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const dynamicImageLabel = new Gtk.Label({ label: 'Dynamic Overlay Image:', xalign: 0 });
    const dynamicImageSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    dynamicImageSwitch.set_active(localDynamicImage);
    grid.attach(dynamicImageLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicImageSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const overrideTempLabel = new Gtk.Label({ label: 'Override Global Temp Unit:', xalign: 0 });
    const overrideTempSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    overrideTempSwitch.set_active(widget.useFahrenheit !== undefined);
    grid.attach(overrideTempLabel, 0, rowIdx, 1, 1);
    grid.attach(overrideTempSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const globalUseFahrenheit = settings.get_boolean('weather-use-fahrenheit');
    const localUseFahrenheit = widget.useFahrenheit !== undefined ? widget.useFahrenheit : globalUseFahrenheit;

    const tempUnitLabel = new Gtk.Label({ label: 'Use Fahrenheit (°F):', xalign: 0 });
    const tempUnitSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    tempUnitSwitch.set_active(localUseFahrenheit);
    grid.attach(tempUnitLabel, 0, rowIdx, 1, 1);
    grid.attach(tempUnitSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    tempUnitSwitch.set_sensitive(overrideTempSwitch.get_active());
    overrideTempSwitch.connect('notify::active', () => {
        tempUnitSwitch.set_sensitive(overrideTempSwitch.get_active());
    });
    
    const bgColorSwitchLabel = new Gtk.Label({ label: 'Custom Background Color:', xalign: 0 });
    const bgColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    bgColorSwitch.set_active(widget.overrideBgColor === true);
    
    const bgColorLabel = new Gtk.Label({ label: 'Background Color:', xalign: 0 });
    const bgColorButton = new Gtk.ColorButton();
    const bgRgba = new Gdk.RGBA();
    bgRgba.parse(widget.bgColor || DEFAULT_BG_COLORS['weather']);
    bgColorButton.set_rgba(bgRgba);
    
    const textColorLabel = new Gtk.Label({ label: 'Text Color:', xalign: 0 });
    const textColorButton = new Gtk.ColorButton();
    const textRgba = new Gdk.RGBA();
    textRgba.parse(widget.textColor || '#ffffff');
    textColorButton.set_rgba(textRgba);
    
    const updateCustomColorState = () => {
        const isDynamic = dynamicColorSwitch.get_active();
        if (isDynamic) {
            bgColorSwitch.set_sensitive(false);
            bgColorButton.set_sensitive(false);
            textColorButton.set_sensitive(false);
            bgColorSwitchLabel.set_markup("Custom Background Color:\n<span size='small' alpha='70%'>(Disable 'Dynamic Weather Color' to unlock)</span>");
        } else {
            bgColorSwitch.set_sensitive(true);
            bgColorSwitchLabel.set_label("Custom Background Color:");
            bgColorButton.set_sensitive(bgColorSwitch.get_active());
            textColorButton.set_sensitive(bgColorSwitch.get_active());
        }
    };
    
    dynamicColorSwitch.connect('notify::active', updateCustomColorState);
    bgColorSwitch.connect('notify::active', updateCustomColorState);
    updateCustomColorState();

    const scaleLabel = new Gtk.Label({ label: 'Content Scale (%):', xalign: 0 });
    const scaleSpin = Gtk.SpinButton.new_with_range(50, 150, 5);
    scaleSpin.set_value(widget.contentScale !== undefined ? Math.round(widget.contentScale * 100) : 100);
    grid.attach(scaleLabel, 0, rowIdx, 1, 1);
    grid.attach(scaleSpin, 1, rowIdx, 1, 1);
    rowIdx++;
    
    grid.attach(bgColorSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(bgColorSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(bgColorButton, 1, rowIdx, 1, 1);
    rowIdx++;
    
    grid.attach(textColorLabel, 0, rowIdx, 1, 1);
    grid.attach(textColorButton, 1, rowIdx, 1, 1);
    rowIdx++;
    
    saveHandlers.push((widgetData) => {
        if (selectedLoc) {
            widgetData.location = selectedLoc;
        }
        widgetData.dynamicColor = dynamicColorSwitch.get_active();
        widgetData.dynamicImage = dynamicImageSwitch.get_active();
        if (overrideTempSwitch.get_active()) {
            widgetData.useFahrenheit = tempUnitSwitch.get_active();
        } else {
            delete widgetData.useFahrenheit;
        }
        widgetData.overrideBgColor = bgColorSwitch.get_active();
        
        if (widgetData.overrideBgColor) {
            widgetData.bgColor = bgColorButton.get_rgba().to_string();
            widgetData.textColor = textColorButton.get_rgba().to_string();
        } else {
            delete widgetData.bgColor;
            delete widgetData.textColor;
        }
        widgetData.contentScale = scaleSpin.get_value_as_int() / 100.0;
    });
    
    return rowIdx;
}

function buildTimeSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const global24h = settings.get_boolean('time-format-24h');
    let local24h = widget.use24h !== undefined ? widget.use24h : global24h;

    const formatLabel = new Gtk.Label({ label: 'Use 24-Hour Format:', xalign: 0 });
    const timeFormatSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    timeFormatSwitch.set_active(local24h);
    grid.attach(formatLabel, 0, rowIdx, 1, 1);
    grid.attach(timeFormatSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    const bgColorSwitchLabel = new Gtk.Label({ label: 'Custom Background Color:', xalign: 0 });
    const bgColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    bgColorSwitch.set_active(widget.overrideBgColor === true);
    
    const bgColorLabel = new Gtk.Label({ label: 'Background Color:', xalign: 0 });
    const bgColorButton = new Gtk.ColorButton();
    const bgRgba = new Gdk.RGBA();
    bgRgba.parse(widget.bgColor || DEFAULT_BG_COLORS['time']);
    bgColorButton.set_rgba(bgRgba);
    
    const textColorLabel = new Gtk.Label({ label: 'Text Color:', xalign: 0 });
    const textColorButton = new Gtk.ColorButton();
    const textRgba = new Gdk.RGBA();
    textRgba.parse(widget.textColor || '#ffffff');
    textColorButton.set_rgba(textRgba);
    
    bgColorButton.set_sensitive(bgColorSwitch.get_active());
    textColorButton.set_sensitive(bgColorSwitch.get_active());
    bgColorSwitch.connect('notify::active', () => {
        bgColorButton.set_sensitive(bgColorSwitch.get_active());
        textColorButton.set_sensitive(bgColorSwitch.get_active());
    });
    
    grid.attach(bgColorSwitchLabel, 0, rowIdx, 1, 1);
    grid.attach(bgColorSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(bgColorButton, 1, rowIdx, 1, 1);
    rowIdx++;
    
    grid.attach(textColorLabel, 0, rowIdx, 1, 1);
    grid.attach(textColorButton, 1, rowIdx, 1, 1);
    rowIdx++;
    
    saveHandlers.push((widgetData) => {
        widgetData.use24h = timeFormatSwitch.get_active();
        widgetData.overrideBgColor = bgColorSwitch.get_active();
        if (widgetData.overrideBgColor) {
            widgetData.bgColor = bgColorButton.get_rgba().to_string();
            widgetData.textColor = textColorButton.get_rgba().to_string();
        } else {
            delete widgetData.bgColor;
            delete widgetData.textColor;
        }
    });
    
    return rowIdx;
}

function buildGifSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const gifLabel = new Gtk.Label({ label: 'Animate GIF:', xalign: 0 });
    const gifSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    gifSwitch.set_active(widget.animateGif !== false);
    grid.attach(gifLabel, 0, rowIdx, 1, 1);
    grid.attach(gifSwitch, 1, rowIdx, 1, 1);
    rowIdx++;
    
    saveHandlers.push((widgetData) => {
        widgetData.animateGif = gifSwitch.get_active();
    });
    
    return rowIdx;
}

function buildMusicSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const createSwitch = (labelText, key, defaultVal) => {
        const switchLabel = new Gtk.Label({ label: labelText, xalign: 0 });
        const switchWidget = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
        switchWidget.set_active(widget[key] === undefined ? defaultVal : widget[key]);
        grid.attach(switchLabel, 0, rowIdx, 1, 1);
        grid.attach(switchWidget, 1, rowIdx, 1, 1);
        rowIdx++;
        return switchWidget;
    };

    const showTimerSwitch = createSwitch('Show Timer:', 'showTimer', true);
    const showPlaySwitch = createSwitch('Show Play/Pause:', 'showPlay', true);
    const showForwardSwitch = createSwitch('Show Forward:', 'showForward', true);
    const showBackwardSwitch = createSwitch('Show Backward:', 'showBackward', true);

    const bgColorLabel = new Gtk.Label({ label: 'Text Panel Background:', xalign: 0 });
    const bgColorButton = new Gtk.ColorButton();
    const bgRgba = new Gdk.RGBA();
    bgRgba.parse(widget.textBackgroundColor || 'rgba(0,0,0,0.6)');
    bgColorButton.set_rgba(bgRgba);
    bgColorButton.set_use_alpha(true);
    
    grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(bgColorButton, 1, rowIdx, 1, 1);
    rowIdx++;

    const fgColorLabel = new Gtk.Label({ label: 'Text/Foreground Color:', xalign: 0 });
    const fgColorButton = new Gtk.ColorButton();
    const fgRgba = new Gdk.RGBA();
    fgRgba.parse(widget.textColor || 'rgba(255,255,255,1.0)');
    fgColorButton.set_rgba(fgRgba);
    fgColorButton.set_use_alpha(true);
    
    grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(fgColorButton, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((widgetData) => {
        widgetData.showTimer = showTimerSwitch.get_active();
        widgetData.showPlay = showPlaySwitch.get_active();
        widgetData.showForward = showForwardSwitch.get_active();
        widgetData.showBackward = showBackwardSwitch.get_active();
        widgetData.textBackgroundColor = bgColorButton.get_rgba().to_string();
        widgetData.textColor = fgColorButton.get_rgba().to_string();
    });

    return rowIdx;
}

function buildSlideshowSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderEntry = new Gtk.Entry({
        placeholder_text: '/path/to/images',
        hexpand: true,
        text: widget.slideshowFolder || '',
    });
    grid.attach(folderLabel, 0, rowIdx, 1, 1);
    grid.attach(folderEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const intervalLabel = new Gtk.Label({ label: 'Slide Interval (seconds):', xalign: 0 });
    const intervalSpin = Gtk.SpinButton.new_with_range(3, 300, 1);
    intervalSpin.set_value(widget.slideIntervalSeconds || 10);
    grid.attach(intervalLabel, 0, rowIdx, 1, 1);
    grid.attach(intervalSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((widgetData) => {
        widgetData.slideshowFolder = folderEntry.get_text();
        widgetData.slideIntervalSeconds = intervalSpin.get_value_as_int();
    });

    return rowIdx;
}

function buildCommandSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const nameLabel = new Gtk.Label({ label: 'Command Name:', xalign: 0 });
    const nameEntry = new Gtk.Entry({
        placeholder_text: 'e.g. Clear Cache',
        hexpand: true,
        text: widget.commandName || '',
    });
    grid.attach(nameLabel, 0, rowIdx, 1, 1);
    grid.attach(nameEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0 });
    const cmdEntry = new Gtk.Entry({
        placeholder_text: 'e.g. rm -rf ~/.cache/*',
        hexpand: true,
        text: widget.commandString || '',
    });
    grid.attach(cmdLabel, 0, rowIdx, 1, 1);
    grid.attach(cmdEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const imgLabel = new Gtk.Label({ label: 'Image Icon:', xalign: 0 });
    const imgBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const imgLabelDisplay = new Gtk.Label({ label: widget.imagePath ? widget.imagePath.split('/').pop() : 'No image selected', xalign: 0, hexpand: true });
    const imgBtn = new Gtk.Button({ label: 'Choose Image' });
    let selectedImagePath = widget.imagePath || '';

    imgBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: 'Select an Image' });
        const filter = new Gtk.FileFilter();
        filter.set_name('Images');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        filter.add_mime_type('image/svg+xml');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        dialog.set_filters(filters);

        dialog.open(null, null, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                if (file) {
                    selectedImagePath = file.get_path();
                    imgLabelDisplay.set_text(selectedImagePath.split('/').pop());
                }
            } catch (e) {
                console.debug('File selection cancelled:', e.message);
            }
        });
    });

    imgBox.append(imgLabelDisplay);
    imgBox.append(imgBtn);
    grid.attach(imgLabel, 0, rowIdx, 1, 1);
    grid.attach(imgBox, 1, rowIdx, 1, 1);
    rowIdx++;

    const showTextLabel = new Gtk.Label({ label: 'Show Text:', xalign: 0 });
    const showTextSwitch = new Gtk.Switch({
        active: widget.showText !== false,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.START,
    });
    grid.attach(showTextLabel, 0, rowIdx, 1, 1);
    grid.attach(showTextSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const marginLabel = new Gtk.Label({ label: 'Image Margin:', xalign: 0 });
    const marginAdjustment = new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1, page_increment: 10, value: widget.imageMargin || 0 });
    const marginSpinBtn = new Gtk.SpinButton({ adjustment: marginAdjustment, numeric: true, digits: 0, valign: Gtk.Align.CENTER });
    grid.attach(marginLabel, 0, rowIdx, 1, 1);
    grid.attach(marginSpinBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((widgetData) => {
        widgetData.commandName = nameEntry.get_text();
        widgetData.commandString = cmdEntry.get_text();
        widgetData.imagePath = selectedImagePath;
        widgetData.showText = showTextSwitch.get_active();
        widgetData.imageMargin = marginSpinBtn.get_value();
        delete widgetData.iconName;
    });

    return rowIdx;
}

// Shared helper — all addXxxWidget functions delegate here to avoid
// duplicating the parse → findSpot → push → save pattern.
function addWidget(settings, widgetConfig, width, height) {
    let widgets = [];
    try {
        widgets = JSON.parse(settings.get_string('widgets'));
    } catch (e) {
        console.error('Failed to parse widgets:', e);
    }

    const newPos = findEmptySpot(widgets, width, height);
    if (newPos) {
        widgetConfig.x = newPos.x;
        widgetConfig.y = newPos.y;
        widgetConfig.width = width;
        widgetConfig.height = height;
        widgets.push(widgetConfig);
        settings.set_string('widgets', JSON.stringify(widgets));
    } else {
        console.warn('No empty spot found for new widget.');
    }
}

export function addRandomWidget(settings, imagePath, caption = '', showText = undefined) {
    addWidget(settings, {
        id: 'widget-' + Date.now(),
        type: 'image',
        imagePath: imagePath,
        caption: caption,
        showText: showText,
    }, WIDGET_WIDTH, WIDGET_HEIGHT);
}

export function addTimeWidget(settings, width = 3, height = 2) {
    addWidget(settings, {
        id: 'widget-time-' + Date.now(),
        type: 'time',
    }, width, height);
}

export function addMusicWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: 'widget-music-' + Date.now(),
        type: 'music',
    }, width, height);
}

export function addPomodoroWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: 'widget-pomodoro-' + Date.now(),
        type: 'pomodoro',
    }, width, height);
}

export function addCpuRamWidget(settings, width = 3, height = 2) {
    addWidget(settings, {
        id: 'widget-cpu-ram-' + Date.now(),
        type: 'cpu-ram',
    }, width, height);
}

export function addNetworkSpeedWidget(settings, width = 3, height = 2) {
    addWidget(settings, {
        id: 'widget-network-speed-' + Date.now(),
        type: 'network-speed',
    }, width, height);
}

export function addNotesWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: 'widget-notes-' + Date.now(),
        type: 'notes',
    }, width, height);
}

export function addClipboardWidget(settings, width = 4, height = 4) {
    addWidget(settings, {
        id: 'widget-clipboard-' + Date.now(),
        type: 'clipboard',
    }, width, height);
}

export function addCommandWidget(settings, commandName, commandString, imagePath, showText = true, imageMargin = 0, width = 2, height = 2) {
    addWidget(settings, {
        id: 'widget-command-' + Date.now(),
        type: 'command',
        commandName: commandName,
        commandString: commandString,
        imagePath: imagePath,
        showText: showText,
        imageMargin: imageMargin,
    }, width, height);
}

export function openAddCommandDialog(parentWindow, settings) {
    const dialog = new Gtk.Dialog({
        title: `Add Command Launcher`,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });
    
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Add Widget', Gtk.ResponseType.OK);
    
    const content = dialog.get_content_area();
    content.set_margin_top(15);
    content.set_margin_bottom(15);
    content.set_margin_start(15);
    content.set_margin_end(15);
    content.set_spacing(10);
    
    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 12 });
    content.append(grid);

    let rowIdx = 0;

    const nameLabel = new Gtk.Label({ label: 'Command Name:', xalign: 0 });
    const nameEntry = new Gtk.Entry({
        placeholder_text: 'e.g. Clear Cache',
        hexpand: true,
    });
    grid.attach(nameLabel, 0, rowIdx, 1, 1);
    grid.attach(nameEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0 });
    const cmdEntry = new Gtk.Entry({
        placeholder_text: 'e.g. rm -rf ~/.cache/*',
        hexpand: true,
    });
    grid.attach(cmdLabel, 0, rowIdx, 1, 1);
    grid.attach(cmdEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const imgLabel = new Gtk.Label({ label: 'Image Icon:', xalign: 0 });
    const imgBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const imgLabelDisplay = new Gtk.Label({ label: 'No image selected', xalign: 0, hexpand: true });
    const imgBtn = new Gtk.Button({ label: 'Choose Image' });
    let selectedImagePath = '';

    imgBtn.connect('clicked', () => {
        const fileDialog = new Gtk.FileDialog({ title: 'Select an Image' });
        const filter = new Gtk.FileFilter();
        filter.set_name('Images');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        filter.add_mime_type('image/svg+xml');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        fileDialog.set_filters(filters);

        fileDialog.open(parentWindow, null, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                if (file) {
                    selectedImagePath = file.get_path();
                    imgLabelDisplay.set_text(selectedImagePath.split('/').pop());
                }
            } catch (e) {
                console.debug('File selection cancelled:', e.message);
            }
        });
    });

    imgBox.append(imgLabelDisplay);
    imgBox.append(imgBtn);
    grid.attach(imgLabel, 0, rowIdx, 1, 1);
    grid.attach(imgBox, 1, rowIdx, 1, 1);
    rowIdx++;
    
    const showTextLabel = new Gtk.Label({ label: 'Show Text:', xalign: 0 });
    const showTextSwitch = new Gtk.Switch({
        active: true,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.START,
    });
    grid.attach(showTextLabel, 0, rowIdx, 1, 1);
    grid.attach(showTextSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const marginLabel = new Gtk.Label({ label: 'Image Margin:', xalign: 0 });
    const marginAdjustment = new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1, page_increment: 10, value: 0 });
    const marginSpinBtn = new Gtk.SpinButton({ adjustment: marginAdjustment, numeric: true, digits: 0, valign: Gtk.Align.CENTER });
    grid.attach(marginLabel, 0, rowIdx, 1, 1);
    grid.attach(marginSpinBtn, 1, rowIdx, 1, 1);
    rowIdx++;
    
    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const cmdName = nameEntry.get_text().trim() || 'Quick Launch';
            const cmdString = cmdEntry.get_text().trim() || 'echo "Hello World"';
            addCommandWidget(settings, cmdName, cmdString, selectedImagePath, showTextSwitch.get_active(), marginSpinBtn.get_value(), 2, 2);
        }
        dlg.destroy();
    });
    
    dialog.show();
}

export function addSlideshowWidget(settings, folderPath, width = 4, height = 4, caption = '', showText = undefined) {
    addWidget(settings, {
        id: 'widget-slideshow-' + Date.now(),
        type: 'slideshow',
        slideshowFolder: folderPath,
        caption: caption,
        showText: showText,
    }, width, height);
}

export function openAddImageDialog(parentWindow, settings) {
    const dialog = new Gtk.Dialog({
        title: `Add Image / GIF Widget`,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });
    
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Add Widget', Gtk.ResponseType.OK);
    
    const content = dialog.get_content_area();
    content.set_margin_top(15);
    content.set_margin_bottom(15);
    content.set_margin_start(15);
    content.set_margin_end(15);
    content.set_spacing(10);
    
    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 12 });
    content.append(grid);

    let rowIdx = 0;

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0 });
    const captionEntry = new Gtk.Entry({
        placeholder_text: 'e.g. My Favorite Photo',
        hexpand: true,
    });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const imgLabel = new Gtk.Label({ label: 'Image File:', xalign: 0 });
    const imgBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const imgLabelDisplay = new Gtk.Label({ label: 'No image selected', xalign: 0, hexpand: true });
    const imgBtn = new Gtk.Button({ label: 'Choose Image' });
    let selectedImagePath = '';

    imgBtn.connect('clicked', () => {
        const fileDialog = new Gtk.FileDialog({ title: 'Select an Image' });
        const filter = new Gtk.FileFilter();
        filter.set_name('Images');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        filter.add_mime_type('image/gif');
        filter.add_mime_type('image/svg+xml');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        fileDialog.set_filters(filters);

        fileDialog.open(parentWindow, null, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                if (file) {
                    selectedImagePath = file.get_path();
                    imgLabelDisplay.set_text(selectedImagePath.split('/').pop());
                }
            } catch (e) {
                console.debug('File selection cancelled:', e.message);
            }
        });
    });

    imgBox.append(imgLabelDisplay);
    imgBox.append(imgBtn);
    grid.attach(imgLabel, 0, rowIdx, 1, 1);
    grid.attach(imgBox, 1, rowIdx, 1, 1);
    rowIdx++;

    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            if (selectedImagePath) {
                const caption = captionEntry.get_text().trim();
                addRandomWidget(settings, selectedImagePath, caption, undefined);
            }
        }
        dlg.destroy();
    });
    
    dialog.show();
}

export function openAddSlideshowDialog(parentWindow, settings) {
    const dialog = new Gtk.Dialog({
        title: `Add Slideshow Widget`,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });
    
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Add Widget', Gtk.ResponseType.OK);
    
    const content = dialog.get_content_area();
    content.set_margin_top(15);
    content.set_margin_bottom(15);
    content.set_margin_start(15);
    content.set_margin_end(15);
    content.set_spacing(10);
    
    const grid = new Gtk.Grid({ column_spacing: 12, row_spacing: 12 });
    content.append(grid);

    let rowIdx = 0;

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0 });
    const captionEntry = new Gtk.Entry({
        placeholder_text: 'e.g. Vacation Photos',
        hexpand: true,
    });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const folderLabelDisplay = new Gtk.Label({ label: 'No folder selected', xalign: 0, hexpand: true });
    const folderBtn = new Gtk.Button({ label: 'Choose Folder' });
    let selectedFolderPath = '';

    folderBtn.connect('clicked', () => {
        const fileDialog = new Gtk.FileDialog({ title: 'Select Image Folder' });
        fileDialog.select_folder(parentWindow, null, (dlg, res) => {
            try {
                const folder = dlg.select_folder_finish(res);
                if (folder) {
                    selectedFolderPath = folder.get_path();
                    folderLabelDisplay.set_text(selectedFolderPath.split('/').pop());
                }
            } catch (e) {
                console.debug('Folder selection cancelled:', e.message);
            }
        });
    });

    folderBox.append(folderLabelDisplay);
    folderBox.append(folderBtn);
    grid.attach(folderLabel, 0, rowIdx, 1, 1);
    grid.attach(folderBox, 1, rowIdx, 1, 1);
    rowIdx++;

    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            if (selectedFolderPath) {
                const caption = captionEntry.get_text().trim();
                addSlideshowWidget(settings, selectedFolderPath, 4, 4, caption, undefined);
            }
        }
        dlg.destroy();
    });
    
    dialog.show();
}

export function addWeatherWidget(settings, location, width = 3, height = 3) {
    addWidget(settings, {
        id: 'widget-weather-' + Date.now(),
        type: 'weather',
        location: location,
    }, width, height);
}

export function findEmptySpot(widgets, reqWidth, reqHeight) {
    for (let row = 0; row <= ROWS_COUNT - reqHeight; row++) {
        for (let col = 0; col <= COLUMNS_COUNT - reqWidth; col++) {
            if (!checkOverlap(col, row, reqWidth, reqHeight, widgets)) {
                return { x: col, y: row };
            }
        }
    }
    return null;
}



export function performCitySearch(query, resultsList, addButton, selectCallback, settings = null) {
        if (!query || query.length < 2) return;
        
        if (addButton) addButton.set_sensitive(false);
        let child = resultsList.get_first_child();
        while (child) {
            let next = child.get_next_sibling();
            resultsList.remove(child);
            child = next;
        }
        resultsList.set_visible(false);

        let apiKey = '';
        if (settings) {
            apiKey = settings.get_string('weather-api-key');
        }

        if (!apiKey || apiKey.trim() === '') {
            resultsList.append(new Adw.ActionRow({ title: 'Please configure Weather API key in settings first.' }));
            resultsList.set_visible(true);
            return;
        }
        
        const url = `http://api.weatherapi.com/v1/search.json?key=${apiKey}&q=${encodeURIComponent(query)}`;
        const message = Soup.Message.new('GET', url);
        
        if (!searchSession) {
            searchSession = new Soup.Session();
        }
        
        searchSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                if (message.get_status() === 200) {
                    const decoder = new TextDecoder('utf-8');
                    const json = JSON.parse(decoder.decode(bytes.get_data()));
                    
                    if (json.length === 0) {
                        resultsList.append(new Adw.ActionRow({ title: 'No results found.' }));
                        resultsList.set_visible(true);
                        return;
                    }

                    for (const loc of json.slice(0, 5)) {
                        const row = new Adw.ActionRow({
                            title: loc.name,
                            subtitle: `${loc.region ? loc.region + ', ' : ''}${loc.country}`,
                            activatable: true
                        });
                        row.connect('activated', () => {
                            selectCallback(loc.name);
                            if (addButton) addButton.set_sensitive(true);
                            // Clear selection state from all list rows
                            let c = resultsList.get_first_child();
                            while(c) {
                                c.remove_css_class('selected');
                                c = c.get_next_sibling();
                            }
                            row.add_css_class('selected');
                        });
                        resultsList.append(row);
                    }
                    resultsList.set_visible(true);
                }
            } catch (e) {
                console.error('Search error:', e);
                resultsList.append(new Adw.ActionRow({ title: 'Error fetching results.' }));
                resultsList.set_visible(true);
            }
        });
    }
