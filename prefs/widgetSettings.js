import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import { isWideMusicLayout, DEFAULT_FONT_FAMILY, DEFAULT_BG_COLOR, DEFAULT_FG_COLOR } from '../utils/widgetUtils.js';
import { openImageFileDialog } from './fileDialogs.js';
import { createNormalizedFontDescription } from './aestheticControls.js';
import { DEFAULT_RSS_REFRESH_MINUTES } from './widgetAdders.js';
import { createLiveCitySearchRow, buildOpenMeteoCitySearchRow } from './citySearch.js';
import { createAppSelectionControls } from './appSelection.js';
import { buildCaptionControls } from './captionControls.js';
import { getConnectedMonitorsCount, buildMonitorEntries } from './displayUtils.js';

const MIN_POMODORO_MINUTES = 1;
const MAX_POMODORO_MINUTES = 120;
const POMODORO_MINUTE_STEP = 1;
const MIN_SESSIONS_BEFORE_LONG_BREAK = 1;
const MAX_SESSIONS_BEFORE_LONG_BREAK = 10;
const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 15;
const DEFAULT_SESSIONS_BEFORE_LONG_BREAK = 4;
const RSS_MIN_REFRESH_MINUTES = 5;
const RSS_MAX_REFRESH_MINUTES = 720;
const RSS_REFRESH_STEP_MINUTES = 5;

const DEFAULT_WORLD_CLOCK_CITIES = [
    { name: 'London', timezone: 'Europe/London', country: 'GB' },
    { name: 'New York', timezone: 'America/New_York', country: 'US' },
    { name: 'Moscow', timezone: 'Europe/Moscow', country: 'RU' },
];

const MIN_SLIDESHOW_INTERVAL_SEC = 5;
const MAX_SLIDESHOW_INTERVAL_SEC = 3600;
const STEP_SLIDESHOW_INTERVAL_SEC = 5;
const DEFAULT_SLIDESHOW_INTERVAL_SEC = 10;

