/**
 * ============================================================================
 * PREFERENCES: WIDGET ADD DIALOGS
 * 
 * GTK Dialog windows for configuring and adding new Command, Image, Slideshow,
 * and World Clock widgets.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { openImageFileDialog, openFolderFileDialog } from './fileDialogs.js';
import {
    addCommandWidget,
    addImageWidget,
    addSlideshowWidget,
    addTimeWidget,
    addAppLauncherWidget,
} from './widgetAdders.js';
import { MAX_APP_LAUNCHER_ITEMS, normalizeAppLauncherApps } from '../utils/widgetUtils.js';

/** Dialog metric constants */
const DIALOG_CONTENT_MARGIN_PX = 15;
const DIALOG_CONTENT_SPACING_PX = 10;
const DIALOG_GRID_SPACING_PX = 12;

/** Slideshow interval constants */
const MIN_SLIDESHOW_INTERVAL_SEC = 5;
const MAX_SLIDESHOW_INTERVAL_SEC = 3600;
const STEP_SLIDESHOW_INTERVAL_SEC = 5;
const DEFAULT_SLIDESHOW_INTERVAL_SEC = 10;

/** Search configuration constants */
const MIN_QUERY_LENGTH = 2;
const MAX_SEARCH_RESULTS_COUNT = 15;
const MAX_SCROLLED_WINDOW_HEIGHT_PX = 160;

/** Creates a standard widget configuration dialog frame with grid layout. */
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

const COMMON_SYMBOLIC_ICONS = [
    'utilities-terminal-symbolic', 'system-run-symbolic', 'system-search-symbolic',
    'system-shutdown-symbolic', 'system-reboot-symbolic', 'system-lock-screen-symbolic',
    'system-file-manager-symbolic', 'preferences-system-symbolic', 'emblem-system-symbolic',
    'network-workgroup-symbolic', 'network-wireless-symbolic', 'text-editor-symbolic',
    'web-browser-symbolic', 'audio-x-generic-symbolic', 'camera-photo-symbolic',
    'video-display-symbolic', 'view-refresh-symbolic', 'folder-symbolic',
    'document-edit-symbolic', 'starred-symbolic', 'user-trash-symbolic',
    'help-about-symbolic', 'mail-unread-symbolic', 'weather-clear-symbolic',
    'media-playback-start-symbolic', 'media-playback-pause-symbolic', 'battery-good-symbolic',
    'bluetooth-active-symbolic', 'drive-harddisk-symbolic', 'printer-symbolic',
    'dialog-information-symbolic', 'view-grid-symbolic'
];

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

    const iconPickerLabel = new Gtk.Label({ label: 'Select Symbolic Icon:', xalign: 0, valign: Gtk.Align.START, margin_top: 4 });
    const iconPickerBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, hexpand: true });

    const flowBox = new Gtk.FlowBox({
        max_children_per_line: 8,
        min_children_per_line: 6,
        selection_mode: Gtk.SelectionMode.SINGLE,
        homogeneous: true,
        column_spacing: 4,
        row_spacing: 4,
        hexpand: true,
        valign: Gtk.Align.CENTER
    });

    let selectedIconName = defaultIcon;

    COMMON_SYMBOLIC_ICONS.forEach((iconName) => {
        const btn = new Gtk.Button({
            tooltip_text: iconName,
            css_classes: iconName === defaultIcon ? ['circular', 'card'] : ['flat', 'circular'],
            icon_name: iconName
        });
        btn.set_size_request(38, 38);

        btn.connect('clicked', () => {
            selectedIconName = iconName;

            let child = flowBox.get_first_child();
            while (child) {
                const childBtn = child.get_child();
                if (childBtn && childBtn.set_css_classes) {
                    const isCurrent = childBtn.get_tooltip_text() === iconName;
                    childBtn.set_css_classes(isCurrent ? ['circular', 'card'] : ['flat', 'circular']);
                }
                child = child.get_next_sibling();
            }
        });

        flowBox.append(btn);
    });

    const flowBoxScrolled = new Gtk.ScrolledWindow({
        max_content_height: 220,
        min_content_height: 180,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        margin_top: 4,
        margin_bottom: 4,
        margin_start: 2,
        margin_end: 2
    });
    flowBoxScrolled.set_child(flowBox);

    iconPickerBox.append(flowBoxScrolled);

    grid.attach(iconPickerLabel, 0, rowIdx, 1, 1);
    grid.attach(iconPickerBox, 1, rowIdx, 1, 1);
    rowIdx++;

    const imagePathLabel = new Gtk.Label({ label: 'Custom Image:', xalign: 0 });
    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    const imagePathEntry = new Gtk.Entry({ text: defaultImagePath, placeholder_text: '/path/to/icon.png', hexpand: true });
    const imageBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    imageBrowseBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, (selectedPath) => {
            imagePathEntry.set_text(selectedPath);
        });
    });

    imagePathBox.append(imagePathEntry);
    imagePathBox.append(imageBrowseBtn);

    grid.attach(imagePathLabel, 0, rowIdx, 1, 1);
    grid.attach(imagePathBox, 1, rowIdx, 1, 1);

    const updateVisibility = () => {
        const isCustomImage = iconTypeCombo.get_selected() === 1;
        iconPickerLabel.set_visible(!isCustomImage);
        iconPickerBox.set_visible(!isCustomImage);
        imagePathLabel.set_visible(isCustomImage);
        imagePathBox.set_visible(isCustomImage);
    };

    iconTypeCombo.connect('notify::selected', updateVisibility);
    updateVisibility();

    return {
        getIconConfig: () => {
            const isCustomImage = iconTypeCombo.get_selected() === 1;
            if (isCustomImage) {
                return {
                    icon: 'system-run-symbolic',
                    iconPath: imagePathEntry.get_text().trim()
                };
            }
            return {
                icon: selectedIconName || defaultIcon || 'utilities-terminal-symbolic',
                iconPath: ''
            };
        }
    };
}

