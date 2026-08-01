/**
 * ============================================================================
 * WIDGET UTILITIES
 * 
 * Shared constants and utility functions used across various widgets.
 * Includes functions for building CSS styles, parsing colors, loading/saving
 * JSON data, resolving widget colors, calculating resized dimensions, and
 * checking for widget overlaps.
 * ============================================================================
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/** Default font family used across all widgets */
export const DEFAULT_FONT_FAMILY = "'Poppins', sans-serif";

/** Default background and foreground colors */
export const DEFAULT_BG_COLOR = '#1a1b26';
export const DEFAULT_FG_COLOR = '#ffffff';
export const MAX_APP_LAUNCHER_ITEMS = 8;

/** Temperature conversion constants */
const TEMPERATURE_FAHRENHEIT_MULTIPLIER = 9 / 5;
const TEMPERATURE_FAHRENHEIT_OFFSET = 32;

/**
 * Cairo drawing constants — GJS doesn't expose these as named enums,
 * so we define them to avoid magic numbers in drawing code.
 */
export const CAIRO_OPERATOR_CLEAR = 0;
export const CAIRO_OPERATOR_OVER = 2;
export const CAIRO_LINE_CAP_ROUND = 1;

/** Standard layout grid dimension limits & spacing */
export const COLUMNS_COUNT = 28;
export const ROWS_COUNT = 16;
export const GRID_GAP_PX = 4;
export const GRID_MARGIN_PX = 4;


/** Minimum size requirements per widget type */
export const MIN_WIDGET_SIZES = Object.freeze({
    'pomodoro': { minCols: 3, minRows: 3 },
    'network-speed': { minCols: 3, minRows: 2 },
    'cpu-ram': { minCols: 3, minRows: 2 },
    'time': { minCols: 2, minRows: 2 },
    'weather': { minCols: 2, minRows: 2 },
    'music': { minCols: 3, minRows: 2 },
    'notes': { minCols: 3, minRows: 3 },
    'clipboard': { minCols: 3, minRows: 3 },
    'command': { minCols: 1, minRows: 1 },
    'app-launcher': { minCols: 3, minRows: 2 },
    'slideshow': { minCols: 2, minRows: 2 },
    'image': { minCols: 2, minRows: 2 },
    'calendar': { minCols: 3, minRows: 3 },
    'quotes': { minCols: 3, minRows: 3 },
});

/** Checks if a filename has an extension that supports animation (.gif, .webp). */
export function isAnimatedImageFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.endsWith('.gif') || lower.endsWith('.webp');
}

/** Converts a Celsius temperature value to Fahrenheit. */
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

/** Returns the default grid size for an app launcher based on app count. */
export function getAppLauncherDefaultSize(appCount) {
    if (appCount > 4) {
        return { width: 4, height: 4 };
    }

    return { width: 4, height: 3 };
}

/** Generates the CSS border declaration from a widget config's applied values. */
export function buildBorderStyle(config) {
    const borderWidth = config.appliedBorderWidth || 0;
    const borderColor = config.appliedBorderColor || 'transparent';
    if (borderWidth > 0) return `border: ${borderWidth}px solid ${borderColor};`;
    return '';
}

/** Parses a hex color string (#rrggbb) into normalized [0..1] RGB components. */
export function parseHexColor(hexString) {
    const HEX_BASE = 16;
    const COLOR_MAX_BYTE = 255;
    return {
        r: parseInt(hexString.slice(1, 3), HEX_BASE) / COLOR_MAX_BYTE,
        g: parseInt(hexString.slice(3, 5), HEX_BASE) / COLOR_MAX_BYTE,
        b: parseInt(hexString.slice(5, 7), HEX_BASE) / COLOR_MAX_BYTE,
    };
}

