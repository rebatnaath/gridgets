/**
 * ============================================================================
 * PREFERENCES: WIDGET ADD DIALOGS
 * 
 * GTK Dialog windows for configuring and adding new Command, Image, and Slideshow
 * widgets.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import { openImageFileDialog, openFolderFileDialog } from './fileDialogs.js';
import { addCommandWidget, addImageWidget, addSlideshowWidget } from './widgetAdders.js';

export function buildIconSelectionControls(grid, rowIdx, defaultIcon = 'system-run-symbolic', defaultImagePath = '', parentWindow = null) {
    const iconTypeLabel = new Gtk.Label({ label: 'Icon Source:', xalign: 0 });
    const iconTypeCombo = new Gtk.DropDown({
        model: Gtk.StringList.new(['Symbolic System Icon', 'Custom Image File']),
        valign: Gtk.Align.CENTER
    });
    iconTypeCombo.set_selected(defaultImagePath ? 1 : 0);
    grid.attach(iconTypeLabel, 0, rowIdx, 1, 1);
    grid.attach(iconTypeCombo, 1, rowIdx, 1, 1);
    rowIdx++;

    const iconEntryLabel = new Gtk.Label({ label: 'Symbolic Icon Name:', xalign: 0 });
    const iconEntry = new Gtk.Entry({ text: defaultIcon, placeholder_text: 'e.g. system-run-symbolic', hexpand: true });
    grid.attach(iconEntryLabel, 0, rowIdx, 1, 1);
    grid.attach(iconEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const customImgLabel = new Gtk.Label({ label: 'Custom Image:', xalign: 0 });
    const customImgBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const customImgPathLabel = new Gtk.Label({ label: defaultImagePath ? defaultImagePath.split('/').pop() : 'No image selected', xalign: 0, hexpand: true });
    const customImgBtn = new Gtk.Button({ label: 'Choose File' });
    let selectedImagePath = defaultImagePath;

    customImgBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, 'Select Custom Icon Image', (selectedPath) => {
            selectedImagePath = selectedPath;
            customImgPathLabel.set_text(selectedImagePath.split('/').pop());
        });
    });

    customImgBox.append(customImgPathLabel);
    customImgBox.append(customImgBtn);
    grid.attach(customImgLabel, 0, rowIdx, 1, 1);
    grid.attach(customImgBox, 1, rowIdx, 1, 1);
    rowIdx++;

    const updateVisibility = () => {
        const isSymbolic = iconTypeCombo.get_selected() === 0;
        iconEntryLabel.set_visible(isSymbolic);
        iconEntry.set_visible(isSymbolic);
        customImgLabel.set_visible(!isSymbolic);
        customImgBox.set_visible(!isSymbolic);
    };

    iconTypeCombo.connect('notify::selected', updateVisibility);
    updateVisibility();

    return {
        nextRowIdx: rowIdx,
        getSelectedValues: () => {
            const isSymbolic = iconTypeCombo.get_selected() === 0;
            return {
                iconName: isSymbolic ? (iconEntry.get_text().trim() || 'system-run-symbolic') : '',
                imagePath: isSymbolic ? '' : selectedImagePath,
            };
        }
    };
}

export function openAddCommandDialog(parentWindow, settings) {
    const dialog = new Gtk.Dialog({
        title: `Add Command Launcher Widget`,
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
    const nameEntry = new Gtk.Entry({ placeholder_text: 'e.g. Clear Cache', hexpand: true });
    grid.attach(nameLabel, 0, rowIdx, 1, 1);
    grid.attach(nameEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0 });
    const cmdEntry = new Gtk.Entry({ placeholder_text: 'e.g. rm -rf ~/.cache/*', hexpand: true });
    grid.attach(cmdLabel, 0, rowIdx, 1, 1);
    grid.attach(cmdEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const iconControls = buildIconSelectionControls(grid, rowIdx, 'system-run-symbolic', '', parentWindow);
    rowIdx = iconControls.nextRowIdx;

    const showTextLabel = new Gtk.Label({ label: 'Show Text:', xalign: 0 });
    const showTextSwitch = new Gtk.Switch({ active: true, valign: Gtk.Align.CENTER, halign: Gtk.Align.START });
    grid.attach(showTextLabel, 0, rowIdx, 1, 1);
    grid.attach(showTextSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const updateDialogSensitivities = () => {
        const hasCommand = cmdEntry.get_text().trim().length > 0;
        dialog.set_response_sensitive(Gtk.ResponseType.OK, hasCommand);
    };
    cmdEntry.connect('changed', updateDialogSensitivities);
    updateDialogSensitivities();

    dialog.connect('response', (dlg, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const { iconName, imagePath } = iconControls.getSelectedValues();
            const cmdName = nameEntry.get_text().trim() || 'Quick Launch';
            const cmdString = cmdEntry.get_text().trim() || 'echo "Hello World"';
            const selIcon = iconName || 'system-run-symbolic';
            addCommandWidget(settings, cmdName, cmdString, selIcon, imagePath, showTextSwitch.get_active(), 2, 2);
        }
        dlg.destroy();
    });
    
    dialog.show();
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
    const captionEntry = new Gtk.Entry({ placeholder_text: 'e.g. My Favorite Photo', hexpand: true });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const imgLabel = new Gtk.Label({ label: 'Image File:', xalign: 0 });
    const imgBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const imgLabelDisplay = new Gtk.Label({ label: 'No image selected', xalign: 0, hexpand: true });
    const imgBtn = new Gtk.Button({ label: 'Choose Image' });
    let selectedImagePath = '';

    imgBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, 'Select an Image', (selectedPath) => {
            selectedImagePath = selectedPath;
            imgLabelDisplay.set_text(selectedImagePath.split('/').pop());
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
                addImageWidget(settings, selectedImagePath, caption, undefined);
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
    const captionEntry = new Gtk.Entry({ placeholder_text: 'e.g. Vacation Photos', hexpand: true });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const folderLabelDisplay = new Gtk.Label({ label: 'No folder selected', xalign: 0, hexpand: true });
    const folderBtn = new Gtk.Button({ label: 'Choose Folder' });
    let selectedFolderPath = '';

    folderBtn.connect('clicked', () => {
        openFolderFileDialog(parentWindow, 'Select Image Folder', (selectedPath) => {
            selectedFolderPath = selectedPath;
            folderLabelDisplay.set_text(selectedFolderPath.split('/').pop());
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
