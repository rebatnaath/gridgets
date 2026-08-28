import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import Adw from 'gi://Adw';

import {
    addTimeWidget,
    addWeatherWidget,
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
    addTodoWidget,
    addMoodWidget,
} from './widgetAdders.js';

import {
    openAddAppLauncherDialog,
    openAddImageDialog,
    openAddSlideshowDialog,
    openAddWorldClockDialog,
    openAddGithubDialog,
    openAddRssHeadlinesDialog,
    openAddSunScheduleDialog,
} from './widgetAddDialogs.js';

import { STORE_CATEGORIES, STORE_WIDGETS } from './widgetCatalog.js';

const DESKTOP_PREVIEW_SIZE_PX = 120;
const DESKTOP_CARD_HEIGHT_PX = 240;
const CARDS_PER_ROW = 3;
const CLAMP_MAXIMUM_SIZE = 1400;
const CLAMP_TIGHTENING_THRESHOLD = 480;

function escapeMarkup(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPreviewArea(extensionPath, thumbnail, previewSize, fallbackIconName = null) {
    const previewArea = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        vexpand: true,
    });
    previewArea.set_size_request(previewSize, previewSize);

    if (thumbnail) {
        const picture = Gtk.Picture.new_for_filename(`${extensionPath}/assets/thumbnails/${thumbnail}`);
        picture.set_content_fit(Gtk.ContentFit.CONTAIN);
        picture.set_can_shrink(true);
        picture.set_halign(Gtk.Align.FILL);
        picture.set_valign(Gtk.Align.FILL);
        picture.set_hexpand(true);
        picture.set_vexpand(true);
        picture.set_margin_top(2);
        picture.set_margin_bottom(2);
        previewArea.append(picture);
    } else if (fallbackIconName) {
        const icon = new Gtk.Image({
            icon_name: fallbackIconName,
            pixel_size: 72,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        previewArea.append(icon);
    }

    return previewArea;
}

function buildTextLabels(title, description) {
    const safeTitle = escapeMarkup(title);
    const safeDesc = escapeMarkup(description);

    const titleLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    titleLabel.set_markup(`<b>${safeTitle}</b>`);

    const descLabel = new Gtk.Label({
        xalign: 0, hexpand: true, wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 24,
    });
    descLabel.set_markup(`<span size='small' alpha='65%'>${safeDesc}</span>`);

    return { titleLabel, descLabel };
}

function createDesktopWidgetCard(extensionPath, widgetEntry, onAddClick) {
    const { title, description, gridSize, thumbnail } = widgetEntry;

    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        css_classes: ['card'],
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6,
    });
    card.set_size_request(-1, DESKTOP_CARD_HEIGHT_PX);

    // Preview area
    card.append(buildPreviewArea(extensionPath, thumbnail, DESKTOP_PREVIEW_SIZE_PX));

    // Text block
    const textBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        margin_start: 12,
        margin_end: 12,
        margin_top: 2,
    });

    const { titleLabel, descLabel } = buildTextLabels(title, description);
    textBox.append(titleLabel);
    textBox.append(descLabel);

    // Grid size badge
    const sizeLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    sizeLabel.set_markup(`<span size='x-small' alpha='40%'>${gridSize}</span>`);
    textBox.append(sizeLabel);

    card.append(textBox);

    // Add button
    const addButton = new Gtk.Button({
        label: 'Add',
        css_classes: ['suggested-action', 'pill'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 10,
        valign: Gtk.Align.END,
        vexpand: true,
    });
    addButton.connect('clicked', onAddClick);
    card.append(addButton);

    return card;
}


function createCategoryGroup(title, cards) {
    const safeTitle = escapeMarkup(title);
    const group = new Adw.PreferencesGroup({ title: safeTitle });

    const flowBox = new Gtk.FlowBox({
        column_spacing: 10,
        row_spacing: 10,
        homogeneous: true,
        selection_mode: Gtk.SelectionMode.NONE,
        activate_on_single_click: false,
        max_children_per_line: CARDS_PER_ROW,
        min_children_per_line: CARDS_PER_ROW,
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.START,
        margin_top: 4,
        margin_bottom: 4,
        margin_start: 4,
        margin_end: 4,
    });

    cards.forEach(card => flowBox.append(card));

    const clamp = new Adw.Clamp({
        maximum_size: CLAMP_MAXIMUM_SIZE,
        tightening_threshold: CLAMP_TIGHTENING_THRESHOLD,
        child: flowBox,
    });

    group.add(clamp);
    return group;
}

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Gridgets Store',
        icon_name: 'software-update-available-symbolic',
    });

    const addWeather = (width, height, layout) => {
        addWeatherWidget(settings, settings.get_string('weather-city'), width, height, layout);
    };

    // ── Weather ──────────────────────────────────────────────
    page.add(createCategoryGroup('Weather', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[0]], () => addWeather(3, 3, 'standard')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[1]], () => addWeather(3, 3, 'simple')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[2]], () => addWeather(6, 4, 'forecast')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.sunScheduleWidget, () => openAddSunScheduleDialog(window, settings)),
    ]));

    // ── Media ────────────────────────────────────────────────
    page.add(createCategoryGroup('Media', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.music[0]], () => addMusicWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.music[1]], () => addMusicWidget(settings, 8, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.media[0]], () => openAddImageDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.media[1]], () => openAddSlideshowDialog(window, settings)),
    ]));

    // ── System Monitor ───────────────────────────────────────
    page.add(createCategoryGroup('System Monitor', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings, 4, 2)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings, 3, 2)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
    ]));

    // ── Focus & Productivity ─────────────────────────────────
    page.add(createCategoryGroup('Focus & Productivity', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.pomodoroTimer, () => addPomodoroWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.pomodoroFocus, () => addPomodoroFocusWidget(settings, 4, 2)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.todoWidget, () => addTodoWidget(settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.quickNotes, () => addNotesWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.clipboardHistory, () => addClipboardWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.appLauncher, () => openAddAppLauncherDialog(window, settings)),
    ]));

    // ── Time & Calendar ──────────────────────────────────────
    page.add(createCategoryGroup('Time & Calendar', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[0]], () => addTimeWidget(settings, 3, 2, 'digital')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[1]], () => openAddWorldClockDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[2]], () => addCalendarWidget(settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[3]], () => addCalendarGridWidget(settings)),
    ]));

    // ── Personal ─────────────────────────────────────────────
    page.add(createCategoryGroup('Personal', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.githubWidget, () => openAddGithubDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.rssHeadlinesWidget, () => openAddRssHeadlinesDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.quotesWidget, () => addQuotesWidget(settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS.moodWidget, () => addMoodWidget(settings)),
    ]));

    // Raise PreferencesPage's internal ~600px clamp so the grid grows with the window.
    const stack = [page];
    while (stack.length > 0) {
        const widget = stack.pop();
        if (widget instanceof Adw.Clamp) {
            widget.maximum_size = CLAMP_MAXIMUM_SIZE;
            widget.tightening_threshold = 900;
            continue;
        }
        let child = widget.get_first_child();
        while (child) {
            stack.push(child);
            child = child.get_next_sibling();
        }
    }

    return page;
}
