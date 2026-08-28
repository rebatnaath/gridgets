import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';

/** Empty string means no font-family override; widgets inherit the system theme font. */
export const DEFAULT_FONT_FAMILY = '';

export const DEFAULT_BG_COLOR = '#222226';
export const DEFAULT_FG_COLOR = '#ffffff';
export const MAX_APP_LAUNCHER_ITEMS = 8;

const TEMPERATURE_FAHRENHEIT_MULTIPLIER = 9 / 5;
const TEMPERATURE_FAHRENHEIT_OFFSET = 32;

/** Cairo drawing constants — GJS doesn't expose these as named enums. */
export const CAIRO_OPERATOR_CLEAR = 0;
export const CAIRO_OPERATOR_OVER = 2;
export const CAIRO_LINE_CAP_ROUND = 1;

export const COLUMNS_COUNT = 50;
export const ROWS_COUNT = 16;
export const GRID_GAP_PX = 4;
export const GRID_MARGIN_PX = 4;


export const MIN_WIDGET_SIZES = Object.freeze({
    'pomodoro': { minCols: 3, minRows: 3 },
    'network-speed': { minCols: 3, minRows: 2 },
    'cpu-ram': { minCols: 3, minRows: 2 },
    'time': { minCols: 2, minRows: 2 },
    'weather': { minCols: 2, minRows: 2 },
    'music': { minCols: 3, minRows: 2 },
    'notes': { minCols: 3, minRows: 3 },
    'clipboard': { minCols: 3, minRows: 3 },
    'app-launcher': { minCols: 3, minRows: 2 },
    'slideshow': { minCols: 2, minRows: 2 },
    'image': { minCols: 2, minRows: 2 },
    'calendar': { minCols: 3, minRows: 3 },
    'quotes': { minCols: 3, minRows: 3 },
    'screen-time': { minCols: 6, minRows: 3 },
    'calendar-grid': { minCols: 4, minRows: 4 },
    'mood': { minCols: 4, minRows: 2 },
});

/**
 * Resolves the use24h setting for a time widget.
 * Individual widget override takes precedence over the global setting.
 */
export function resolveUse24h(widgetData) {
    return (widgetData.use24h === false) ? false : (widgetData.globalUse24h !== false);
}

/**
 * Calculates grid cell dimensions from canvas size and column count.
 * Returns { cellSize, cellTotalWidth, cellTotalHeight, gridRows }.
 */
export function calculateGridDimensions(width, height, gridCols) {
    const availableWidth = width - (GRID_MARGIN_PX * 2) - (GRID_GAP_PX * (gridCols - 1));
    const cellSize = Math.max(1, Math.floor(availableWidth / gridCols));
    const cellTotalWidth = cellSize + GRID_GAP_PX;
    const availableHeight = height - (GRID_MARGIN_PX * 2);
    const gridRows = Math.max(1, Math.floor((availableHeight + GRID_GAP_PX) / cellTotalWidth));
    return { cellSize, cellTotalWidth, cellTotalHeight: cellTotalWidth, gridRows };
}

/** Corner rounding applied to every widget; not user-configurable. */
export const DEFAULT_CORNER_RADIUS_PX = 12;

/** Returns whether a CSS color reads as a dark surface (luminance below 0.5). */
export function isDarkBackgroundColor(cssColor) {
    const parsed = parseCssColor(cssColor);
    if (!parsed) return true;
    return (parsed.r * 0.299 + parsed.g * 0.587 + parsed.b * 0.114) < 0.5;
}

/**
 * Resolves border overrides and global style settings for a widget.
 * Returns a merged object with applied* properties and global* properties.
 */
export function resolveWidgetOverrides(widgetData, globalSettings) {
    const {
        globalBgColor,
        globalFgColor,
        globalFontFamily,
    } = globalSettings;

    return Object.assign({}, widgetData, {
        appliedBorderRadius: DEFAULT_CORNER_RADIUS_PX,
        globalBackgroundColor: globalBgColor,
        globalForegroundColor: globalFgColor,
        globalFontFamily: globalFontFamily,
    });
}