export function openAddCommandDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Command Launcher Widget');

    const titleLabel = new Gtk.Label({ label: 'Widget Label:', xalign: 0 });
    const titleEntry = new Gtk.Entry({ placeholder_text: 'e.g. Launch Terminal', hexpand: true });
    grid.attach(titleLabel, 0, 0, 1, 1);
    grid.attach(titleEntry, 1, 0, 1, 1);

    const cmdLabel = new Gtk.Label({ label: 'Bash Command:', xalign: 0 });
    const cmdEntry = new Gtk.Entry({ placeholder_text: 'e.g. ptyxis, htop, echo "Hello World"', hexpand: true });
    grid.attach(cmdLabel, 0, 1, 1, 1);
    grid.attach(cmdEntry, 1, 1, 1, 1);

    const showTextLabel = new Gtk.Label({ label: 'Show Label / Text:', xalign: 0 });
    const showTextSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showTextSwitch.set_active(true);
    grid.attach(showTextLabel, 0, 2, 1, 1);
    grid.attach(showTextSwitch, 1, 2, 1, 1);

    const iconControls = buildIconSelectionControls(grid, 3, 'utilities-terminal-symbolic', '', parentWindow);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const label = titleEntry.get_text().trim() || 'Terminal';
            const command = cmdEntry.get_text().trim() || 'ptyxis';
            const showText = showTextSwitch.get_active();
            const { icon, iconPath } = iconControls.getIconConfig();
            addCommandWidget(settings, label, command, icon, iconPath, showText);
        }
        dialogWindow.destroy();
    });

    dialog.show();
}

export function openAddAppLauncherDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure App Launcher Widget');
    dialog.set_default_size(560, 560);

    const appSelection = createAppSelectionControls(grid, 0);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const selectedApps = appSelection.getSelectedApps();
            addAppLauncherWidget(settings, selectedApps);
        }
        dialogWindow.destroy();
    });

    dialog.show();
}

