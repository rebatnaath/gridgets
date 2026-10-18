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
    addGithubWidget,
    addGithubWeekWidget,
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
import { addPageStylesheet } from './displayUtils.js';

const PREVIEW_SIZE_PX = 104;
const CARD_HEIGHT_PX = 244;
const MAX_CARDS_PER_ROW = 3;
const SEARCH_DEBOUNCE_MS = 60;

// app pill sets a large padding for a full-width action button. The filter chips are a
// row of small toggles, so they get their own tighter padding.
const STORE_CHIP_PADDING = '4px 12px';
const STORE_CHIP_MIN_HEIGHT_PX = 24;
const STORE_CSS = `
    button.store-filter-chip { padding: ${STORE_CHIP_PADDING}; min-height: ${STORE_CHIP_MIN_HEIGHT_PX}px; }
`;

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
    // The card has no fixed width: the grid shares the preferences clamp width with every
    // other page, so the store cannot force the window (and the view toggle above it) wider
    // than Appearance or On Desktop do.
    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
        hexpand: true,
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
            chipLabel: 'Weather',
            entries: [
                card(STORE_WIDGETS.weatherStandard, () => openAddWeatherDialog(window, settings, 'standard'), weatherState),
                card(STORE_WIDGETS.weatherMinimal, () => openAddWeatherDialog(window, settings, 'simple'), weatherState),
                card(STORE_WIDGETS.weatherForecast, () => openAddWeatherDialog(window, settings, 'forecast'), weatherState),
                card(STORE_WIDGETS.sunTimesWidget, () => openAddSunTimesDialog(window, settings), weatherState),
            ],
        },
        {
            title: 'Media',
            chipLabel: 'Media',
            entries: [
                card(STORE_WIDGETS.musicPlayer, () => addMusicWidget(settings)),
                card(STORE_WIDGETS.musicPlayerWide, () => addMusicWidget(settings, true)),
                card(STORE_WIDGETS.imageGif, () => openAddImageDialog(window, settings)),
                card(STORE_WIDGETS.imageSlideshow, () => openAddSlideshowDialog(window, settings)),
            ],
        },
        {
            title: 'System',
            chipLabel: 'System',
            entries: [
                card(STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings)),
                card(STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings)),
                card(STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings)),
                card(STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
            ],
        },
        {
            title: 'Focus and Productivity',
            chipLabel: 'Productivity',
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
            chipLabel: 'Time',
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
            chipLabel: 'Personal',
            entries: [
                card(STORE_WIDGETS.githubWidget,
                    () => openAddGithubDialog(window, settings, addGithubWidget)),
                card(STORE_WIDGETS.githubWeekWidget,
                    () => openAddGithubDialog(window, settings, addGithubWeekWidget,
                        'Configure GitHub Week Widget')),
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

export function buildStoreView(window, settings, extensionPath, host) {
    addPageStylesheet(host.page, STORE_CSS);

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

    // The chips are a coarse filter over the same categories search matches against:
    // selecting one narrows the results to that category, All clears it, and the two
    // compose so a chip plus a query searches inside the chosen category.
    let activeCategory = null;
    let suppressFilterRender = true;
    const filterChips = [];
    // A WrapBox flows the chips onto another line when they no longer fit, rather than
    // hiding them behind a horizontal scroll.
    const filterRow = new Adw.WrapBox({
        child_spacing: 6,
        line_spacing: 6,
    });

    const selectFilterChip = chip => {
        for (const other of filterChips)
            other.set_active(other === chip);
    };

    const addFilterChip = (label, categoryTitle) => {
        const chip = new Gtk.ToggleButton({
            label,
            css_classes: ['pill', 'store-filter-chip'],
            valign: Gtk.Align.CENTER,
        });
        chip.connect('toggled', () => {
            if (chip.get_active()) {
                selectFilterChip(chip);
                activeCategory = categoryTitle;
                if (!suppressFilterRender)
                    renderResults();
            } else if (!filterChips.some(other => other.get_active())) {
                // One chip always stays on, so clicking the active chip cannot leave the
                // store unfiltered with nothing showing which filter is applied.
                chip.set_active(true);
            }
        });
        filterChips.push(chip);
        filterRow.append(chip);
    };

    addFilterChip('All', null);
    for (const category of categories)
        addFilterChip(category.chipLabel, category.title);
    filterChips[0].set_active(true);

    const searchGroup = new Adw.PreferencesGroup();
    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 12,
        margin_bottom: 4,
        margin_start: 8,
        margin_end: 8,
    });
    searchBox.append(searchEntry);
    searchBox.append(filterRow);
    searchGroup.add(searchBox);
    host.addGroup('library', searchGroup);

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
        host.addGroup('library', unavailableGroup);
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
            host.removeGroup(group);
            group.unparent();
        }
        resultGroups.length = 0;
    };

    const renderResults = () => {
        clearResults();

        const query = searchEntry.get_text().trim().toLowerCase();
        let matchCount = 0;

        for (const category of categories) {
            if (activeCategory && category.title !== activeCategory)
                continue;
            const entries = category.entries.filter(({ entry }) => storeEntryMatches(entry, category.title, query));
            if (entries.length === 0)
                continue;
            matchCount += entries.length;
            const cards = entries.map(getCard);
            attachedCards.push(...cards);
            const group = buildCategoryGroup(category.title, cards);
            host.addGroup('library', group);
            resultGroups.push(group);
        }

        if (matchCount === 0) {
            const group = buildNoResultsGroup(searchEntry.get_text().trim());
            host.addGroup('library', group);
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

    // The chips are wired now, so later toggles should re-render. The initial render
    // happens below instead, once, rather than once per chip as they are activated.
    suppressFilterRender = false;
    renderResults();
}