/** The Adwaita accent palette, keyed by the GNOME 47+ 'accent-color' setting value. */
const ADWAITA_ACCENT_COLORS = Object.freeze({
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
});
const DEFAULT_ACCENT_COLOR = ADWAITA_ACCENT_COLORS.blue;

/**
 * Reads the system accent color from org.gnome.desktop.interface. The
 * 'accent-color' key only exists on GNOME 47+, so older schemas fall back to
 * the Adwaita default instead of erroring.
 */
export function resolveSystemAccentColor(interfaceSettings) {
    if (!interfaceSettings || !interfaceSettings.settings_schema.has_key('accent-color'))
        return DEFAULT_ACCENT_COLOR;
    return ADWAITA_ACCENT_COLORS[interfaceSettings.get_string('accent-color')] || DEFAULT_ACCENT_COLOR;
}

/** Reads global extension settings; when follow-system-theme is enabled, bg/fg follow the GNOME color scheme. */
export function readGlobalSettings(settings, interfaceSettings = null) {
    let globalBgColor = settings.get_string('global-background-color');
    let globalFgColor = settings.get_string('global-foreground-color');

    if (settings.get_boolean('follow-system-theme') && interfaceSettings) {
        const schemeColors = resolveSystemSchemeColors(interfaceSettings.get_string('color-scheme'));
        if (schemeColors) {
            globalBgColor = schemeColors.bg;
            globalFgColor = schemeColors.fg;
        }
    }

    const accentOverride = settings.get_string('accent-color-override');
    const globalAccentColor = accentOverride || resolveSystemAccentColor(interfaceSettings);

    return {
        globalBgColor,
        globalFgColor,
        globalAccentColor,
        globalFontFamily: settings.get_string('global-font-family'),
        globalAnimateGif: settings.get_boolean('image-animate-gif'),
        globalImageShowCaption: settings.get_boolean('image-show-caption'),
        globalSlideshowShowCaption: settings.get_boolean('slideshow-show-caption'),
        globalUseFahrenheit: settings.get_boolean('weather-use-fahrenheit'),
        globalWeatherDynamicColor: settings.get_boolean('weather-dynamic-color'),
        globalWeatherDynamicImage: settings.get_boolean('weather-dynamic-image'),
        globalWeatherCity: settings.get_string('weather-city'),
        globalUse24h: settings.get_boolean('time-format-24h'),
    };
}

/** Returns Adwaita surface colors for a GNOME color-scheme value, or null for unknown schemes. */
export function resolveSystemSchemeColors(colorScheme) {
    switch (colorScheme) {
        case 'prefer-dark':
            return { bg: '#222226', fg: '#ffffff' };
        case 'prefer-light':
        case 'default':
            return { bg: '#fafafb', fg: 'rgba(0, 0, 6, 0.8)' };
        default:
            return null;
    }
}

/** Checks if a filename has an extension that supports animation (.gif, .webp). */
export function isAnimatedImageFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.endsWith('.gif') || lower.endsWith('.webp');
}

export function celsiusToFahrenheit(celsius) {
    return (celsius * TEMPERATURE_FAHRENHEIT_MULTIPLIER) + TEMPERATURE_FAHRENHEIT_OFFSET;
}

/** Normalizes launcher app entries to a unique, capped list of desktop IDs and names. */
export function normalizeAppLauncherApps(apps) {
    if (!Array.isArray(apps)) {
        return [];
    }

    const normalizedApps = [];
    const seenIds = new Set();

    for (const app of apps) {
        if (!app || typeof app.id !== 'string') {
            continue;
        }

        const appId = app.id.trim();
        if (appId === '' || seenIds.has(appId)) {
            continue;
        }

        seenIds.add(appId);
        normalizedApps.push({
            id: appId,
            name: typeof app.name === 'string' && app.name.trim() !== ''
                ? app.name.trim()
                : appId.replace(/\.desktop$/i, ''),
        });

        if (normalizedApps.length >= MAX_APP_LAUNCHER_ITEMS) {
            break;
        }
    }

    return normalizedApps;
}