/** Returns the canonical user data storage directory for Gridgets (~/.local/share/gridgets/<subFolder>). */
export function getGridgetsDataDir(subFolder = '') {
    const pathParts = [GLib.get_user_data_dir(), 'gridgets'];
    if (subFolder) {
        pathParts.push(subFolder);
    }
    const dataDir = GLib.build_filenamev(pathParts);
    try {
        const file = Gio.File.new_for_path(dataDir);
        if (!file.query_exists(null)) {
            file.make_directory_with_parents(null);
        }
    } catch (e) {
        console.error(`Error creating data directory ${dataDir}:`, e);
    }
    return dataDir;
}

/** Reads a JSON file asynchronously from disk and invokes callback with parsed object. */
export function loadJsonFromFileAsync(filePath, callback) {
    const file = Gio.File.new_for_path(filePath);
    file.load_contents_async(null, (fileObj, res) => {
        try {
            const [success, contents] = fileObj.load_contents_finish(res);
            if (success && contents.length > 0) {
                const text = new TextDecoder('utf-8').decode(contents);
                callback(JSON.parse(text));
                return;
            }
        } catch (e) {
            // File does not exist or failed to parse
        }
        callback(null);
    });
}

/** Writes a JS object as JSON to the specified file path atomically. */
export function saveJsonToFile(filePath, data) {
    try {
        const parentDir = Gio.File.new_for_path(filePath).get_parent();
        if (parentDir && !parentDir.query_exists(null)) {
            parentDir.make_directory_with_parents(null);
        }
        const jsonString = JSON.stringify(data, null, 2);
        GLib.file_set_contents(filePath, jsonString);
    } catch (e) {
        console.error(`Error saving JSON to ${filePath}:`, e);
    }
}

/** Deletes the cache file associated with a widget from storage. */
export function deleteCacheFile(subFolder, widgetId) {
    try {
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
                    // Ignored if file was already removed
                }
            });
        }
    } catch (e) {
        console.error(`Error deleting cache file for ${subFolder}-${widgetId}:`, e);
    }
}

/** Resolves the effective background color for a widget from its configuration. */
export function resolveWidgetBackgroundColor(config) {
    const defaultColor = config?.globalBackgroundColor || DEFAULT_BG_COLOR;
    if (!config) return defaultColor;

    const isColorsOverridden = config.overrideColors ?? config.overrideBgColor;
    if (isColorsOverridden === false) return defaultColor;

    return config.bgColor || config.textBackgroundColor || defaultColor;
}

/** Generates the CSS border and border-radius declarations from a widget config. */
export function buildBaseWidgetStyle(config) {
    const borderRadius = config.appliedBorderRadius || 0;
    const borderStyle = buildBorderStyle(config);
    return `border-radius: ${borderRadius}px; ${borderStyle}`;
}

/** Resolves the effective text color for a widget from its configuration. */
export function resolveWidgetForegroundColor(config) {
    const defaultColor = config?.globalForegroundColor || DEFAULT_FG_COLOR;
    if (!config) return defaultColor;

    const isColorsOverridden = config.overrideColors ?? config.overrideFgColor;
    if (isColorsOverridden === false) return defaultColor;

    return config.fgColor || config.textColor || defaultColor;
}

/** Resolves the effective font family for a widget from its configuration. */
export function resolveWidgetFontFamily(config) {
    const defaultFont = config?.globalFontFamily || DEFAULT_FONT_FAMILY;
    if (!config) return defaultFont;

    const isColorsOverridden = config.overrideColors ?? config.overrideFont;
    if (isColorsOverridden === false) return defaultFont;

    return config.fontFamily || defaultFont;
}

