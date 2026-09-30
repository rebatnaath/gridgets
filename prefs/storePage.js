import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {
    addTimeWidget,
    addMusicWidget,
    addPomodoroWidget,
    addPomodoroFocusWidget,
    addCpuRamWidget,
    addNetworkSpeedWidget,
    addSystemDashboardWidget,
    addNotesWidget,
    addClipboardWidget,
    addCalendarWidget,
    addQuotesWidget,
    addScreenTimeWidget,
    addCalendarGridWidget,
    addCalendarAgendaWidget,
    addTodoWidget,
    addMoodWidget,
} from './widgetAdders.js';

import {
    openAddAppLauncherDialog,
    openAddImageDialog,
    openAddSlideshowDialog,
    openAddWorldClockDialog,
    openAddWeatherDialog,
    openAddGithubDialog,
    openAddRssHeadlinesDialog,
    openAddSunTimesDialog,
    openAddTopStoriesDialog,
} from './widgetAddDialogs.js';

import { STORE_WIDGETS } from './widgetCatalog.js';
import { isGnomeWeatherAvailable } from './appAvailability.js';

const PREVIEW_SIZE_PX = 104;
const CARD_WIDTH_PX = 204;
const CARD_HEIGHT_PX = 244;
const MAX_CARDS_PER_ROW = 3;

function buildPreview(extensionPath, thumbnail, fallbackIconName) {
    const preview = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        vexpand: true,
    });
    preview.set_size_request(-1, PREVIEW_SIZE_PX);
    preview.set_margin_top(10);
    preview.set_margin_bottom(6);
    preview.set_margin_start(10);
    preview.set_margin_end(10);

    if (thumbnail) {
        const picture = Gtk.Picture.new_for_filename(`${extensionPath}/assets/thumbnails/${thumbnail}`);
        picture.set_content_fit(Gtk.ContentFit.CONTAIN);
        picture.set_can_shrink(true);
        picture.set_halign(Gtk.Align.CENTER);
        picture.set_valign(Gtk.Align.CENTER);
        preview.append(picture);
    } else if (fallbackIconName) {
        preview.append(new Gtk.Image({
            icon_name: fallbackIconName,
            pixel_size: 64,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        }));
    }

    return preview;
}

function buildStoreCard(extensionPath, widgetEntry, onAdd, buttonState = {}) {
    const { title, description, thumbnail, fallbackIconName } = widgetEntry;
    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
        width_request: CARD_WIDTH_PX,
        height_request: CARD_HEIGHT_PX,
        margin_start: 4,
        margin_end: 4,
        margin_top: 4,
        margin_bottom: 4,
        css_classes: ['card'],
    });

    card.append(buildPreview(extensionPath, thumbnail, fallbackIconName));

    const row = new Adw.ActionRow({
        title,
        // No footprint here: preset widgets spawn at the Large tier of their own S/M/L
        // table, so the catalog's gridSize only holds true for the two free-flow media
        // widgets that read it back. Printing it on 26 of 28 cards described a size the
        // widget never took.
        subtitle: description,
        use_markup: false,
        hexpand: true,
        margin_start: 10,
        margin_end: 10,
        margin_top: 6,
        margin_bottom: 6,
    });
    card.append(row);

    const addButton = new Gtk.Button({
        label: 'Add',
        hexpand: true,
        margin_start: 10,
        margin_end: 10,
        margin_top: 2,
        margin_bottom: 8,
        tooltip_text: `Add ${title}`,
    });
    addButton.set_sensitive(buttonState.sensitive ?? true);
    if (buttonState.tooltipText)
        addButton.set_tooltip_text(buttonState.tooltipText);
    addButton.connect('clicked', onAdd);
    card.append(addButton);

    return card;
}

function buildCategoryGroup(title, cards) {
    const group = new Adw.PreferencesGroup({
        title,
    });
    const grid = new Gtk.Grid({
        column_homogeneous: true,
        row_homogeneous: true,
        column_spacing: 10,
        row_spacing: 10,
        margin_top: 12,
        margin_bottom: 16,
        margin_start: 8,
        margin_end: 8,
        hexpand: true,
    });
    cards.forEach((card, index) => {
        grid.attach(
            card,
            index % MAX_CARDS_PER_ROW,
            Math.floor(index / MAX_CARDS_PER_ROW),
            1,
            1
        );
    });
    group.add(grid);
    return group;
}