export function openAddImageDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Image / GIF Widget');

    const imagePathLabel = new Gtk.Label({ label: 'Image File:', xalign: 0 });
    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    const imagePathEntry = new Gtk.Entry({ placeholder_text: 'Select image file...', hexpand: true });
    const imageBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    imageBrowseBtn.connect('clicked', () => {
        openImageFileDialog(parentWindow, (selectedPath) => {
            if (selectedPath) {
                imagePathEntry.set_text(selectedPath);
            }
        });
    });

    imagePathBox.append(imagePathEntry);
    imagePathBox.append(imageBrowseBtn);
    grid.attach(imagePathLabel, 0, 0, 1, 1);
    grid.attach(imagePathBox, 1, 0, 1, 1);

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0 });
    const captionEntry = new Gtk.Entry({ placeholder_text: 'My Image', hexpand: true });
    grid.attach(captionLabel, 0, 1, 1, 1);
    grid.attach(captionEntry, 1, 1, 1, 1);

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0 });
    const showCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showCaptionSwitch.set_active(true);
    grid.attach(showCaptionLabel, 0, 2, 1, 1);
    grid.attach(showCaptionSwitch, 1, 2, 1, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const imagePath = imagePathEntry.get_text().trim();
            const rawCaption = captionEntry.get_text().trim();
            const caption = rawCaption || 'My Image';
            const showCaption = showCaptionSwitch.get_active();
            if (imagePath) {
                addImageWidget(settings, imagePath, caption, showCaption, 2, 2);
            }
        }
        dialogWindow.destroy();
    });

    dialog.show();
}

export function openAddSlideshowDialog(parentWindow, settings) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure Image Slideshow Widget');

    const folderLabel = new Gtk.Label({ label: 'Image Folder:', xalign: 0 });
    const folderBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    const folderEntry = new Gtk.Entry({ placeholder_text: 'Select folder containing images...', hexpand: true });
    const folderBrowseBtn = new Gtk.Button({ label: 'Browse...' });

    folderBrowseBtn.connect('clicked', () => {
        openFolderFileDialog(parentWindow, (selectedFolder) => {
            if (selectedFolder) {
                folderEntry.set_text(selectedFolder);
            }
        });
    });

    folderBox.append(folderEntry);
    folderBox.append(folderBrowseBtn);
    grid.attach(folderLabel, 0, 0, 1, 1);
    grid.attach(folderBox, 1, 0, 1, 1);

    const intervalLabel = new Gtk.Label({ label: 'Interval (seconds):', xalign: 0 });
    const intervalSpin = Gtk.SpinButton.new_with_range(MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC);
    intervalSpin.set_value(DEFAULT_SLIDESHOW_INTERVAL_SEC);
    grid.attach(intervalLabel, 0, 1, 1, 1);
    grid.attach(intervalSpin, 1, 1, 1, 1);

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0 });
    const captionEntry = new Gtk.Entry({ placeholder_text: 'My Slideshow', hexpand: true });
    grid.attach(captionLabel, 0, 2, 1, 1);
    grid.attach(captionEntry, 1, 2, 1, 1);

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0 });
    const showCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showCaptionSwitch.set_active(true);
    grid.attach(showCaptionLabel, 0, 3, 1, 1);
    grid.attach(showCaptionSwitch, 1, 3, 1, 1);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const folderPath = folderEntry.get_text().trim();
            const interval = intervalSpin.get_value_as_int();
            const rawCaption = captionEntry.get_text().trim();
            const caption = rawCaption || 'My Slideshow';
            const showCaption = showCaptionSwitch.get_active();
            if (folderPath) {
                addSlideshowWidget(settings, folderPath, interval, 4, 4, caption, showCaption);
            }
        }
        dialogWindow.destroy();
    });

    dialog.show();
}

const clearBox = (box) => {
    let child = box.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
    }
};

let cachedCitiesDatabase = null;
let cachedDesktopApplications = null;

function getDesktopApplications() {
    if (cachedDesktopApplications) {
        return cachedDesktopApplications;
    }

    const applications = [];
    const seenIds = new Set();
    for (const appInfo of Gio.AppInfo.get_all()) {
        const appId = appInfo.get_id();
        if (!appId || seenIds.has(appId)) {
            continue;
        }

        if (!appInfo.should_show()) {
            continue;
        }

        seenIds.add(appId);
        applications.push({
            id: appId,
            name: appInfo.get_display_name() || appInfo.get_name() || appId,
            description: appInfo.get_description() || '',
            icon: appInfo.get_icon() || null,
        });
    }

    applications.sort((leftApp, rightApp) => leftApp.name.localeCompare(rightApp.name));
    cachedDesktopApplications = applications;
    return cachedDesktopApplications;
}

