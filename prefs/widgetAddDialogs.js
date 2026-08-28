import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import { openImageFileDialog, openFolderFileDialog } from './fileDialogs.js';
import {
    addImageWidget,
    addSlideshowWidget,
    addTimeWidget,
    addGithubWidget,
    addRssHeadlinesWidget,
    addSunScheduleWidget,
    addAppLauncherWidget,
} from './widgetAdders.js';
import { createAppSelectionControls } from './appSelection.js';
import { createLiveCitySearchRow, buildOpenMeteoCitySearchRow } from './citySearch.js';
import { buildCaptionRows } from './captionControls.js';

const DIALOG_CONTENT_MARGIN_PX = 15;
const DIALOG_CONTENT_SPACING_PX = 10;
const DIALOG_GRID_SPACING_PX = 12;

export const DEFAULT_WORLD_CLOCK_CITIES = Object.freeze([
    { name: 'London', timezone: 'Europe/London' },
    { name: 'New York', timezone: 'America/New_York' },
    { name: 'Moscow', timezone: 'Europe/Moscow' },
]);

export const MIN_SLIDESHOW_INTERVAL_SEC = 5;
export const MAX_SLIDESHOW_INTERVAL_SEC = 3600;
export const STEP_SLIDESHOW_INTERVAL_SEC = 5;
export const DEFAULT_SLIDESHOW_INTERVAL_SEC = 10;

function createBaseWidgetAddDialog(parentWindow, title) {
    const dialog = new Gtk.Dialog({
        title,
        transient_for: parentWindow,
        modal: true,
        use_header_bar: 1
    });

    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.add_button('Add Widget', Gtk.ResponseType.OK);

    const content = dialog.get_content_area();
    content.set_margin_top(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_bottom(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_start(DIALOG_CONTENT_MARGIN_PX);
    content.set_margin_end(DIALOG_CONTENT_MARGIN_PX);
    content.set_spacing(DIALOG_CONTENT_SPACING_PX);

    const grid = new Gtk.Grid({
        column_spacing: DIALOG_GRID_SPACING_PX,
        row_spacing: DIALOG_GRID_SPACING_PX
    });
    content.append(grid);

    return { dialog, grid };
}

export function openAddAppLauncherDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure App Launcher Widget');
    dialog.set_default_size(560, 560);

    const appSelection = createAppSelectionControls(grid, 0);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const selectedApps = appSelection.getSelectedApps();
            if (selectedApps.length > 0) {
                addAppLauncherWidget(settings, selectedApps);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddImageDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Image Widget');

    const imagePathLabel = new Gtk.Label({ label: 'Image File:', xalign: 0 });
    const imagePathEntry = new Gtk.Entry({ placeholder_text: 'Select image file...', hexpand: true });
    const imageBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    imageBrowseBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                imagePathEntry.set_text(selectedPath);
            }
        });
    });

    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    imagePathBox.append(imagePathEntry);
    imagePathBox.append(imageBrowseBtn);

    grid.attach(imagePathLabel, 0, 0, 1, 1);
    grid.attach(imagePathBox, 1, 0, 1, 1);

    const { captionEntry, showCaptionSwitch } = buildCaptionRows(grid, 1, 'My Image');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const imagePath = imagePathEntry.get_text().trim();
            if (imagePath) {
                addImageWidget(settings, imagePath, captionEntry.get_text().trim(), showCaptionSwitch.get_active(), 4, 3);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddSlideshowDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Slideshow Widget');

    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderEntry = new Gtk.Entry({ placeholder_text: 'Select folder...', hexpand: true });
    const folderBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    folderBrowseBtn.connect('clicked', () => {
        openFolderFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                folderEntry.set_text(selectedPath);
            }
        });
    });

    const folderBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    folderBox.append(folderEntry);
    folderBox.append(folderBrowseBtn);

    grid.attach(folderLabel, 0, 0, 1, 1);
    grid.attach(folderBox, 1, 0, 1, 1);

    const intervalLabel = new Gtk.Label({ label: 'Interval (seconds):', xalign: 0 });
    const intervalSpin = Gtk.SpinButton.new_with_range(MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC);
    intervalSpin.set_value(DEFAULT_SLIDESHOW_INTERVAL_SEC);
    grid.attach(intervalLabel, 0, 1, 1, 1);
    grid.attach(intervalSpin, 1, 1, 1, 1);

    const { captionEntry, showCaptionSwitch } = buildCaptionRows(grid, 2, 'My Slideshow');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const folderPath = folderEntry.get_text().trim();
            if (folderPath) {
                addSlideshowWidget(settings, folderPath, intervalSpin.get_value_as_int(), 4, 3, captionEntry.get_text().trim(), showCaptionSwitch.get_active());
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddWorldClockDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure World Clock Widget');

    const [primaryDefault, sec1Default, sec2Default] = DEFAULT_WORLD_CLOCK_CITIES;
    const primaryPicker = createLiveCitySearchRow(grid, 'Primary City (Top):', primaryDefault, 0);
    const sec1Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Left):', sec1Default, 1);
    const sec2Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Right):', sec2Default, 2);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const primaryCity = primaryPicker.getSelectedCity();
            const sec1City = sec1Picker.getSelectedCity();
            const sec2City = sec2Picker.getSelectedCity();
            addTimeWidget(settings, 4, 4, 'world', [primaryCity, sec1City, sec2City]);
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddGithubDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure GitHub Activity Widget');

    const userLabel = new Gtk.Label({ label: 'GitHub Username:', xalign: 0 });
    const userEntry = new Gtk.Entry({ placeholder_text: 'e.g. rebatnaath', hexpand: true });
    grid.attach(userLabel, 0, 0, 1, 1);
    grid.attach(userEntry, 1, 0, 1, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const username = userEntry.get_text().trim().replace(/^@/, '');
            if (username) {
                addGithubWidget(settings, username);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

function openAddRssUrlDialog(parentWindow, settings, title, hintText, addWidget) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, title);

    const urlLabel = new Gtk.Label({ label: 'Feed URL:', xalign: 0 });
    const urlEntry = new Gtk.Entry({
        placeholder_text: 'https://example.com/feed.xml',
        hexpand: true,
        input_purpose: Gtk.InputPurpose.URL,
    });
    grid.attach(urlLabel, 0, 0, 1, 1);
    grid.attach(urlEntry, 1, 0, 1, 1);

    const hintLabel = new Gtk.Label({
        label: hintText,
        xalign: 0,
        hexpand: true,
        css_classes: ['dim-label'],
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 44,
    });
    grid.attach(hintLabel, 0, 1, 2, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            addWidget(settings, urlEntry.get_text().trim());
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddRssHeadlinesDialog(parentWindow, settings) {
    openAddRssUrlDialog(
        parentWindow,
        settings,
        'Configure RSS Headlines Widget',
        'Tip: the card auto-rotates through recent article headlines.',
        addRssHeadlinesWidget
    );
}

export function openAddSunScheduleDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Solar Schedule Widget');

    const locationPicker = buildOpenMeteoCitySearchRow(grid, 'City Location:', null, 0);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const location = locationPicker.getSelectedLocation();
            if (location && location.name && location.latitude !== undefined && location.longitude !== undefined) {
                addSunScheduleWidget(settings, location.name, location.latitude, location.longitude);
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}
