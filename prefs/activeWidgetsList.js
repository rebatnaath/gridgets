/**
 * ============================================================================
 * PREFERENCES: ACTIVE WIDGETS LIST
 * 
 * Generates rows for currently placed desktop widgets with edit/delete actions.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { getWidgets, saveWidgets, deleteCacheFile } from '../utils/widgetUtils.js';
import { openWidgetEditDialog } from './widgetEditDialogs.js';

export function populateActiveWidgets(window, settings, group, extensionPath) {
    if (group.activeRows) {
        for (const row of group.activeRows) {
            group.remove(row);
        }
    }
    group.activeRows = [];

    const widgets = getWidgets(settings);

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
            saveWidgets(settings, newWidgets);
        });
        
        buttonsBox.append(deleteBtn);
        row.add_suffix(buttonsBox);
        group.add(row);
        group.activeRows.push(row);
    }
}