function setAppSelectionSummary(summaryLabel, helperLabel, selectedApps, statusMessage = '') {
    const selectedEntries = [...selectedApps.values()];
    const selectedNames = selectedEntries.slice(0, 4).map(app => app.name);
    const extraCount = selectedEntries.length - selectedNames.length;
    const previewText = selectedNames.length > 0
        ? `${selectedNames.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''}`
        : 'None';

    summaryLabel.set_markup(
        `<span size='small' weight='bold'>Selected (${selectedEntries.length}/${MAX_APP_LAUNCHER_ITEMS}): ${GLib.markup_escape_text(previewText, -1)}</span>`
    );

    const helperText = statusMessage || `Choose up to ${MAX_APP_LAUNCHER_ITEMS} applications.`;
    helperLabel.set_markup(
        `<span size='x-small' alpha='70%'>${GLib.markup_escape_text(helperText, -1)}</span>`
    );
}

export function createAppSelectionControls(grid, rowIdx, defaultApps = []) {
    const selectedApps = new Map(
        normalizeAppLauncherApps(defaultApps).map(app => [app.id, app])
    );

    const label = new Gtk.Label({
        label: 'Applications:',
        xalign: 0,
    });

    const controlsBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        hexpand: true,
        valign: Gtk.Align.START,
    });

    controlsBox.append(label);

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search installed applications...',
        hexpand: true,
    });

    const summaryLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
    });

    const helperLabel = new Gtk.Label({
        xalign: 0,
        wrap: true,
    });

    const resultsListBox = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        max_content_height: 320,
        min_content_height: 220,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    });
    scrolledWindow.set_child(resultsListBox);

    const desktopApplications = getDesktopApplications();

    const renderAppRows = () => {
        clearBox(resultsListBox);

        const query = searchEntry.get_text().trim().toLowerCase();
        const filteredApps = desktopApplications
            .filter(app => {
                if (query === '') {
                    return true;
                }

                const haystacks = [app.name, app.description, app.id]
                    .filter(Boolean)
                    .map(value => value.toLowerCase());
                return haystacks.some(value => value.includes(query));
            })
            .slice(0, 80);

        if (filteredApps.length === 0) {
            const emptyRow = new Gtk.ListBoxRow({ selectable: false, activatable: false });
            const emptyLabel = new Gtk.Label({
                label: 'No matching applications found.',
                xalign: 0,
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 10,
                margin_end: 10,
            });
            emptyRow.set_child(emptyLabel);
            resultsListBox.append(emptyRow);
            return;
        }

        for (const app of filteredApps) {
            const row = new Gtk.ListBoxRow({ selectable: false, activatable: false });
            const rowBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 10,
                margin_top: 8,
                margin_bottom: 8,
                margin_start: 10,
                margin_end: 10,
            });

            const icon = new Gtk.Image({
                gicon: app.icon,
                pixel_size: 24,
                valign: Gtk.Align.CENTER,
            });

            const textBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                hexpand: true,
                valign: Gtk.Align.CENTER,
            });

            const nameLabel = new Gtk.Label({
                label: app.name,
                xalign: 0,
                hexpand: true,
            });

            const detailParts = [app.description, app.id].filter(Boolean);
            const detailLabel = new Gtk.Label({
                xalign: 0,
                wrap: true,
            });
            detailLabel.set_markup(
                `<span size='small' alpha='65%'>${GLib.markup_escape_text(detailParts.join(' • '), -1)}</span>`
            );

            textBox.append(nameLabel);
            textBox.append(detailLabel);

            const toggleButton = new Gtk.CheckButton({
                active: selectedApps.has(app.id),
                valign: Gtk.Align.CENTER,
            });

            let isInternalToggle = false;
            toggleButton.connect('toggled', () => {
                if (isInternalToggle) {
                    return;
                }

                const shouldSelect = toggleButton.get_active();
                if (shouldSelect) {
                    if (!selectedApps.has(app.id) && selectedApps.size >= MAX_APP_LAUNCHER_ITEMS) {
                        isInternalToggle = true;
                        toggleButton.set_active(false);
                        isInternalToggle = false;
                        setAppSelectionSummary(
                            summaryLabel,
                            helperLabel,
                            selectedApps,
                            `You can add up to ${MAX_APP_LAUNCHER_ITEMS} applications.`
                        );
                        return;
                    }

                    selectedApps.set(app.id, { id: app.id, name: app.name });
                } else {
                    selectedApps.delete(app.id);
                }

                setAppSelectionSummary(summaryLabel, helperLabel, selectedApps);
            });

            rowBox.append(icon);
            rowBox.append(textBox);
            rowBox.append(toggleButton);
            row.set_child(rowBox);
            resultsListBox.append(row);
        }
    };

    setAppSelectionSummary(summaryLabel, helperLabel, selectedApps);
    renderAppRows();
    searchEntry.connect('search-changed', renderAppRows);

    controlsBox.append(searchEntry);
    controlsBox.append(summaryLabel);
    controlsBox.append(helperLabel);
    controlsBox.append(scrolledWindow);

    grid.attach(controlsBox, 0, rowIdx, 2, 1);

    return {
        getSelectedApps: () => normalizeAppLauncherApps([...selectedApps.values()]),
    };
}

