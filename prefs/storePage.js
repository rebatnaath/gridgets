/**
 * ============================================================================
 * PREFERENCES: STORE PAGE
 *
 * Displays two sections:
 *   1. Desktop Widgets  — cards that add a widget to the desktop grid.
 *   2. Panel Widgets    — cards with a toggle switch that enable/disable a
 *                         GNOME panel indicator.
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
    addSystemDashboardWidget,
    addNotesWidget,
    addClipboardWidget,
    addCalendarWidget,
    addQuotesWidget,
} from './widgetAdders.js';

import {
    openAddCommandDialog,
    openAddAppLauncherDialog,
    openAddImageDialog,
    openAddSlideshowDialog,
    openAddWorldClockDialog,
} from './widgetAddDialogs.js';

import { STORE_CATEGORIES, STORE_WIDGETS, PANEL_WIDGETS } from './widgetCatalog.js';

// ── Desktop widget card ───────────────────────────────────────────────────────

function createDesktopWidgetCard(extensionPath, widgetEntry, onAddClick) {
    const { title, description, gridSize, thumbnail } = widgetEntry;

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

    if (thumbnail) {
        const imagePath = `${extensionPath}/assets/thumbnails/${thumbnail}`;
        const picture = Gtk.Picture.new_for_filename(imagePath);
        picture.set_content_fit(Gtk.ContentFit.CONTAIN);
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

    const textBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_start: 12,
        margin_end: 12,
        margin_top: 4,
    });

    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeDesc = description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const titleLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    titleLabel.set_markup(`<b>${safeTitle}</b>`);

    const descLabel = new Gtk.Label({ xalign: 0, hexpand: true, wrap: true, max_width_chars: 24 });
    descLabel.set_markup(`<span size='small' alpha='70%'>${safeDesc}</span>`);

    const sizeLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    sizeLabel.set_markup(`<span size='x-small' weight='bold' alpha='50%'>GRID: ${gridSize}</span>`);

    textBox.append(titleLabel);
    textBox.append(descLabel);
    textBox.append(sizeLabel);

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
    card.append(textBox);
    card.append(addButton);

    return card;
}

// ── Panel widget card (toggle switch) ────────────────────────────────────────

function createPanelWidgetCard(extensionPath, panelEntry, settings) {
    const { title, description, settingKey, thumbnail, fallbackIconName } = panelEntry;

    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: ['card'],
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });
    card.set_size_request(210, 260);

    // Preview area (thumbnail image if available, otherwise fallback icon)
    const previewArea = new Gtk.Box({
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.FILL,
        hexpand: true,
    });
    previewArea.set_size_request(194, 130);

    if (thumbnail) {
        const imagePath = `${extensionPath}/assets/thumbnails/${thumbnail}`;
        const picture = Gtk.Picture.new_for_filename(imagePath);
        picture.set_content_fit(Gtk.ContentFit.CONTAIN);
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
    } else {
        const icon = new Gtk.Image({
            icon_name: fallbackIconName,
            pixel_size: 64,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            margin_top: 24,
        });
        previewArea.append(icon);
    }

    const textBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_start: 12,
        margin_end: 12,
        margin_top: 4,
    });

    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeDesc = description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const titleLabel = new Gtk.Label({ xalign: 0, hexpand: true });
    titleLabel.set_markup(`<b>${safeTitle}</b>`);

    const descLabel = new Gtk.Label({ xalign: 0, hexpand: true, wrap: true, max_width_chars: 24 });
    descLabel.set_markup(`<span size='small' alpha='70%'>${safeDesc}</span>`);

    const panelBadge = new Gtk.Label({ xalign: 0, hexpand: true });
    panelBadge.set_markup(`<span size='x-small' weight='bold' alpha='50%'>PANEL INDICATOR</span>`);

    textBox.append(titleLabel);
    textBox.append(descLabel);
    textBox.append(panelBadge);

    // Toggle row
    const toggleRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
        margin_top: 8,
        valign: Gtk.Align.END,
        vexpand: true,
    });

    const toggleLabel = new Gtk.Label({
        label: 'Enable',
        xalign: 0,
        hexpand: true,
        valign: Gtk.Align.CENTER,
    });

    const toggle = new Gtk.Switch({
        active: settings.get_boolean(settingKey),
        valign: Gtk.Align.CENTER,
    });
    toggle.connect('state-set', (_widget, state) => {
        settings.set_boolean(settingKey, state);
        return false;
    });

    toggleRow.append(toggleLabel);
    toggleRow.append(toggle);

    card.append(previewArea);
    card.append(textBox);
    card.append(toggleRow);

    return card;
}

// ── Category group helper ─────────────────────────────────────────────────────

function createCategoryGroup(title, cards) {
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const group = new Adw.PreferencesGroup({ title: safeTitle });

    const grid = new Gtk.Grid({
        column_spacing: 12,
        row_spacing: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    cards.forEach((card, index) => {
        grid.attach(card, index % 3, Math.floor(index / 3), 1, 1);
    });

    group.add(grid);
    return group;
}

// ── Section divider label ─────────────────────────────────────────────────────

function createSectionBanner(labelText) {
    const group = new Adw.PreferencesGroup();

    const banner = new Gtk.Label({
        label: labelText,
        xalign: 0,
        css_classes: ['title-3'],
        margin_top: 8,
        margin_bottom: 4,
        margin_start: 4,
    });

    group.add(banner);
    return group;
}

// ── Public builder ────────────────────────────────────────────────────────────

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Gridgets Store',
        icon_name: 'software-update-available-symbolic',
    });

    // ── Desktop Widgets banner ───────────────────────────────────────────────
    page.add(createSectionBanner('Desktop Widgets'));

    const addWeather = (width, height, layout) => {
        addWeatherWidget(settings, settings.get_string('weather-city'), width, height, layout);
    };

    page.add(createCategoryGroup('Weather', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[0]], () => addWeather(3, 3, 'standard')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[1]], () => addWeather(3, 3, 'simple')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.weather[2]], () => addWeather(6, 4, 'forecast')),
    ]));

    page.add(createCategoryGroup('Music & Audio', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.music[0]], () => addMusicWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.music[1]], () => addMusicWidget(settings, 8, 4)),
    ]));

    page.add(createCategoryGroup('Time & Clock', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[0]], () => addTimeWidget(settings, 3, 2, 'digital')),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[1]], () => openAddWorldClockDialog(window, settings, extensionPath)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.time[2]], () => addCalendarWidget(settings)),
    ]));

    page.add(createCategoryGroup('Media & Photos', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.media[0]], () => openAddImageDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.media[1]], () => openAddSlideshowDialog(window, settings)),
    ]));

    page.add(createCategoryGroup('System & Utilities', [
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[0]], () => addSystemDashboardWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[1]], () => addPomodoroWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[2]], () => addCpuRamWidget(settings, 4, 2)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[3]], () => addNetworkSpeedWidget(settings, 3, 2)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[4]], () => addNotesWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[5]], () => addClipboardWidget(settings, 4, 4)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[6]], () => openAddCommandDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[7]], () => openAddAppLauncherDialog(window, settings)),
        createDesktopWidgetCard(extensionPath, STORE_WIDGETS[STORE_CATEGORIES.utilities[8]], () => addQuotesWidget(settings)),
    ]));

    // ── Panel Widgets banner ─────────────────────────────────────────────────
    page.add(createSectionBanner('Panel Widgets'));

    page.add(createCategoryGroup('Indicators', [
        createPanelWidgetCard(extensionPath, PANEL_WIDGETS[STORE_CATEGORIES.panel[0]], settings),
        createPanelWidgetCard(extensionPath, PANEL_WIDGETS[STORE_CATEGORIES.panel[1]], settings),
    ]));

    return page;
}
