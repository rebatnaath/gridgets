/**
 * ============================================================================
 * PREFERENCES: STORE PAGE
 * 
 * Defines the "Gridgets Store" page, displaying grid cards for adding new
 * desktop widgets.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {
    addTimeWidget,
    addWeatherWidget,
    addMusicWidget,
    addPomodoroWidget,
    addCpuRamWidget,
    addNetworkSpeedWidget,
    addNotesWidget,
    addClipboardWidget,
} from './widgetAdders.js';

import {
    openAddCommandDialog,
    openAddImageDialog,
    openAddSlideshowDialog
} from './widgetAddDialogs.js';

function createStoreCard(extensionPath, title, description, gridSize, imageName, onAddClick) {
    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: ['card'],
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });
    card.set_size_request(210, 400);

    const previewArea = new Gtk.Box({
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.FILL,
        hexpand: true,
    });
    previewArea.set_size_request(194, 194);

    if (imageName) {
        const imagePath = `${extensionPath}/assets/thumbnails/${imageName}`;
        const picture = Gtk.Picture.new_for_filename(imagePath);
        if (Gtk.ContentFit) {
            picture.set_content_fit(Gtk.ContentFit.CONTAIN);
        } else {
            picture.set_keep_aspect_ratio(true);
        }
        picture.set_can_shrink(true);
        picture.set_halign(Gtk.Align.FILL);
        picture.set_valign(Gtk.Align.FILL);
        picture.set_hexpand(true);
        picture.set_vexpand(true);
        picture.set_margin_top(4);
        picture.set_margin_bottom(4);
        picture.set_margin_start(4);
        picture.set_margin_end(4);
        previewArea.append(picture);
    }

    const textVBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_start: 12,
        margin_end: 12,
        margin_top: 4,
    });

    const titleLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    titleLabel.set_markup(`<b>${title}</b>`);

    const descLabel = new Gtk.Label({ xalign: 0, hexpand: true, wrap: true, max_width_chars: 24 });
    descLabel.set_markup(`<span size='small' alpha='70%'>${description}</span>`);

    const sizeLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    sizeLabel.set_markup(`<span size='x-small' weight='bold' alpha='50%'>GRID: ${gridSize}</span>`);

    textVBox.append(titleLabel);
    textVBox.append(descLabel);
    textVBox.append(sizeLabel);

    const addButton = new Gtk.Button({
        label: 'Add to Desktop',
        css_classes: ['suggested-action', 'pill'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
        valign: Gtk.Align.END,
        vexpand: true,
    });
    addButton.connect('clicked', onAddClick);

    card.append(previewArea);
    card.append(textVBox);
    card.append(addButton);

    return card;
}

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Gridgets Store',
        icon_name: 'software-update-available-symbolic',
    });

    const storeGroup = new Adw.PreferencesGroup({
        title: 'Widget Store',
        description: 'Browse and add custom widgets directly onto your desktop grid.',
    });

    const storeGrid = new Gtk.Grid({
        column_spacing: 12,
        row_spacing: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    const cards = [];

    cards.push(createStoreCard(extensionPath, 'Image / GIF', 'Display an image or animated GIF directly on your desktop.', '2x2', 'pictures/pictures.jpg', () => {
        openAddImageDialog(window, settings);
    }));

    const addWeather = (width, height, layout) => {
        const city = settings.get_string('weather-city');
        addWeatherWidget(settings, city, width, height, layout);
    };
    cards.push(createStoreCard(extensionPath, 'Weather Forecast', 'A beautiful Cupertino-style weather forecast widget.', '3x3', 'weathers/3x3.jpg', () => addWeather(3, 3, 'standard')));
    cards.push(createStoreCard(extensionPath, 'Weather Minimal', 'A clean and simple weather condition and temperature display.', '4x2', 'weathers/4x2.jpg', () => addWeather(4, 2, 'simple')));
    cards.push(createStoreCard(extensionPath, 'Weather Detailed', 'Advanced forecast layout with hourly condition reports.', '6x4', 'weathers/6x3.jpg', () => addWeather(6, 4, 'forecast')));

    cards.push(createStoreCard(extensionPath, 'Time & Date', 'A beautiful and simple time and date widget.', '3x2', 'dateAndTime/dateAndTime.jpg', () => addTimeWidget(settings, 3, 2)));
    cards.push(createStoreCard(extensionPath, 'Music Player', 'Displays the currently playing media album art.', '4x4', 'musicPlayer/square.jpg', () => addMusicWidget(settings, 4, 4)));
    cards.push(createStoreCard(extensionPath, 'Music Player (Wide)', 'Wide layout displaying album art and player controls.', '8x4', 'musicPlayer/rectangle.jpg', () => addMusicWidget(settings, 8, 4)));
    cards.push(createStoreCard(extensionPath, 'Pomodoro Timer', 'A focus timer with work/break cycles and session tracking.', '4x4', 'pomodoro/pomodoro.jpg', () => addPomodoroWidget(settings, 4, 4)));
    cards.push(createStoreCard(extensionPath, 'Image Slideshow', 'Cycle through images in a folder with crossfade transitions.', '4x4', 'pictures/pictures.jpg', () => {
        openAddSlideshowDialog(window, settings);
    }));
    cards.push(createStoreCard(extensionPath, 'System Monitor', 'Monitor your CPU and RAM resource usage in real-time.', '4x2', 'cpuAndRam/cpuAndRam.jpg', () => addCpuRamWidget(settings, 4, 2)));
    cards.push(createStoreCard(extensionPath, 'Network Speed', 'A live tracker for upload and download speeds.', '3x2', 'networkSpeed/networkSpeed.jpg', () => addNetworkSpeedWidget(settings, 3, 2)));
    cards.push(createStoreCard(extensionPath, 'Quick Notes', 'A markdown sticky note to quickly write down notes.', '4x4', 'quicknotes/quicknotes.jpg', () => addNotesWidget(settings, 4, 4)));
    cards.push(createStoreCard(extensionPath, 'Clipboard History', 'Access a history of your recently copied text items.', '4x4', 'clipboard/clipboard.jpg', () => addClipboardWidget(settings, 4, 4)));
    cards.push(createStoreCard(extensionPath, 'Command Launcher', 'Run custom bash scripts and commands from your desktop.', '2x2', 'commands/commands.jpg', () => openAddCommandDialog(window, settings)));

    cards.forEach((card, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        storeGrid.attach(card, col, row, 1, 1);
    });

    storeGroup.add(storeGrid);
    page.add(storeGroup);
    return page;
}