function addStoreCategory(page, title, cards) {
    if (cards.length > 0)
        page.add(buildCategoryGroup(title, cards));
}

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Widget Store',
        icon_name: 'system-software-install-symbolic',
    });

    const weatherAvailable = isGnomeWeatherAvailable();

    const buildUnavailableState = (isAvailable, appName, action) => ({
        sensitive: isAvailable,
        tooltipText: isAvailable ? action : `${appName} is required. Install ${appName} first.`,
    });

    const weatherState = buildUnavailableState(weatherAvailable, 'GNOME Weather', 'Add a weather widget');

    if (!weatherAvailable) {
        const unavailableGroup = new Adw.PreferencesGroup();
        const unavailableRow = new Adw.ActionRow({
            title: 'GNOME Weather is not available',
            subtitle: 'Install GNOME Weather to enable weather widgets.',
        });
        unavailableRow.add_prefix(new Gtk.Image({
            icon_name: 'weather-clear-symbolic',
            pixel_size: 28,
        }));
        unavailableGroup.add(unavailableRow);
        page.add(unavailableGroup);
    }

    addStoreCategory(page, 'Weather', [
        buildStoreCard(extensionPath, STORE_WIDGETS.weatherStandard, () => openAddWeatherDialog(window, settings, 'standard'), weatherState),
        buildStoreCard(extensionPath, STORE_WIDGETS.weatherMinimal, () => openAddWeatherDialog(window, settings, 'simple'), weatherState),
        buildStoreCard(extensionPath, STORE_WIDGETS.weatherForecast, () => openAddWeatherDialog(window, settings, 'forecast'), weatherState),
        buildStoreCard(extensionPath, STORE_WIDGETS.sunTimesWidget, () => openAddSunTimesDialog(window, settings), weatherState),
    ]);

    addStoreCategory(page, 'Media', [
        buildStoreCard(extensionPath, STORE_WIDGETS.musicPlayer, () => addMusicWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.musicPlayerWide, () => addMusicWidget(settings, true)),
        buildStoreCard(extensionPath, STORE_WIDGETS.imageGif, () => openAddImageDialog(window, settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.imageSlideshow, () => openAddSlideshowDialog(window, settings)),
    ]);

    addStoreCategory(page, 'System', [
        buildStoreCard(extensionPath, STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
    ]);

    addStoreCategory(page, 'Focus and Productivity', [
        buildStoreCard(extensionPath, STORE_WIDGETS.pomodoroTimer, () => addPomodoroWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.pomodoroFocus, () => addPomodoroFocusWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.todoWidget, () => addTodoWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.quickNotes, () => addNotesWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.clipboardHistory, () => addClipboardWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.appLauncher, () => openAddAppLauncherDialog(window, settings)),
    ]);

    addStoreCategory(page, 'Time and Calendar', [
        buildStoreCard(extensionPath, STORE_WIDGETS.timeAndDate, () => addTimeWidget(settings, 'digital')),
        buildStoreCard(extensionPath, STORE_WIDGETS.worldClock, () => openAddWorldClockDialog(window, settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.calendarWidget, () => addCalendarWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.calendarGrid, () => addCalendarGridWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.calendarAgenda, () => addCalendarAgendaWidget(settings)),
    ]);

    addStoreCategory(page, 'Personal', [
        buildStoreCard(extensionPath, STORE_WIDGETS.githubWidget, () => openAddGithubDialog(window, settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.rssHeadlinesWidget, () => openAddRssHeadlinesDialog(window, settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.topStoriesWidget, () => openAddTopStoriesDialog(window, settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.quotesWidget, () => addQuotesWidget(settings)),
        buildStoreCard(extensionPath, STORE_WIDGETS.moodWidget, () => addMoodWidget(settings)),
    ]);

    return page;
}
