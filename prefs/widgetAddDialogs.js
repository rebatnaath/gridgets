import Gtk from 'gi://Gtk';
import { openImageFileDialog, openFolderFileDialog } from './fileDialogs.js';
import {
    addImageWidget,
    addSlideshowWidget,
    addTimeWidget,
    addWeatherWidget,
    addGithubWidget,
    addRssHeadlinesWidget,
    addSunTimesWidget,
    addAppLauncherWidget,
    addTopStoriesWidget,
} from './widgetAdders.js';
import { createAppSelectionControls } from './appSelection.js';
import { createGnomeClocksLocationPicker } from './gnomeClocksLocations.js';
import { createGnomeWeatherLocationPicker } from './gnomeWeatherLocations.js';
import { buildCaptionRows } from './captionControls.js';
import { STORE_WIDGETS, parseStoreGridSize } from './widgetCatalog.js';
import { MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';
import { DEFAULT_TOP_STORY_GENRE, TOP_STORY_GENRE_LABELS, TOP_STORY_GENRE_NAMES } from '../utils/widgetRegistry.js';

export { MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC, DEFAULT_SLIDESHOW_INTERVAL_SEC } from './widgetConstants.js';

const DIALOG_CONTENT_MARGIN_PX = 15;
const DIALOG_CONTENT_SPACING_PX = 10;
const DIALOG_GRID_SPACING_PX = 12;

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

    const { captionEntry, showCaptionSwitch, useDateCaptionSwitch } = buildCaptionRows(grid, 1, 'My Image');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const imagePath = imagePathEntry.get_text().trim();
            if (imagePath) {
                const { width, height } = parseStoreGridSize(STORE_WIDGETS.imageGif.gridSize);
                addImageWidget(settings, imagePath, captionEntry.get_text().trim(), showCaptionSwitch.get_active(), width, height, useDateCaptionSwitch.get_active());
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddTopStoriesDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Top Stories Widget');

    const genreLabel = new Gtk.Label({ label: 'Genre:', xalign: 0 });
    const genreList = new Gtk.StringList();
    for (const genre of TOP_STORY_GENRE_NAMES)
        genreList.append(TOP_STORY_GENRE_LABELS[genre] || genre);

    // Gtk.DropDown rather than Adw.ComboRow: the theme picker uses ComboRow because it
    // lives on an Adw page, but ComboRow is a GtkListBoxRow and trips
    // gtk_list_box_row_grab_focus when hosted in this plain Gtk.Dialog. Selection is
    // index-based, like the theme row, so no id column is involved.
    const genreRow = new Gtk.DropDown({ hexpand: true });
    genreRow.set_model(genreList);
    const defaultIndex = TOP_STORY_GENRE_NAMES.indexOf(DEFAULT_TOP_STORY_GENRE);
    if (genreList.get_n_items() > 0)
        genreRow.set_selected(defaultIndex === -1 ? 0 : defaultIndex);
    grid.attach(genreLabel, 0, 0, 1, 1);
    grid.attach(genreRow, 1, 0, 1, 1);

    const hint = new Gtk.Label({
        label: 'Switch any time from the widget\u2019s right-click menu.',
        xalign: 0,
        max_width_chars: 40,
    });
    hint.get_style_context().add_class('dim-label');
    grid.attach(hint, 0, 1, 2, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const index = genreRow.get_selected();
            const genre = index >= 0 && index < TOP_STORY_GENRE_NAMES.length
                ? TOP_STORY_GENRE_NAMES[index]
                : DEFAULT_TOP_STORY_GENRE;
            addTopStoriesWidget(settings, genre);
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

    const { captionEntry, showCaptionSwitch, useDateCaptionSwitch } = buildCaptionRows(grid, 2, 'My Slideshow');

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const folderPath = folderEntry.get_text().trim();
            if (folderPath) {
                const { width, height } = parseStoreGridSize(STORE_WIDGETS.imageSlideshow.gridSize);
                addSlideshowWidget(settings, folderPath, intervalSpin.get_value_as_int(), width, height, captionEntry.get_text().trim(), showCaptionSwitch.get_active(), useDateCaptionSwitch.get_active());
            }
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddWorldClockDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure World Clock Widget');

    const createPicker = (label, row, initialIndex) => {
        const picker = createGnomeClocksLocationPicker(null, initialIndex);
        const pickerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
        });
        const pickerRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            hexpand: true,
        });
        const labelWidget = new Gtk.Label({ label, xalign: 0, valign: Gtk.Align.CENTER });
        pickerRow.append(labelWidget);
        pickerRow.append(picker.locationWidget);
        pickerBox.append(pickerRow);
        pickerBox.append(picker.supportingWidget);
        grid.attach(pickerBox, 0, row, 2, 1);
        return picker;
    };

    const primaryPicker = createPicker('Primary City (Top):', 0, 0);
    const sec1Picker = createPicker('Secondary City (Bottom Left):', 2, 1);
    const sec2Picker = createPicker('Secondary City (Bottom Right):', 4, 2);
    grid.attach(primaryPicker.actionWidget, 0, 6, 2, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const primaryCity = primaryPicker.getSelectedLocation();
            const sec1City = sec1Picker.getSelectedLocation();
            const sec2City = sec2Picker.getSelectedLocation();
            if (primaryCity && sec1City && sec2City) {
                addTimeWidget(settings, 'world', [primaryCity, sec1City, sec2City]);
            }
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

export function openAddWeatherDialog(parentWindow, settings, layout) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Weather Widget');
    let addButton = null;
    const locationPicker = createGnomeWeatherLocationPicker(null, (hasLocations) => {
        if (addButton) addButton.set_sensitive(hasLocations);
    });
    const locationLabel = new Gtk.Label({ label: 'City Location:', xalign: 0 });
    grid.attach(locationLabel, 0, 0, 1, 1);
    grid.attach(locationPicker.locationWidget, 1, 0, 1, 1);
    grid.attach(locationPicker.supportingWidget, 0, 1, 2, 1);

    addButton = dialog.get_widget_for_response(Gtk.ResponseType.OK);
    addButton.set_sensitive(locationPicker.hasLocations);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const location = locationPicker.getSelectedLocation();
            if (location) addWeatherWidget(settings, location, layout);
        }
        dialogWindow.destroy();
    });

    dialog.present();
}

export function openAddSunTimesDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Sun Times Widget');
    let addButton = null;
    const locationPicker = createGnomeWeatherLocationPicker(null, (hasLocations) => {
        if (addButton) addButton.set_sensitive(hasLocations);
    });
    const locationLabel = new Gtk.Label({ label: 'City Location:', xalign: 0 });
    grid.attach(locationLabel, 0, 0, 1, 1);
    grid.attach(locationPicker.locationWidget, 1, 0, 1, 1);
    grid.attach(locationPicker.supportingWidget, 0, 1, 2, 1);

    addButton = dialog.get_widget_for_response(Gtk.ResponseType.OK);
    addButton.set_sensitive(locationPicker.hasLocations);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const location = locationPicker.getSelectedLocation();
            if (location) addSunTimesWidget(settings, location.name, location.latitude, location.longitude);
        }
        dialogWindow.destroy();
    });

    dialog.present();
}