const CSS_RGB_FUNCTION_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?/;

/** Parses a CSS color string (#rrggbb or rgb()/rgba()) into normalized [0..1] RGB components. */
export function parseCssColor(colorString) {
    const HEX_BASE = 16;
    const COLOR_MAX_BYTE = 255;
    if (typeof colorString !== 'string')
        return { r: 0, g: 0, b: 0 };

    if (/^#[0-9a-fA-F]{6}$/.test(colorString)) {
        return {
            r: parseInt(colorString.slice(1, 3), HEX_BASE) / COLOR_MAX_BYTE,
            g: parseInt(colorString.slice(3, 5), HEX_BASE) / COLOR_MAX_BYTE,
            b: parseInt(colorString.slice(5, 7), HEX_BASE) / COLOR_MAX_BYTE,
        };
    }

    const rgbMatch = colorString.match(CSS_RGB_FUNCTION_PATTERN);
    if (rgbMatch) {
        const channel = (value) => Math.min(COLOR_MAX_BYTE, parseInt(value, 10)) / COLOR_MAX_BYTE;
        const parsed = { r: channel(rgbMatch[1]), g: channel(rgbMatch[2]), b: channel(rgbMatch[3]) };
        if (rgbMatch[4] !== undefined)
            parsed.a = Math.max(0, Math.min(1, parseFloat(rgbMatch[4])));
        return parsed;
    }

    return { r: 0, g: 0, b: 0 };
}

export const SECONDARY_OPACITY = 0.55;