export function buildStandardSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const isImageOrSlideshow = widget.type === 'slideshow' || widget.type === 'image' || widget.imagePath;

    let bgColorBtn, fgColorBtn, fontBtn, colorSwitch;
    let initialFontDescription = '';

    if (!isImageOrSlideshow) {
        const colorSwitchLabel = new Gtk.Label({ label: 'Custom Colors & Font:', xalign: 0, hexpand: true });
        colorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        colorSwitch.set_active(widget.overrideColors === true);
        grid.attach(colorSwitchLabel, 0, rowIdx, 1, 1);
        grid.attach(colorSwitch, 1, rowIdx, 1, 1);
        rowIdx++;

        const bgColorLabel = new Gtk.Label({ label: 'Background Color:', xalign: 0, hexpand: true });
        bgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const bgRgba = new Gdk.RGBA();
        bgRgba.parse(widget.bgColor || settings.get_string('global-background-color') || DEFAULT_BG_COLOR);
        bgColorBtn.set_rgba(bgRgba);
        grid.attach(bgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(bgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        const fgColorLabel = new Gtk.Label({ label: 'Text/Icon Color:', xalign: 0, hexpand: true });
        fgColorBtn = new Gtk.ColorButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const fgRgba = new Gdk.RGBA();
        fgRgba.parse(widget.fgColor || settings.get_string('global-foreground-color') || DEFAULT_FG_COLOR);
        fgColorBtn.set_rgba(fgRgba);
        grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
        grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        const fontLabel = new Gtk.Label({ label: 'Font Family:', xalign: 0, hexpand: true });
        fontBtn = new Gtk.FontButton({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        const currentFont = widget.fontFamily || settings.get_string('global-font-family');
        initialFontDescription = createNormalizedFontDescription(currentFont).to_string();
        fontBtn.set_font(initialFontDescription);
        grid.attach(fontLabel, 0, rowIdx, 1, 1);
        grid.attach(fontBtn, 1, rowIdx, 1, 1);
        rowIdx++;

        bgColorBtn.set_sensitive(colorSwitch.get_active());
        fgColorBtn.set_sensitive(colorSwitch.get_active());
        fontBtn.set_sensitive(colorSwitch.get_active());

        colorSwitch.connect('notify::active', () => {
            const active = colorSwitch.get_active();
            bgColorBtn.set_sensitive(active);
            fgColorBtn.set_sensitive(active);
            fontBtn.set_sensitive(active);
        });
    }

    const monitorCount = getConnectedMonitorsCount();
    let monitorCombo = null;
    let monitorKeys = [];

    if (monitorCount > 1) {
        const monitorLabel = new Gtk.Label({ label: 'Target Monitor:', xalign: 0, hexpand: true });
        const monitorStrings = ['Default (Follow Global)', 'Primary Monitor'];
        monitorKeys = ['global', 'primary'];
        for (const entry of buildMonitorEntries(monitorCount)) {
            monitorStrings.push(entry.label);
            monitorKeys.push(entry.key);
        }

        monitorCombo = new Gtk.DropDown({
            model: Gtk.StringList.new(monitorStrings),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END
        });
        const currentWidgetMonitor = widget.monitor || 'global';
        const monitorIdx = monitorKeys.indexOf(currentWidgetMonitor);
        monitorCombo.set_selected(monitorIdx >= 0 ? monitorIdx : 0);
        grid.attach(monitorLabel, 0, rowIdx, 1, 1);
        grid.attach(monitorCombo, 1, rowIdx, 1, 1);
        rowIdx++;
    }

    saveHandlers.push((target) => {
        if (monitorCombo && monitorKeys.length > 0) {
            const selectedMonitorKey = monitorKeys[monitorCombo.get_selected()];
            if (selectedMonitorKey !== 'global') {
                target.monitor = selectedMonitorKey;
            } else {
                delete target.monitor;
            }
        }

        if (!isImageOrSlideshow && colorSwitch) {
            target.overrideColors = colorSwitch.get_active();
            target.bgColor = bgColorBtn.get_rgba().to_string();
            target.fgColor = fgColorBtn.get_rgba().to_string();

            if (fontBtn.get_font() !== initialFontDescription) {
                const desc = Pango.FontDescription.from_string(fontBtn.get_font());
                const family = desc.get_family();
                if (family) {
                    target.fontFamily = `'${family}', sans-serif`;
                }
            }
        }
    });

    return rowIdx;
}

export function buildRssSettings(grid, rowIdx, widget, saveHandlers) {
    const urlLabel = new Gtk.Label({ label: 'Feed URL:', xalign: 0, hexpand: true });
    const urlEntry = new Gtk.Entry({
        text: widget.feedUrl || '',
        placeholder_text: 'https://example.com/feed.xml',
        hexpand: true,
        input_purpose: Gtk.InputPurpose.URL,
    });
    grid.attach(urlLabel, 0, rowIdx, 1, 1);
    grid.attach(urlEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const refreshLabel = new Gtk.Label({ label: 'Refresh Interval (Minutes):', xalign: 0, hexpand: true });
    const refreshSpin = Gtk.SpinButton.new_with_range(RSS_MIN_REFRESH_MINUTES, RSS_MAX_REFRESH_MINUTES, RSS_REFRESH_STEP_MINUTES);
    refreshSpin.set_valign(Gtk.Align.CENTER);
    refreshSpin.set_halign(Gtk.Align.END);
    refreshSpin.set_value(widget.refreshMinutes || DEFAULT_RSS_REFRESH_MINUTES);
    grid.attach(refreshLabel, 0, rowIdx, 1, 1);
    grid.attach(refreshSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        const trimmedUrl = urlEntry.get_text().trim();
        if (trimmedUrl) {
            target.feedUrl = trimmedUrl;
        }
        target.refreshMinutes = Math.round(refreshSpin.get_value());
    });

    return rowIdx;
}

export function buildSunScheduleSettings(grid, rowIdx, widget, saveHandlers) {
    const currentLocation = { name: widget.city || '' };
    if (widget.latitude !== undefined && widget.longitude !== undefined) {
        currentLocation.latitude = widget.latitude;
        currentLocation.longitude = widget.longitude;
    }
    const locationPicker = buildOpenMeteoCitySearchRow(grid, 'City Location:', currentLocation, rowIdx++);

    saveHandlers.push((target) => {
        const selectedLocation = locationPicker.getSelectedLocation();
        if (selectedLocation && selectedLocation.name && selectedLocation.latitude !== undefined && selectedLocation.longitude !== undefined) {
            target.city = selectedLocation.name;
            target.latitude = selectedLocation.latitude;
            target.longitude = selectedLocation.longitude;
        }
    });

    return rowIdx;
}

export function buildWeatherSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const currentLocation = { name: widget.location || 'London' };
    if (widget.lat !== undefined && widget.lon !== undefined) {
        currentLocation.latitude = widget.lat;
        currentLocation.longitude = widget.lon;
    }
    const cityPicker = buildOpenMeteoCitySearchRow(grid, 'City Location:', currentLocation, rowIdx++);

    const dynamicColorLabel = new Gtk.Label({ label: 'Dynamic Weather Color:', xalign: 0, hexpand: true });
    const dynamicColorSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const isDynamicColorActive = widget.dynamicColor !== undefined
        ? widget.dynamicColor
        : settings.get_boolean('weather-dynamic-color');
    dynamicColorSwitch.set_active(isDynamicColorActive);
    grid.attach(dynamicColorLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicColorSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const dynamicOverlayLabel = new Gtk.Label({ label: 'Dynamic Weather Overlay:', xalign: 0, hexpand: true });
    const dynamicOverlaySwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const isDynamicOverlayActive = widget.dynamicImage !== undefined
        ? widget.dynamicImage
        : settings.get_boolean('weather-dynamic-image');
    dynamicOverlaySwitch.set_active(isDynamicOverlayActive);
    grid.attach(dynamicOverlayLabel, 0, rowIdx, 1, 1);
    grid.attach(dynamicOverlaySwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const fahrenheitLabel = new Gtk.Label({ label: 'Use Fahrenheit:', xalign: 0, hexpand: true });
    const fahrenheitSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    fahrenheitSwitch.set_active(widget.useFahrenheit !== undefined ? widget.useFahrenheit : settings.get_boolean('weather-use-fahrenheit'));
    grid.attach(fahrenheitLabel, 0, rowIdx, 1, 1);
    grid.attach(fahrenheitSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        const selectedCity = cityPicker.getSelectedLocation();
        if (selectedCity && selectedCity.name) {
            target.location = selectedCity.name;
            if (selectedCity.latitude !== undefined && selectedCity.longitude !== undefined) {
                target.lat = selectedCity.latitude;
                target.lon = selectedCity.longitude;
            }
        }
        target.dynamicColor = dynamicColorSwitch.get_active();
        target.dynamicImage = dynamicOverlaySwitch.get_active();
        target.useFahrenheit = fahrenheitSwitch.get_active();
    });

    return rowIdx;
}

export function buildTimeSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const formatLabel = new Gtk.Label({ label: 'Use 24-Hour Format:', xalign: 0, hexpand: true });
    const formatSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    formatSwitch.set_active(widget.use24h !== undefined ? widget.use24h : settings.get_boolean('time-format-24h'));

    grid.attach(formatLabel, 0, rowIdx, 1, 1);
    grid.attach(formatSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    let primaryPicker, sec1Picker, sec2Picker;
    if (widget.layout === 'world' || widget.cities) {
        const defaultCities = widget.cities || [...DEFAULT_WORLD_CLOCK_CITIES];
        primaryPicker = createLiveCitySearchRow(grid, 'Primary City (Top):', defaultCities[0] ?? DEFAULT_WORLD_CLOCK_CITIES[0], rowIdx++);
        sec1Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Left):', defaultCities[1] ?? DEFAULT_WORLD_CLOCK_CITIES[1], rowIdx++);
        sec2Picker = createLiveCitySearchRow(grid, 'Secondary City (Bottom Right):', defaultCities[2] ?? DEFAULT_WORLD_CLOCK_CITIES[2], rowIdx++);
    }

    saveHandlers.push((target) => {
        target.use24h = formatSwitch.get_active();
        if (primaryPicker && sec1Picker && sec2Picker) {
            target.cities = [
                primaryPicker.getSelectedCity(),
                sec1Picker.getSelectedCity(),
                sec2Picker.getSelectedCity()
            ];
        }
    });

    return rowIdx;
}

export function buildMusicSettings(grid, rowIdx, widget, saveHandlers) {
    const showControlsLabel = new Gtk.Label({ label: 'Show Player Controls:', xalign: 0, hexpand: true });
    const showControlsSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    showControlsSwitch.set_active(widget.showControls !== false);

    grid.attach(showControlsLabel, 0, rowIdx, 1, 1);
    grid.attach(showControlsSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.showControls = showControlsSwitch.get_active();
    });

    const ignoreBrowsersLabel = new Gtk.Label({ label: 'Ignore Browser Players:', xalign: 0, hexpand: true });
    const ignoreBrowsersSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    ignoreBrowsersSwitch.set_active(widget.ignoreBrowsers !== false);
    grid.attach(ignoreBrowsersLabel, 0, rowIdx, 1, 1);
    grid.attach(ignoreBrowsersSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const playerFilterLabel = new Gtk.Label({ label: 'Restrict To Player:', xalign: 0, hexpand: true });
    const playerFilterSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    const existingPlayerFilter = widget.playerFilter || '';
    playerFilterSwitch.set_active(existingPlayerFilter.trim() !== '');
    const playerFilterBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, halign: Gtk.Align.END });
    const playerFilterEntry = new Gtk.Entry({
        text: existingPlayerFilter,
        placeholder_text: 'e.g. spotify',
        hexpand: true,
    });
    playerFilterBox.append(playerFilterEntry);
    playerFilterBox.append(playerFilterSwitch);
    grid.attach(playerFilterLabel, 0, rowIdx, 1, 1);
    grid.attach(playerFilterBox, 1, rowIdx, 1, 1);
    rowIdx++;

    playerFilterEntry.set_sensitive(playerFilterSwitch.get_active());
    playerFilterSwitch.connect('notify::active', () => {
        playerFilterEntry.set_sensitive(playerFilterSwitch.get_active());
    });

    saveHandlers.push((target) => {
        target.ignoreBrowsers = ignoreBrowsersSwitch.get_active();
        target.playerFilter = playerFilterSwitch.get_active() ? playerFilterEntry.get_text().trim() : '';
    });

    if (isWideMusicLayout(widget)) {
        const coverBgLabel = new Gtk.Label({ label: 'Dominant Cover Background:', xalign: 0, hexpand: true });
        const coverBgSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
        coverBgSwitch.set_active(widget.coverBackground === true);
        grid.attach(coverBgLabel, 0, rowIdx, 1, 1);
        grid.attach(coverBgSwitch, 1, rowIdx, 1, 1);
        rowIdx++;

        saveHandlers.push((target) => {
            target.coverBackground = coverBgSwitch.get_active();
        });
    }

    return rowIdx;
}