/** Validates and constrains a widget's proposed new position and size during resize operations. */
export function calculateResizedDimensions(widgetData, newCols, newRows, newGridX, settingsOrWidgets = null, maxCols = COLUMNS_COUNT, maxRows = ROWS_COUNT) {
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

    let widgets = [];
    if (Array.isArray(settingsOrWidgets)) {
        widgets = settingsOrWidgets;
    } else if (settingsOrWidgets && typeof settingsOrWidgets.get_string === 'function') {
        widgets = getWidgets(settingsOrWidgets);
    }

    if (widgets && widgets.length > 0) {
        const otherWidgets = widgets.filter(widget => widget.id !== widgetData.id);

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

/** Checks whether a proposed widget placement overlaps any existing widgets. */
export function checkOverlap(x, y, width, height, widgets) {
    for (const widget of widgets) {
        const overlapX = x < (widget.x + widget.width) && (x + width) > widget.x;
        const overlapY = y < (widget.y + widget.height) && (y + height) > widget.y;
        if (overlapX && overlapY)
            return true;
    }
    return false;
}

/** Calculates minimum required grid columns to fit all placed widgets horizontally and vertically without overlap. */
export function getMinRequiredCols(widgets, canvasWidth = 1920, canvasHeight = 1080) {
    if (!widgets || widgets.length === 0) return 6;

    const maxHorizCols = widgets.reduce((max, widget) => Math.max(max, (widget.x || 0) + (widget.width || 1)), 6);
    const maxVertRows = widgets.reduce((max, widget) => Math.max(max, (widget.y || 0) + (widget.height || 1)), 4);

    let minCols = Math.max(6, maxHorizCols);

    const MAX_ALLOWED_GRID_COLS = 60;
    while (minCols < MAX_ALLOWED_GRID_COLS) {
        const availW = canvasWidth - (GRID_MARGIN_PX * 2) - (GRID_GAP_PX * (minCols - 1));
        const cellSize = Math.max(1, Math.floor(availW / minCols));
        const availH = canvasHeight - (GRID_MARGIN_PX * 2);
        const gridRows = Math.max(1, Math.floor((availH + GRID_GAP_PX) / (cellSize + GRID_GAP_PX)));

        if (gridRows >= maxVertRows) break;
        minCols++;
    }

    return Math.min(MAX_ALLOWED_GRID_COLS, minCols);
}

/** Default screen aspect ratio constant (16:9) */
const DEFAULT_SCREEN_ASPECT_RATIO = 16 / 9;

/** Finds the first available non-overlapping grid spot for a widget of given dimensions. */
export function findEmptySpot(widgets, reqWidth, reqHeight, settingsOrCols = null, customRows = null) {
    let maxCols = COLUMNS_COUNT;
    let maxRows = ROWS_COUNT;

    if (typeof settingsOrCols === 'number') {
        maxCols = settingsOrCols;
        if (typeof customRows === 'number') {
            maxRows = customRows;
        } else {
            maxRows = Math.max(1, Math.round(maxCols / DEFAULT_SCREEN_ASPECT_RATIO));
        }
    } else if (settingsOrCols && typeof settingsOrCols.get_boolean === 'function') {
        if (settingsOrCols.get_boolean('grid-custom-size')) {
            maxCols = Math.max(4, settingsOrCols.get_int('grid-columns'));
        }
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

/** Safely parses and returns the array of widget configuration objects from Gio.Settings. */
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

/** Serializes and saves an array of widget configuration objects to Gio.Settings. */
export function saveWidgets(settings, widgets) {
    if (!settings) return;
    try {
        const jsonString = JSON.stringify(widgets || []);
        settings.set_string('widgets', jsonString);
    } catch (e) {
        console.error('Failed to save widgets to settings:', e);
    }
}

/** Finds an empty grid spot, assigns position/size, and persists the widget. */
export function addWidget(settings, widgetData, defaultWidth, defaultHeight) {
    const widgets = getWidgets(settings);
    const emptySpot = findEmptySpot(widgets, defaultWidth, defaultHeight, settings);
    widgetData.x = emptySpot ? emptySpot.x : 0;
    widgetData.y = emptySpot ? emptySpot.y : 0;
    widgetData.width = defaultWidth;
    widgetData.height = defaultHeight;
    widgets.push(widgetData);
    saveWidgets(settings, widgets);
}