/** Builds a CSS rgba() string from any CSS color string at the given alpha. */
export function cssColorToRgba(colorString, alpha = 1) {
    const { r, g, b } = parseCssColor(colorString);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

const LUMINANCE_RED_WEIGHT = 0.299;
const LUMINANCE_GREEN_WEIGHT = 0.587;
const LUMINANCE_BLUE_WEIGHT = 0.114;
const LUMINANCE_LIGHT_THRESHOLD = 0.55;
export const LIGHT_TEXT_ON_ACCENT = 'rgba(255, 255, 255, 0.92)';
export const DARK_TEXT_ON_ACCENT = 'rgba(30, 30, 30, 0.92)';

/** Returns a readable text color for content drawn on top of the accent color. */
export function resolveTextOnAccentColor(accentHex) {
    const accent = parseCssColor(accentHex);
    const accentLuminance = (accent.r * LUMINANCE_RED_WEIGHT)
        + (accent.g * LUMINANCE_GREEN_WEIGHT)
        + (accent.b * LUMINANCE_BLUE_WEIGHT);
    return accentLuminance > LUMINANCE_LIGHT_THRESHOLD
        ? DARK_TEXT_ON_ACCENT
        : LIGHT_TEXT_ON_ACCENT;
}

/** Directories already created this session, so mkdir syscalls run at most once per path. */
const ensuredDirectories = new Set();

/** Clears the directory cache; called from the extension's disable(). */
export function clearEnsuredDirectories() {
    ensuredDirectories.clear();
}

function ensureDirectory(dirPath, errorContext) {
    if (ensuredDirectories.has(dirPath))
        return;
    try {
        const file = Gio.File.new_for_path(dirPath);
        if (!file.query_exists(null)) {
            file.make_directory_with_parents(null);
        }
        ensuredDirectories.add(dirPath);
    } catch (e) {
        console.error(`Error creating ${errorContext} ${dirPath}:`, e);
    }
}

/** Returns the canonical user data storage directory for Gridgets (~/.local/share/gridgets/<subFolder>). */
export function getGridgetsDataDir(subFolder = '') {
    const pathParts = [GLib.get_user_data_dir(), 'gridgets'];
    if (subFolder) {
        pathParts.push(subFolder);
    }
    const dataDir = GLib.build_filenamev(pathParts);
    ensureDirectory(dataDir, 'data directory');
    return dataDir;
}

/**
 * Reads a JSON file asynchronously and invokes callback(parsed, parseError).
 * A missing/empty file yields callback(null) — the normal first-run case.
 * A file that exists but fails to parse yields callback(null, error) so
 * callers can avoid overwriting corrupt user data with fresh defaults.
 */
export function loadJsonFromFileAsync(filePath, callback) {
    const file = Gio.File.new_for_path(filePath);
    file.load_contents_async(null, (fileObj, res) => {
        let contents = null;
        try {
            const [success, bytes] = fileObj.load_contents_finish(res);
            if (success)
                contents = bytes;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error(`Error reading ${filePath}:`, e);
            callback(null);
            return;
        }

        if (!contents || contents.length === 0) {
            callback(null);
            return;
        }

        try {
            callback(JSON.parse(new TextDecoder('utf-8').decode(contents)));
        } catch (parseError) {
            console.error(`Corrupt JSON in ${filePath}; ignoring saved data:`, parseError);
            callback(null, parseError);
        }
    });
}

/** Writes a JS object as JSON to the specified file path atomically, fire-and-forget (async). */
export function saveJsonToFile(filePath, data) {
    const parentDir = Gio.File.new_for_path(filePath).get_parent();
    if (parentDir)
        ensureDirectory(parentDir.get_path(), 'parent directory');
    const bytes = new GLib.Bytes(JSON.stringify(data, null, 2));
    Gio.File.new_for_path(filePath).replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (file, res) => {
        try {
            file.replace_contents_finish(res);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Error saving JSON to ${filePath}:`, e);
        }
    });
}

/**
 * Synchronous counterpart of saveJsonToFile for teardown paths (widget destroy),
 * where an async write could still be pending when the extension is disabled.
 */
export function saveJsonToFileSync(filePath, data) {
    const parentDir = Gio.File.new_for_path(filePath).get_parent();
    if (parentDir)
        ensureDirectory(parentDir.get_path(), 'parent directory');
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    try {
        Gio.File.new_for_path(filePath).replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
        return true;
    } catch (e) {
        console.error(`Error saving JSON to ${filePath}:`, e);
        return false;
    }
}

/** Deletes the cache file associated with a widget from storage. */
export function deleteCacheFile(subFolder, widgetId) {
    if (!widgetId) return;
    const safeSubFolder = subFolder || '';
    const baseDir = getGridgetsDataDir(safeSubFolder);
    const filePath = GLib.build_filenamev([baseDir, `${safeSubFolder}-${widgetId}.json`]);
    const file = Gio.File.new_for_path(filePath);
    if (file.query_exists(null)) {
        file.delete_async(GLib.PRIORITY_DEFAULT, null, (f, res) => {
            try {
                f.delete_finish(res);
            } catch (e) {
                console.debug('Gridgets: cache file delete failed (non-critical):', e.message);
            }
        });
    }
}

function resolveWidgetConfigValue(config, globalKey, overrideKey, fallbackKeys, defaultValue) {
    const globalValue = config?.[globalKey] ?? defaultValue;
    if (!config) return globalValue;

    const isColorsOverridden = config.overrideColors ?? config[overrideKey];
    if (isColorsOverridden === false) return globalValue;

    for (const key of fallbackKeys) {
        if (config[key] !== undefined && config[key] !== null) return config[key];
    }
    return globalValue;
}

export function resolveWidgetBackgroundColor(config) {
    return resolveWidgetConfigValue(
        config,
        'globalBackgroundColor',
        'overrideBgColor',
        ['bgColor', 'textBackgroundColor'],
        DEFAULT_BG_COLOR
    );
}

export function buildBaseWidgetStyle(config) {
    const borderRadius = config.appliedBorderRadius || DEFAULT_CORNER_RADIUS_PX;
    return `border-radius: ${borderRadius}px;`;
}

export function resolveWidgetForegroundColor(config) {
    return resolveWidgetConfigValue(
        config,
        'globalForegroundColor',
        'overrideFgColor',
        ['fgColor', 'textColor'],
        DEFAULT_FG_COLOR
    );
}

/**
 * Returns the explicitly configured font family, or '' when none is set so
 * widgets inherit the system theme font. Never falls back to a hard-coded
 * family; DEFAULT_FONT_FAMILY is only a prefs-side display fallback.
 */
export function resolveExplicitFontFamily(config) {
    return (config && (config.fontFamily || config.globalFontFamily)) || '';
}

/**
 * Small/Medium/Large footprints on the fixed grid, indexed 0-2.
 * image / slideshow stay free-resizable instead ("free flow").
 */
export const SIZE_PRESET_TIERS = ['Small', 'Medium', 'Large'];
const SIZE_PRESETS = {
    'time': [[4, 3], [5, 4], [6, 5]],
    'worldClock': [[4, 4], [5, 5], [6, 6]],
    'weatherStandard': [[4, 4], [5, 5], [6, 6]],
    'weatherSimple': [[4, 4], [5, 5], [6, 5]],
    'weatherForecast': [[6, 4], [8, 5], [10, 6]],
    'sun-schedule': [[4, 4], [5, 5], [6, 6]],
    'musicSmall': [[4, 4], [5, 5], [6, 6]],
    'musicWide': [[8, 4], [10, 5], [12, 6]],
    'calendar': [[4, 4], [5, 5], [5, 6]],
    'calendar-grid': [[5, 4], [6, 5], [8, 7]],
    'system-dashboard': [[4, 4], [5, 5], [6, 6]],
    'pomodoro': [[4, 4], [5, 5], [6, 6]],
    'pomodoro-focus': [[8, 4], [10, 5], [12, 6]],
    'cpu-ram': [[4, 2], [6, 3], [8, 4]],
    'network-speed': [[4, 2], [6, 3], [8, 4]],
    'notes': [[4, 4], [5, 5], [6, 6]],
    'clipboard': [[4, 4], [5, 5], [6, 6]],
    'quotes': [[4, 4], [5, 5], [6, 6]],
    'screen-time': [[8, 4], [10, 5], [12, 6]],
    'todo': [[6, 4], [7, 4], [8, 5]],
    'github': [[8, 4], [10, 5], [12, 6]],
    'mood': [[6, 3], [8, 4], [10, 5]],
    'rss-headlines': [[4, 4], [5, 5], [6, 6]],
};

export const FREE_FLOW_SIZE_TYPES = ['image', 'slideshow'];

function resolveSizePresetTable(widgetData) {
    switch (widgetData.type) {
        case 'time':
            return (widgetData.layout === 'world') ? SIZE_PRESETS.worldClock : SIZE_PRESETS.time;
        case 'weather': {
            const layout = widgetData.layout || 'standard';
            if (layout === 'forecast')
                return SIZE_PRESETS.weatherForecast;
            return (layout === 'simple') ? SIZE_PRESETS.weatherSimple : SIZE_PRESETS.weatherStandard;
        }
        case 'music':
            return isWideMusicLayout(widgetData) ? SIZE_PRESETS.musicWide : SIZE_PRESETS.musicSmall;
        default:
            return SIZE_PRESETS[widgetData.type] || null;
    }
}

/** App launcher tiles grow with the app count; frames scale one step per preset tier. */
function resolveAppLauncherPreset(widgetData, sizeIndex) {
    const appCount = Array.isArray(widgetData.apps) ? widgetData.apps.length : 0;
    let tileCols = 1;
    let tileRows = 1;
    if (appCount > 6) { tileCols = 4; tileRows = 2; }
    else if (appCount > 4) { tileCols = 3; tileRows = 2; }
    else if (appCount > 2) { tileCols = 2; tileRows = 2; }
    else if (appCount === 2) { tileCols = 2; tileRows = 1; }
    return { width: tileCols + 2 + sizeIndex, height: tileRows + 1 + sizeIndex };
}

/** Returns whether the widget's context menu should offer S/M/L sizing. */
export function supportsSizePresets(widgetData) {
    return !FREE_FLOW_SIZE_TYPES.includes(widgetData.type)
        && (resolveSizePresetTable(widgetData) !== null || widgetData.type === 'app-launcher');
}

/** Returns the {width, height} footprint for a preset tier, or null when unsupported. */
export function resolveWidgetSizePreset(widgetData, sizeIndex) {
    if (widgetData.type === 'app-launcher')
        return resolveAppLauncherPreset(widgetData, sizeIndex);
    const table = resolveSizePresetTable(widgetData);
    if (!table || !table[sizeIndex])
        return null;
    return { width: table[sizeIndex][0], height: table[sizeIndex][1] };
}

export const WIDE_MUSIC_LAYOUT_ASPECT_RATIO = 1.5;

/**
 * Single source of truth for classifying the wide music layout; shared by the
 * shell-side music widget and the preferences catalog/edit panel.
 */
export function isWideMusicLayout(widget) {
    if (widget.isLargeLayout) return true;
    return widget.height > 0 && widget.width / widget.height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
}

/** Validates and constrains a widget's proposed new position and size during resize operations. */
export function calculateResizedDimensions(widgetData, newCols, newRows, newGridX, widgets = null, maxCols = COLUMNS_COUNT, maxRows = ROWS_COUNT) {
    const minLimits = MIN_WIDGET_SIZES[widgetData.type] || { minCols: 2, minRows: 2 };
    let validX = Math.max(0, Math.min(newGridX, maxCols - minLimits.minCols));
    let validCols = Math.max(minLimits.minCols, Math.min(newCols, maxCols - validX));
    let validRows = Math.max(minLimits.minRows, Math.min(newRows, maxRows - widgetData.y));

    if (widgetData.type === 'music' && widgetData.isLargeLayout) {
        validRows = Math.max(minLimits.minRows, Math.floor(validCols / 2));
        validCols = validRows * 2;
        if (validX + validCols > maxCols)
            validX = maxCols - validCols;

        if (widgetData.y + validRows > maxRows) {
            validRows = Math.max(1, maxRows - widgetData.y);
            validCols = validRows * 2;
        }
    }

    const otherWidgets = widgets ? widgets.filter(widget => widget.id !== widgetData.id) : [];

    if (otherWidgets.length > 0) {

        // Shrink width first, then height, so resize feedback stays predictable while avoiding overlap.
        while (validCols > minLimits.minCols && checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validCols--;
        }

        while (validRows > minLimits.minRows && checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validRows--;
        }

        if (checkOverlap(validX, widgetData.y, validCols, validRows, otherWidgets)) {
            validCols = Math.min(widgetData.width || minLimits.minCols, validCols);
            validRows = Math.min(widgetData.height || minLimits.minRows, validRows);
        }
    }

    return {
        validCols,
        validRows,
        validX,
    };
}

export function checkOverlap(x, y, width, height, widgets) {
    for (const widget of widgets) {
        const overlapX = x < (widget.x + widget.width) && (x + width) > widget.x;
        const overlapY = y < (widget.y + widget.height) && (y + height) > widget.y;
        if (overlapX && overlapY)
            return true;
    }
    return false;
}

export function todayDateString() {
    return toDateString(GLib.DateTime.new_now_local());
}

export function toDateString(dateTime) {
    return `${dateTime.get_year()}-${dateTime.get_month().toString().padStart(2, '0')}-${dateTime.get_day_of_month().toString().padStart(2, '0')}`;
}

const DEFAULT_SCREEN_ASPECT_RATIO = 16 / 9;

export function findEmptySpot(widgets, reqWidth, reqHeight, maxCols = COLUMNS_COUNT, maxRows = null) {
    if (maxRows === null) {
        maxRows = Math.max(1, Math.round(maxCols / DEFAULT_SCREEN_ASPECT_RATIO));
    }

    const effectiveReqW = Math.max(1, Math.min(reqWidth, maxCols));
    const effectiveReqH = Math.max(1, Math.min(reqHeight, maxRows));

    for (let row = 0; row <= maxRows - effectiveReqH; row++) {
        for (let col = 0; col <= maxCols - effectiveReqW; col++) {
            if (!checkOverlap(col, row, effectiveReqW, effectiveReqH, widgets)) {
                return { x: col, y: row };
            }
        }
    }
    return null;
}

export function getWidgets(settings) {
    if (!settings) return [];
    try {
        const jsonString = settings.get_string('widgets');
        return jsonString ? JSON.parse(jsonString) : [];
    } catch (e) {
        console.error('Failed to parse widgets JSON from settings:', e);
        return [];
    }
}

export function serializeWidgets(widgets) {
    return JSON.stringify(widgets || []);
}

export function saveWidgets(settings, widgets) {
    if (!settings) return;
    try {
        settings.set_string('widgets', serializeWidgets(widgets));
    } catch (e) {
        console.error('Failed to save widgets to settings:', e);
    }
}

/** Generates a unique widget ID by incrementing the highest existing counter for the given prefix. */
export function nextWidgetId(settings, prefix) {
    const idStem = `widget-${prefix}-`;
    let maxCounter = 0;
    for (const widget of getWidgets(settings)) {
        if (typeof widget.id !== 'string' || !widget.id.startsWith(idStem))
            continue;
        const counter = parseInt(widget.id.slice(idStem.length), 10);
        if (!isNaN(counter) && counter > maxCounter)
            maxCounter = counter;
    }
    return `${idStem}${maxCounter + 1}`;
}

/** Finds an empty grid spot, assigns position/size, and persists the widget. */
export function addWidget(settings, widgetData, defaultWidth, defaultHeight) {
    const widgets = getWidgets(settings);
    // preset widgets spawn at Medium so every type enters the grid at a
    // footprint that matches its S/M/L table; free-flow media keeps its own
    const defaultPreset = supportsSizePresets(widgetData)
        ? resolveWidgetSizePreset(widgetData, 0)
        : null;
    const spawnWidth = defaultPreset ? defaultPreset.width : defaultWidth;
    const spawnHeight = defaultPreset ? defaultPreset.height : defaultHeight;
    const gridCols = COLUMNS_COUNT;
    const emptySpot = findEmptySpot(widgets, spawnWidth, spawnHeight, gridCols);
    widgetData.x = emptySpot ? emptySpot.x : 0;
    widgetData.y = emptySpot ? emptySpot.y : 0;
    widgetData.width = spawnWidth;
    widgetData.height = spawnHeight;
    widgets.push(widgetData);
    saveWidgets(settings, widgets);
}

/**
 * Resolves a .desktop app id to a DesktopAppInfo;
 * the class lives in the GioUnix platform library.
 */
export function resolveDesktopAppInfo(appId) {
    if (!appId || typeof appId !== 'string') return null;

    const idCandidates = appId.endsWith('.desktop') ? [appId] : [appId, `${appId}.desktop`];

    for (const candidate of idCandidates) {
        const appInfo = GioUnix.DesktopAppInfo.new(candidate);
        if (appInfo && appInfo.get_id()) return appInfo;
    }
    return null;
}