export function buildPomodoroSettings(grid, rowIdx, widget, saveHandlers) {
    const durationFields = [
        { label: 'Work Duration (Minutes):', field: 'workMinutes', defaultValue: DEFAULT_WORK_MINUTES },
        { label: 'Short Break (Minutes):', field: 'shortBreakMinutes', defaultValue: DEFAULT_SHORT_BREAK_MINUTES },
        { label: 'Long Break (Minutes):', field: 'longBreakMinutes', defaultValue: DEFAULT_LONG_BREAK_MINUTES },
    ];

    const durationSpins = durationFields.map(({ label, field, defaultValue }) => {
        const rowLabel = new Gtk.Label({ label, xalign: 0, hexpand: true });
        const spin = Gtk.SpinButton.new_with_range(MIN_POMODORO_MINUTES, MAX_POMODORO_MINUTES, POMODORO_MINUTE_STEP);
        spin.set_valign(Gtk.Align.CENTER);
        spin.set_halign(Gtk.Align.END);
        spin.set_value(widget[field] !== undefined ? widget[field] : defaultValue);
        grid.attach(rowLabel, 0, rowIdx, 1, 1);
        grid.attach(spin, 1, rowIdx, 1, 1);
        rowIdx++;
        return { field, spin };
    });

    const sessionsLabel = new Gtk.Label({ label: 'Sessions Before Long Break:', xalign: 0, hexpand: true });
    const sessionsSpin = Gtk.SpinButton.new_with_range(MIN_SESSIONS_BEFORE_LONG_BREAK, MAX_SESSIONS_BEFORE_LONG_BREAK, POMODORO_MINUTE_STEP);
    sessionsSpin.set_valign(Gtk.Align.CENTER);
    sessionsSpin.set_halign(Gtk.Align.END);
    sessionsSpin.set_value(widget.sessionsBeforeLongBreak !== undefined ? widget.sessionsBeforeLongBreak : DEFAULT_SESSIONS_BEFORE_LONG_BREAK);
    grid.attach(sessionsLabel, 0, rowIdx, 1, 1);
    grid.attach(sessionsSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        durationSpins.forEach(({ field, spin }) => {
            target[field] = Math.round(spin.get_value());
        });
        target.sessionsBeforeLongBreak = Math.round(sessionsSpin.get_value());
    });

    return rowIdx;
}