function getCitiesDatabase(extensionPath) {
    if (cachedCitiesDatabase && cachedCitiesDatabase.length > 0) return cachedCitiesDatabase;

    const possiblePaths = [];
    if (extensionPath) {
        possiblePaths.push(`${extensionPath}/assets/datas/cities.json`);
        possiblePaths.push(`${extensionPath}/assets/cities.json`);
    }

    const userExtDir = GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'gnome-shell',
        'extensions',
        'gridgets@rebatnaath.github.com'
    ]);
    possiblePaths.push(`${userExtDir}/assets/datas/cities.json`);
    possiblePaths.push(`${userExtDir}/assets/cities.json`);

    const systemExtDir = '/usr/share/gnome-shell/extensions/gridgets@rebatnaath.github.com';
    possiblePaths.push(`${systemExtDir}/assets/datas/cities.json`);
    possiblePaths.push(`${systemExtDir}/assets/cities.json`);

    for (const pathStr of possiblePaths) {
        if (GLib.file_test(pathStr, GLib.FileTest.EXISTS)) {
            try {
                const file = Gio.File.new_for_path(pathStr);
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const jsonText = new TextDecoder('utf-8').decode(contents);
                    cachedCitiesDatabase = JSON.parse(jsonText);
                    return cachedCitiesDatabase;
                }
            } catch (err) {
                console.error(`Gridgets: Failed loading cities from ${pathStr}: ${err.message}`);
            }
        }
    }

    return [];
}

