import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

import {
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
    openAddTimeDialog,
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
const SEARCH_DEBOUNCE_MS = 60;

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

/**
 * The store's contents as data rather than as built widgets, so a search renders from
 * the same description the full store does instead of a second copy of it.
 */
function buildStoreCategories(window, settings, weatherState) {
    const card = (entry, onAdd, buttonState) => ({ entry, onAdd, buttonState: buttonState ?? {} });

    return [
        {
            title: 'Weather',
            entries: [
                card(STORE_WIDGETS.weatherStandard, () => openAddWeatherDialog(window, settings, 'standard'), weatherState),
                card(STORE_WIDGETS.weatherMinimal, () => openAddWeatherDialog(window, settings, 'simple'), weatherState),
                card(STORE_WIDGETS.weatherForecast, () => openAddWeatherDialog(window, settings, 'forecast'), weatherState),
                card(STORE_WIDGETS.sunTimesWidget, () => openAddSunTimesDialog(window, settings), weatherState),
            ],
        },
        {
            title: 'Media',
            entries: [
                card(STORE_WIDGETS.musicPlayer, () => addMusicWidget(settings)),
                card(STORE_WIDGETS.musicPlayerWide, () => addMusicWidget(settings, true)),
                card(STORE_WIDGETS.imageGif, () => openAddImageDialog(window, settings)),
                card(STORE_WIDGETS.imageSlideshow, () => openAddSlideshowDialog(window, settings)),
            ],
        },
        {
            title: 'System',
            entries: [
                card(STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings)),
                card(STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings)),
                card(STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings)),
                card(STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
            ],
        },
        {
            title: 'Focus and Productivity',
            entries: [
                card(STORE_WIDGETS.pomodoroTimer, () => addPomodoroWidget(settings)),
                card(STORE_WIDGETS.pomodoroFocus, () => addPomodoroFocusWidget(settings)),
                card(STORE_WIDGETS.todoWidget, () => addTodoWidget(settings)),
                card(STORE_WIDGETS.quickNotes, () => addNotesWidget(settings)),
                card(STORE_WIDGETS.clipboardHistory, () => addClipboardWidget(settings)),
                card(STORE_WIDGETS.appLauncher, () => openAddAppLauncherDialog(window, settings)),
            ],
        },
        {
            title: 'Time and Calendar',
            entries: [
                card(STORE_WIDGETS.timeAndDate, () => openAddTimeDialog(window, settings)),
                card(STORE_WIDGETS.worldClock, () => openAddWorldClockDialog(window, settings)),
                card(STORE_WIDGETS.calendarWidget, () => addCalendarWidget(settings)),
                card(STORE_WIDGETS.calendarGrid, () => addCalendarGridWidget(settings)),
                card(STORE_WIDGETS.calendarAgenda, () => addCalendarAgendaWidget(settings)),
            ],
        },
        {
            title: 'Personal',
            entries: [
                card(STORE_WIDGETS.githubWidget, () => openAddGithubDialog(window, settings)),
                card(STORE_WIDGETS.rssHeadlinesWidget, () => openAddRssHeadlinesDialog(window, settings)),
                card(STORE_WIDGETS.topStoriesWidget, () => openAddTopStoriesDialog(window, settings)),
                card(STORE_WIDGETS.quotesWidget, () => addQuotesWidget(settings)),
                card(STORE_WIDGETS.moodWidget, () => addMoodWidget(settings)),
            ],
        },
    ];
}

// The category name is searchable, so "weather" finds the weather widgets even though
// no individual card names the category.
function storeEntryMatches(entry, categoryTitle, query) {
    if (query === '')
        return true;
    const haystacks = [entry.title, entry.description, categoryTitle]
        .filter(Boolean)
        .map(value => value.toLowerCase());
    return haystacks.some(value => value.includes(query));
}

function buildNoResultsGroup(query) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({
        title: 'No widgets found',
        subtitle: `Nothing in the store matches “${query}”.`,
    });
    row.add_prefix(new Gtk.Image({
        icon_name: 'system-search-symbolic',
        pixel_size: 28,
    }));
    group.add(row);
    return group;
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
    const categories = buildStoreCategories(window, settings, weatherState);

    // The search field and the weather notice are not results, so they sit outside the
    // rendered set and survive every re-render.
    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search widgets...',
        hexpand: true,
    });

    const searchGroup = new Adw.PreferencesGroup();
    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 12,
        margin_bottom: 4,
        margin_start: 8,
        margin_end: 8,
    });
    searchBox.append(searchEntry);
    searchGroup.add(searchBox);
    page.add(searchGroup);

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

    const resultGroups = [];
    // Building a card decodes its thumbnail from disk, so the cards are built once and
    // only re-parented afterwards. Keyed on the catalog entry, one object per card.
    const cardCache = new Map();
    const attachedCards = [];

    const getCard = ({ entry, onAdd, buttonState }) => {
        let card = cardCache.get(entry);
        if (!card) {
            card = buildStoreCard(extensionPath, entry, onAdd, buttonState);
            cardCache.set(entry, card);
        } else if (card.get_parent()) {
            // GTK refuses to attach a child that still has a parent, and a reused card can
            // still be inside the grid of the render being torn down.
            card.unparent();
        }
        return card;
    };

    const clearResults = () => {
        // Cards must leave their grids before the groups go, or finalizing a group would
        // take the cached cards still parented to it.
        for (const card of attachedCards)
            card.unparent();
        attachedCards.length = 0;

        for (const group of resultGroups) {
            // remove() only detaches, so without unparent() each discarded result set
            // would stay alive for as long as the window is open.
            page.remove(group);
            group.unparent();
        }
        resultGroups.length = 0;
    };

    const renderResults = () => {
        clearResults();

        const query = searchEntry.get_text().trim().toLowerCase();
        let matchCount = 0;

        for (const category of categories) {
            const entries = category.entries.filter(({ entry }) => storeEntryMatches(entry, category.title, query));
            if (entries.length === 0)
                continue;
            matchCount += entries.length;
            const cards = entries.map(getCard);
            attachedCards.push(...cards);
            const group = buildCategoryGroup(category.title, cards);
            page.add(group);
            resultGroups.push(group);
        }

        if (matchCount === 0) {
            const group = buildNoResultsGroup(searchEntry.get_text().trim());
            page.add(group);
            resultGroups.push(group);
        }
    };

    let searchDebounceId = 0;
    searchEntry.connect('search-changed', () => {
        if (searchDebounceId)
            GLib.Source.remove(searchDebounceId);
        searchDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            searchDebounceId = 0;
            renderResults();
            return GLib.SOURCE_REMOVE;
        });
    });

    renderResults();

    return page;
}
