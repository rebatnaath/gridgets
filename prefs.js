/**
 * ============================================================================
 * PREFERENCES UI
 * 
 * This file contains the main ExtensionPreferences class implementation.
 * It builds the GNOME Extension settings window, defining pages for
 * "Appearance", "Gridgets Store", and "Global Settings", and connects
 * UI widgets to their corresponding GSettings keys.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {
    populateActiveWidgets,
    openWidgetEditDialog,
    addRandomWidget,
    addTimeWidget,
    addWeatherWidget,
    addMusicWidget,
    addPomodoroWidget,
    addSlideshowWidget,
    addCpuRamWidget,
    addNetworkSpeedWidget,
    addNotesWidget,
    addClipboardWidget,
    addCommandWidget,
    openAddCommandDialog,
    openAddImageDialog,
    openAddSlideshowDialog,
    performCitySearch
} from './prefsHelpers.js';



const COLUMNS_COUNT = 28;
const ROWS_COUNT = 16;
const WIDGET_WIDTH = 2;
const WIDGET_HEIGHT = 2;

function createStoreCard(extPath, title, description, gridSize, gradientClass, iconName, imgName, onAddClick) {
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

    // Preview area container
    const previewArea = new Gtk.Box({
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.FILL,
        hexpand: true,
    });
    previewArea.set_size_request(194, 194);

    if (imgName) {
        // Load thumbnail with contain fit without cropping
        const imagePath = `${extPath}/assets/thumbnails/${imgName}`;
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
    } else {
        // Load symbolic icon centered in the gradient background
        previewArea.add_css_class('preview-container');
        previewArea.add_css_class(gradientClass);

        const icon = new Gtk.Image({
            icon_name: iconName,
            pixel_size: 48,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            vexpand: true,
        });
        icon.add_css_class('accent');
        previewArea.append(icon);
    }

    // Text box for title and description
    const textVBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_start: 12,
        margin_end: 12,
        margin_top: 4,
    });

    const titleLabel = new Gtk.Label({
        xalign: 0,
        hexpand: true,
    });
    titleLabel.set_markup(`<b>${title}</b>`);

    const descLabel = new Gtk.Label({
        xalign: 0,
        hexpand: true,
        wrap: true,
        max_width_chars: 24,
    });
    descLabel.set_markup(`<span size='small' alpha='70%'>${description}</span>`);

    const sizeLabel = new Gtk.Label({
        xalign: 0,
        hexpand: true,
    });
    sizeLabel.set_markup(`<span size='x-small' weight='bold' alpha='50%'>GRID: ${gridSize}</span>`);

    textVBox.append(titleLabel);
    textVBox.append(descLabel);
    textVBox.append(sizeLabel);

    
    const addBtn = new Gtk.Button({
        label: 'Add to Desktop',
        css_classes: ['suggested-action', 'pill'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
        valign: Gtk.Align.END,
        vexpand: true,
    });
    addBtn.connect('clicked', onAddClick);

    card.append(previewArea);
    card.append(textVBox);
    card.append(addBtn);

    return card;
}

export default class GridgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(800, 600);
        window.set_search_enabled(true);
        const settings = this.getSettings('org.gnome.shell.extensions.gridgets');
        const extPath = this.path || this.dir.get_path();

        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        const aestheticsGroup = new Adw.PreferencesGroup({
            title: 'Aesthetics',
            description: 'Tweak the visual style of your widgets.',
        });

        const radiusRow = new Adw.ActionRow({
            title: 'Corner Rounding',
            subtitle: 'Adjust how rounded the widget corners are.',
        });

        const radiusScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 50, 1);
        radiusScale.set_size_request(200, -1);
        radiusScale.set_valign(Gtk.Align.CENTER);
        radiusScale.set_draw_value(true);
        settings.bind('border-radius', radiusScale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        
        radiusRow.add_suffix(radiusScale);
        aestheticsGroup.add(radiusRow);
        
        const borderWidthRow = new Adw.ActionRow({
            title: 'Border Width',
            subtitle: 'Global default border width for all widgets.',
        });
        const borderWidthScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 50, 1);
        borderWidthScale.set_size_request(200, -1);
        borderWidthScale.set_valign(Gtk.Align.CENTER);
        borderWidthScale.set_draw_value(true);
        settings.bind('global-border-width', borderWidthScale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        borderWidthRow.add_suffix(borderWidthScale);
        aestheticsGroup.add(borderWidthRow);

        const borderColorRow = new Adw.ActionRow({
            title: 'Border Color',
            subtitle: 'Global default border color.',
        });
        const borderColorBtn = new Gtk.ColorButton();
        borderColorBtn.set_valign(Gtk.Align.CENTER);
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string('global-border-color') || 'rgb(255,255,255)');
        borderColorBtn.set_rgba(rgba);
        borderColorBtn.connect('color-set', () => {
            settings.set_string('global-border-color', borderColorBtn.get_rgba().to_string());
        });
        borderColorRow.add_suffix(borderColorBtn);
        aestheticsGroup.add(borderColorRow);

        const globalBgColorRow = new Adw.ActionRow({
            title: 'Global Background Color',
            subtitle: 'Global default background color.',
        });
        const globalBgColorBtn = new Gtk.ColorButton();
        globalBgColorBtn.set_valign(Gtk.Align.CENTER);
        const bgRgba = new Gdk.RGBA();
        bgRgba.parse(settings.get_string('global-background-color') || '#1a1b26');
        globalBgColorBtn.set_rgba(bgRgba);
        globalBgColorBtn.connect('color-set', () => {
            settings.set_string('global-background-color', globalBgColorBtn.get_rgba().to_string());
        });
        globalBgColorRow.add_suffix(globalBgColorBtn);
        aestheticsGroup.add(globalBgColorRow);

        const globalFgColorRow = new Adw.ActionRow({
            title: 'Global Foreground/Text Color',
            subtitle: 'Global default text color.',
        });
        const globalFgColorBtn = new Gtk.ColorButton();
        globalFgColorBtn.set_valign(Gtk.Align.CENTER);
        const fgRgba = new Gdk.RGBA();
        fgRgba.parse(settings.get_string('global-foreground-color') || '#ffffff');
        globalFgColorBtn.set_rgba(fgRgba);
        globalFgColorBtn.connect('color-set', () => {
            settings.set_string('global-foreground-color', globalFgColorBtn.get_rgba().to_string());
        });
        globalFgColorRow.add_suffix(globalFgColorBtn);
        aestheticsGroup.add(globalFgColorRow);

        const fontRow = new Adw.ActionRow({
            title: 'Global Font Family',
            subtitle: 'Choose the font used for all widgets.',
        });
        const fontBtn = new Gtk.FontButton();
        fontBtn.set_valign(Gtk.Align.CENTER);
        
        const currentFont = settings.get_string('global-font-family');
        fontBtn.set_font(currentFont.replace(/'/g, '').replace(/, sans-serif/, '') + ' 11');
        fontBtn.connect('font-set', () => {
            const desc = Pango.FontDescription.from_string(fontBtn.get_font());
            const family = desc.get_family();
            settings.set_string('global-font-family', `'${family}', sans-serif`);
        });
        fontRow.add_suffix(fontBtn);
        aestheticsGroup.add(fontRow);
        
        appearancePage.add(aestheticsGroup);

        const devGroup = new Adw.PreferencesGroup({
            title: 'Developer',
        });
        const gridRow = new Adw.ActionRow({
            title: 'Visualize Grid',
            subtitle: 'Show the underlying cell placement grid.',
        });
        const gridSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('show-grid', gridSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        gridRow.add_suffix(gridSwitch);
        devGroup.add(gridRow);
        appearancePage.add(devGroup);

        window.add(appearancePage);

        // Register custom CSS for modern gradients and preview frames
        const provider = new Gtk.CssProvider();
        const cssData = `
            .preview-container {
                border-radius: 8px;
                margin: 8px;
                background-color: #1e1e2e;
            }
            .gradient-blue {
                background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            }
            .gradient-emerald {
                background: linear-gradient(135deg, #10b981, #047857);
            }
            .gradient-pink {
                background: linear-gradient(135deg, #ec4899, #be185d);
            }
            .gradient-red {
                background: linear-gradient(135deg, #ef4444, #b91c1c);
            }
            .gradient-purple {
                background: linear-gradient(135deg, #8b5cf6, #6d28d9);
            }
            .gradient-amber {
                background: linear-gradient(135deg, #f59e0b, #d97706);
            }
            .gradient-gray {
                background: linear-gradient(135deg, #6b7280, #4b5563);
            }
            .gradient-indigo {
                background: linear-gradient(135deg, #6366f1, #4338ca);
            }
        `;
        try {
            provider.load_from_data(cssData, -1);
        } catch (e) {
            try {
                provider.load_from_data(cssData);
            } catch (e2) {
                // Fallback for older versions that might expect GBytes/Uint8Array
                const bytes = new TextEncoder().encode(cssData);
                provider.load_from_data(bytes);
            }
        }
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        const storePage = new Adw.PreferencesPage({
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

        // Add 1. Image
        const addImageCard = createStoreCard(extPath, 'Image / GIF', 'Display an image or animated GIF directly on your desktop.', '2x2', 'gradient-purple', 'image-x-generic-symbolic', 'pictures/pictures.jpg', () => {
            openAddImageDialog(window, settings);
        });
        cards.push(addImageCard);

        // Add 2, 3, 4. Weather
        const addWeather = (w, h) => {
            const city = settings.get_string('weather-city');
            addWeatherWidget(settings, city, w, h);
        };
        cards.push(createStoreCard(extPath, 'Weather Forecast', 'A beautiful Cupertino-style weather forecast widget.', '3x3', 'gradient-blue', null, 'weathers/3x3.jpg', () => addWeather(3, 3)));
        cards.push(createStoreCard(extPath, 'Weather Minimal', 'A clean and simple weather condition and temperature display.', '4x2', 'gradient-blue', null, 'weathers/4x2.jpg', () => addWeather(4, 2)));
        cards.push(createStoreCard(extPath, 'Weather Detailed', 'Advanced forecast layout with hourly condition reports.', '6x4', 'gradient-blue', null, 'weathers/6x3.jpg', () => addWeather(6, 4)));

        // Add 5. Time
        cards.push(createStoreCard(extPath, 'Time & Date', 'A beautiful and simple time and date widget.', '3x2', 'gradient-emerald', 'preferences-system-time-symbolic', 'dateAndTime/dateAndTime.jpg', () => addTimeWidget(settings, 3, 2)));

        // Add 6. Music 4x4
        cards.push(createStoreCard(extPath, 'Music Player', 'Displays the currently playing media album art.', '4x4', 'gradient-pink', 'audio-x-generic-symbolic', 'musicPlayer/square.jpg', () => addMusicWidget(settings, 4, 4)));

        // Add 7. Music 8x4
        cards.push(createStoreCard(extPath, 'Music Player (Wide)', 'Wide layout displaying album art and player controls.', '8x4', 'gradient-pink', 'audio-x-generic-symbolic', 'musicPlayer/rectangle.jpg', () => addMusicWidget(settings, 8, 4)));

        // Add 8. Pomodoro
        cards.push(createStoreCard(extPath, 'Pomodoro Timer', 'A focus timer with work/break cycles and session tracking.', '4x4', 'gradient-red', 'alarm-symbolic', 'pomodoro/pomodoro.jpg', () => addPomodoroWidget(settings, 4, 4)));

        // Add 9. Slideshow
        const addSlideshowCard = createStoreCard(extPath, 'Image Slideshow', 'Cycle through images in a folder with crossfade transitions.', '4x4', 'gradient-purple', 'view-paged-symbolic', 'pictures/pictures.jpg', () => {
            openAddSlideshowDialog(window, settings);
        });
        cards.push(addSlideshowCard);

        // Add 10. CPU/RAM
        cards.push(createStoreCard(extPath, 'System Monitor', 'Monitor your CPU and RAM resource usage in real-time.', '4x2', 'gradient-amber', 'utilities-system-monitor-symbolic', 'cpuAndRam/cpuAndRam.jpg', () => addCpuRamWidget(settings, 4, 2)));

        // Add 11. Network
        cards.push(createStoreCard(extPath, 'Network Speed', 'A live tracker for upload and download speeds.', '3x2', 'gradient-amber', 'network-workgroup-symbolic', 'networkSpeed/networkSpeed.jpg', () => addNetworkSpeedWidget(settings, 3, 2)));

        // Add 12. Notes
        cards.push(createStoreCard(extPath, 'Quick Notes', 'A markdown sticky note to quickly write down notes.', '4x4', 'gradient-gray', 'text-editor-symbolic', 'quicknotes/quicknotes.jpg', () => addNotesWidget(settings, 4, 4)));

        // Add 13. Clipboard
        cards.push(createStoreCard(extPath, 'Clipboard History', 'Access a history of your recently copied text items.', '4x4', 'gradient-gray', 'edit-copy-symbolic', 'clipboard/clipboard.jpg', () => addClipboardWidget(settings, 4, 4)));

        // Add 14. Command Launcher
        cards.push(createStoreCard(extPath, 'Command Launcher', 'Run custom bash scripts and commands from your desktop.', '2x2', 'gradient-indigo', 'system-run-symbolic', 'commands/commands.jpg', () => openAddCommandDialog(window, settings)));

        cards.forEach((card, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            storeGrid.attach(card, col, row, 1, 1);
        });

        storeGroup.add(storeGrid);
        storePage.add(storeGroup);

        window.add(storePage);

        const settingsPage = new Adw.PreferencesPage({
            title: 'Global Settings',
            icon_name: 'preferences-system-symbolic',
        });

        const imageConfigGroup = new Adw.PreferencesGroup({
            title: 'Image Settings',
            description: 'Configuration for image and GIF widgets.',
        });

        const animateGifRow = new Adw.ActionRow({
            title: 'Animate GIFs',
            subtitle: 'Toggle GIF animations on or off.',
        });
        const animateGifSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('image-animate-gif', animateGifSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        animateGifRow.add_suffix(animateGifSwitch);
        imageConfigGroup.add(animateGifRow);

        const showImageCaptionRow = new Adw.ActionRow({
            title: 'Show Image Captions',
            subtitle: 'Toggle captions for image and GIF widgets.',
        });
        const showImageCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('image-show-caption', showImageCaptionSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        showImageCaptionRow.add_suffix(showImageCaptionSwitch);
        imageConfigGroup.add(showImageCaptionRow);

        const showSlideshowCaptionRow = new Adw.ActionRow({
            title: 'Show Slideshow Captions',
            subtitle: 'Toggle captions for slideshow widgets.',
        });
        const showSlideshowCaptionSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('slideshow-show-caption', showSlideshowCaptionSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        showSlideshowCaptionRow.add_suffix(showSlideshowCaptionSwitch);
        imageConfigGroup.add(showSlideshowCaptionRow);

        settingsPage.add(imageConfigGroup);

        const weatherConfigGroup = new Adw.PreferencesGroup({
            title: 'Weather Settings',
            description: 'Configure your default city and appearance.',
        });

        const fahrenheitRow = new Adw.ActionRow({
            title: 'Use Fahrenheit (°F)',
            subtitle: 'Display temperatures in Fahrenheit instead of Celsius by default.',
        });
        const fahrenheitSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('weather-use-fahrenheit', fahrenheitSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        fahrenheitRow.add_suffix(fahrenheitSwitch);
        weatherConfigGroup.add(fahrenheitRow);

        const dynamicColorRow = new Adw.ActionRow({
            title: 'Dynamic Weather Color',
            subtitle: 'Change weather widget background color depending on the weather and time of day.',
        });
        const dynamicColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('weather-dynamic-color', dynamicColorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        dynamicColorRow.add_suffix(dynamicColorSwitch);
        weatherConfigGroup.add(dynamicColorRow);

        const dynamicImgRow = new Adw.ActionRow({
            title: 'Dynamic Weather Overlay Image',
            subtitle: 'Show an overlay image depending on the weather condition.',
        });
        const dynamicImgSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('weather-dynamic-image', dynamicImgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        dynamicImgRow.add_suffix(dynamicImgSwitch);
        weatherConfigGroup.add(dynamicImgRow);

        const apiRow = new Adw.EntryRow({
            title: 'WeatherAPI.com API Key',
            text: settings.get_string('weather-api-key'),
            show_apply_button: true,
        });
        apiRow.connect('apply', () => {
            settings.set_string('weather-api-key', apiRow.get_text());
        });
        
        const apiHelpLabel = new Gtk.Label({
            label: '<span size="small" alpha="60%">Get a free API key from <a href="https://www.weatherapi.com">WeatherAPI.com</a></span>',
            use_markup: true,
            xalign: 0,
            margin_start: 20,
            margin_bottom: 16,
            margin_top: 4,
        });
        
        weatherConfigGroup.add(apiRow);
        weatherConfigGroup.add(apiHelpLabel);

        const searchRow = new Adw.ActionRow({
            title: 'Default City',
            subtitle: `Current: ${settings.get_string('weather-city')}`,
        });

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: 'Search city and press Enter...',
            width_request: 240,
            valign: Gtk.Align.CENTER,
        });
        searchRow.add_suffix(searchEntry);

        const resultsList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            css_classes: ['boxed-list']
        });
        resultsList.set_margin_top(10);
        resultsList.set_margin_bottom(10);
        resultsList.set_visible(false);

        weatherConfigGroup.add(searchRow);
        weatherConfigGroup.add(resultsList);

        searchEntry.connect('activate', () => {
            const query = searchEntry.get_text();
            performCitySearch(query, resultsList, null, (loc) => {
                settings.set_string('weather-city', loc);
                searchRow.set_subtitle(`Current: ${loc}`);
                searchEntry.set_text('');
                
                try {
                    let widgets = JSON.parse(settings.get_string('widgets'));
                    let modified = false;
                    for (let w of widgets) {
                        if (w.type === 'weather') {
                            w.location = loc;
                            modified = true;
                        }
                    }
                    if (modified) {
                        settings.set_string('widgets', JSON.stringify(widgets));
                    }
                } catch (e) {
                    console.error('Failed to update widgets with new location:', e);
                }

                let child = resultsList.get_first_child();
                while (child) {
                    let next = child.get_next_sibling();
                    resultsList.remove(child);
                    child = next;
                }
                resultsList.set_visible(false);
            }, settings);
        });

        settingsPage.add(weatherConfigGroup);
        
        const timeConfigGroup = new Adw.PreferencesGroup({
            title: 'Time Settings',
            description: 'Configuration for time widgets.',
        });
        const timeFormatRow = new Adw.ActionRow({
            title: '24-Hour Format',
            subtitle: 'Use 24-hour time format instead of 12-hour.',
        });
        const timeFormatSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind('time-format-24h', timeFormatSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        timeFormatRow.add_suffix(timeFormatSwitch);
        timeConfigGroup.add(timeFormatRow);
        
        settingsPage.add(timeConfigGroup);
        
        window.add(settingsPage);

        const activeGridsPage = new Adw.PreferencesPage({
            title: 'Individual Settings',
            icon_name: 'org.gnome.tweaks-symbolic',
        });

        const activeGroup = new Adw.PreferencesGroup({
            title: 'Manage Widgets',
            description: 'View and remove currently active widgets.',
        });
        activeGridsPage.add(activeGroup);
        window.add(activeGridsPage);

        populateActiveWidgets(window, settings, activeGroup, extPath);
        settings.connect('changed::widgets', () => populateActiveWidgets(window, settings, activeGroup, extPath));
    }
}