export function buildAppLauncherSettings(grid, rowIdx, widget, saveHandlers) {
    const appSelection = createAppSelectionControls(grid, rowIdx, widget.apps || []);
    rowIdx++;

    saveHandlers.push((target) => {
        target.apps = appSelection.getSelectedApps();
    });

    return rowIdx;
}

export function buildSlideshowSettings(grid, rowIdx, widget, settings, saveHandlers) {
    const intervalLabel = new Gtk.Label({ label: 'Change Interval (Seconds):', xalign: 0, hexpand: true });
    const intervalSpin = Gtk.SpinButton.new_with_range(MIN_SLIDESHOW_INTERVAL_SEC, MAX_SLIDESHOW_INTERVAL_SEC, STEP_SLIDESHOW_INTERVAL_SEC);
    intervalSpin.set_valign(Gtk.Align.CENTER);
    intervalSpin.set_halign(Gtk.Align.END);
    intervalSpin.set_value(widget.intervalSeconds || DEFAULT_SLIDESHOW_INTERVAL_SEC);

    grid.attach(intervalLabel, 0, rowIdx, 1, 1);
    grid.attach(intervalSpin, 1, rowIdx, 1, 1);
    rowIdx++;

    const captionControls = buildCaptionControls(grid, rowIdx, widget, settings, 'My Slideshow');
    rowIdx = captionControls.rowIdx;
    const { captionEntry, showCaptionSwitch, fgColorBtn } = captionControls;

    saveHandlers.push((target) => {
        target.intervalSeconds = Math.round(intervalSpin.get_value());
        target.caption = captionEntry.get_text().trim() || 'My Slideshow';
        target.showCaption = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba().to_string();
    });

    return rowIdx;
}