export function createLiveCitySearchRow(grid, labelTitle, defaultCity, rowIdx, extensionPath) {
    const label = new Gtk.Label({ label: labelTitle, xalign: 0, valign: Gtk.Align.START, margin_top: 8 });
    
    const vBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3, hexpand: true, valign: Gtk.Align.START });

    const placeholderText = defaultCity && defaultCity.name
        ? `e.g. ${defaultCity.name} (${defaultCity.timezone || ''})`
        : 'Search city (e.g. London, Tokyo)...';

    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: placeholderText,
        hexpand: true
    });

    const statusLabel = new Gtk.Label({ xalign: 0 });

    const resultsListBox = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE
    });

    const scrolledWindow = new Gtk.ScrolledWindow({
        max_content_height: MAX_SCROLLED_WINDOW_HEIGHT_PX,
        min_content_height: 120,
        propagate_natural_height: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
    });
    scrolledWindow.set_child(resultsListBox);
    scrolledWindow.set_visible(false);

    let selectedCityObj = { ...defaultCity };
    let lastSelectedCityName = null;
    let isInternalUpdate = false;

    const updateStatusLabel = (isSelected = false) => {
        if (!selectedCityObj || !selectedCityObj.name) {
            statusLabel.set_text('');
            return;
        }
        if (isSelected) {
            statusLabel.set_markup(`<span size='x-small' weight='bold'>Selected: ${selectedCityObj.name} (${selectedCityObj.timezone || ''})</span>`);
        } else {
            statusLabel.set_markup(`<span size='x-small' alpha='60%'>Default: <b>${selectedCityObj.name}</b> (${selectedCityObj.timezone || ''})</span>`);
        }
    };
    updateStatusLabel(false);

    const selectCity = (cityItem) => {
        selectedCityObj = { name: cityItem.name, timezone: cityItem.timezone };
        lastSelectedCityName = cityItem.name;
        updateStatusLabel(true);
        isInternalUpdate = true;
        searchEntry.set_text(cityItem.name);
        isInternalUpdate = false;
        clearBox(resultsListBox);
        scrolledWindow.set_visible(false);
    };

    resultsListBox.connect('row-activated', (_box, row) => {
        if (row && row._cityItem) {
            selectCity(row._cityItem);
        }
    });

    const filterAndRenderCities = () => {
        if (isInternalUpdate) return;
        const rawQuery = searchEntry.get_text().trim();
        const query = rawQuery.toLowerCase();
        clearBox(resultsListBox);

        if (lastSelectedCityName) {
            if (rawQuery === lastSelectedCityName) {
                scrolledWindow.set_visible(false);
                return;
            } else {
                lastSelectedCityName = null;
            }
        }

        if (!query || query.length < MIN_QUERY_LENGTH) {
            scrolledWindow.set_visible(false);
            if (!query) {
                selectedCityObj = { ...defaultCity };
                updateStatusLabel(false);
            }
            return;
        }

        const cities = getCitiesDatabase(extensionPath);
        const rawMatches = [];
        const normalizedQuery = query.replace(/[\s_]+/g, '').toLowerCase();

        for (let i = 0; i < cities.length; i++) {
            const item = cities[i];
            if (item.name && item.name.toLowerCase().includes(query)) {
                rawMatches.push(item);
            }
        }

        rawMatches.sort((a, b) => {
            const aTzNorm = (a.timezone || '').replace(/[\s_]+/g, '').toLowerCase();
            const bTzNorm = (b.timezone || '').replace(/[\s_]+/g, '').toLowerCase();

            const aHasTzMatch = aTzNorm.includes(normalizedQuery);
            const bHasTzMatch = bTzNorm.includes(normalizedQuery);

            if (aHasTzMatch && !bHasTzMatch) return -1;
            if (!aHasTzMatch && bHasTzMatch) return 1;

            return 0;
        });

        const matches = rawMatches.slice(0, MAX_SEARCH_RESULTS_COUNT);

        if (matches.length > 0) {
            for (const item of matches) {
                const row = new Gtk.ListBoxRow({
                    selectable: false,
                    activatable: true
                });
                row._cityItem = item;

                const rowBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 12,
                    margin_top: 6,
                    margin_bottom: 6,
                    margin_start: 10,
                    margin_end: 10
                });

                const nameLabel = new Gtk.Label({
                    label: `${item.name} (${item.timezone})`,
                    xalign: 0,
                    hexpand: true
                });

                const tzLabel = new Gtk.Label({
                    xalign: 1
                });
                tzLabel.set_markup(`<span size='small' alpha='65%'>${item.timezone}</span>`);

                rowBox.append(nameLabel);
                rowBox.append(tzLabel);
                row.set_child(rowBox);

                const gesture = new Gtk.GestureClick();
                gesture.connect('pressed', () => {
                    selectCity(item);
                });
                row.add_controller(gesture);

                row.connect('activate', () => {
                    selectCity(item);
                });

                resultsListBox.append(row);
            }
            scrolledWindow.set_visible(true);
        } else {
            statusLabel.set_markup(`<span size='x-small' alpha='70%'>No matching city found for "<b>${searchEntry.get_text().trim()}</b>"</span>`);
            scrolledWindow.set_visible(false);
        }
    };

    searchEntry.connect('search-changed', () => filterAndRenderCities());
    searchEntry.connect('activate', () => filterAndRenderCities());

    vBox.append(searchEntry);
    vBox.append(statusLabel);
    vBox.append(scrolledWindow);

    grid.attach(label, 0, rowIdx, 1, 1);
    grid.attach(vBox, 1, rowIdx, 1, 1);

    return {
        getSelectedCity: () => selectedCityObj
    };
}

export function openAddWorldClockDialog(parentWindow, settings, extensionPath) {
    const { dialog, grid } = createBaseWidgetAddDialog(parentWindow, 'Configure World Clock Widget');

    const primaryPicker = createLiveCitySearchRow(grid, 'Primary City (Top):', { name: 'London', timezone: 'Europe/London' }, 0, extensionPath);
    const sec1Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Left):', { name: 'New York', timezone: 'America/New_York' }, 1, extensionPath);
    const sec2Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Right):', { name: 'Moscow', timezone: 'Europe/Moscow' }, 2, extensionPath);

    dialog.connect('response', (dialogWindow, responseId) => {
        if (responseId === Gtk.ResponseType.OK) {
            const primaryCity = primaryPicker.getSelectedCity();
            const sec1City = sec1Picker.getSelectedCity();
            const sec2City = sec2Picker.getSelectedCity();
            addTimeWidget(settings, 4, 4, 'world', [primaryCity, sec1City, sec2City]);
        }
        dialogWindow.destroy();
    });

    dialog.show();
}