export function buildGifSettings(grid, rowIdx, widget, saveHandlers) {
    const animateLabel = new Gtk.Label({ label: 'Animate GIF / WebP:', xalign: 0, hexpand: true });
    const animateSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, halign: Gtk.Align.END });
    animateSwitch.set_active(widget.animateGif !== false);

    grid.attach(animateLabel, 0, rowIdx, 1, 1);
    grid.attach(animateSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    saveHandlers.push((target) => {
        target.animateGif = animateSwitch.get_active();
    });

    return rowIdx;
}

export function buildImageSettings(grid, rowIdx, widget, settings, saveHandlers, parentWindow) {
    const imagePathLabel = new Gtk.Label({ label: 'Image File:', xalign: 0, hexpand: true });
    const imagePathBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, hexpand: true });
    const imagePathEntry = new Gtk.Entry({ text: widget.imagePath || '', hexpand: true });
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
    grid.attach(imagePathLabel, 0, rowIdx, 1, 1);
    grid.attach(imagePathBox, 1, rowIdx, 1, 1);
    rowIdx++;

    const captionControls = buildCaptionControls(grid, rowIdx, widget, settings, 'My Image');
    rowIdx = captionControls.rowIdx;
    const { captionEntry, showCaptionSwitch, fgColorBtn } = captionControls;

    saveHandlers.push((target) => {
        target.imagePath = imagePathEntry.get_text().trim();
        target.caption = captionEntry.get_text().trim() || 'My Image';
        target.showCaption = showCaptionSwitch.get_active();
        target.fgColor = fgColorBtn.get_rgba().to_string();
    });

    return rowIdx;
}
