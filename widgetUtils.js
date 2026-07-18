/**
 * ============================================================================
 * WIDGET UTILITIES
 * 
 * This file provides shared constants and utility functions used
 * across various widgets. It includes functions for building CSS styles,
 * parsing colors, loading/saving JSON data, resolving widget colors,
 * calculating resized dimensions, and checking for widget overlaps.
 * ============================================================================
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Shared constants 

export const DEFAULT_FONT_FAMILY = "'Poppins', sans-serif";

// Cairo drawing constants — GJS doesn't expose these as named enums,
// so we define them to avoid magic numbers in drawing code.
export const CAIRO_OPERATOR_CLEAR = 0;
export const CAIRO_OPERATOR_OVER = 2;
export const CAIRO_LINE_CAP_ROUND = 1;

/**
 * Generates the CSS border declaration from a widget config's applied values.
 * Returns an empty string if no border is configured.
 */
export function buildBorderStyle(config) {
    const borderWidth = config.appliedBorderWidth || 0;
    const borderColor = config.appliedBorderColor || 'transparent';
    if (borderWidth > 0) return `border: ${borderWidth}px solid ${borderColor};`;
    return '';
}

/**
 * Parses a hex color string (#rrggbb) into normalized [0..1] RGB components.
 */
export function parseHexColor(hexString) {
    return {
        r: parseInt(hexString.slice(1, 3), 16) / 255,
        g: parseInt(hexString.slice(3, 5), 16) / 255,
        b: parseInt(hexString.slice(5, 7), 16) / 255,
    };
}

/**
 * Reads a JSON file from disk and returns the parsed object.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function loadJsonFromFile(filePath) {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null))
        return null;

    try {
        const inStream = file.read(null);
        const dataStream = new Gio.DataInputStream({ base_stream: inStream });
        let content = '';
        let [line] = dataStream.read_line_utf8(null);
        while (line !== null) {
            content += line + '\n';
            [line] = dataStream.read_line_utf8(null);
        }
        dataStream.close(null);

        if (content)
            return JSON.parse(content);
    } catch (e) {
        console.error(`Error loading JSON from ${filePath}:`, e);
    }
    return null;
}

/**
 * Writes a JS object as JSON to the specified file path.
 * Creates or overwrites the file.
 */
export function saveJsonToFile(filePath, data) {
    try {
        const jsonString = JSON.stringify(data);
        const file = Gio.File.new_for_path(filePath);
        const outStream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        const dataStream = new Gio.DataOutputStream({ base_stream: outStream });
        dataStream.put_string(jsonString, null);
        dataStream.close(null);
    } catch (e) {
        console.error(`Error saving JSON to ${filePath}:`, e);
    }
}

/**
 * Deletes the cache file associated with a widget (e.g. notes-xxx.json, clipboard-xxx.json).
 * Silently succeeds if the file doesn't exist.
 */
export function deleteCacheFile(extensionPath, prefix, widgetId) {
    try {
        const filePath = `${extensionPath}/${prefix}-${widgetId}.json`;
        const file = Gio.File.new_for_path(filePath);
        if (file.query_exists(null))
            file.delete(null);
    } catch (e) {
        console.error(`Error deleting cache file for ${prefix}-${widgetId}:`, e);
    }
}

export const DEFAULT_BG_COLORS = {
    'weather': '#1a1b26',
    'notes': '#1a1b26',
    'command': '#1a1b26',
    'time': '#1a1b26',
    'music': '#1a1b26',
    'pomodoro': '#1a1b26',
    'cpu-ram': '#1a1b26',
    'network-speed': '#1a1b26',
    'clipboard': '#1a1b26',
    'slideshow': '#1a1b26',
};

export function resolveWidgetBackgroundColor(config) {
    const fallbackColor = '#1a1b26';
    const defaultColor = (config && config.globalBackgroundColor) || (config && DEFAULT_BG_COLORS[config.type]) || fallbackColor;

    if (!config) {
        return defaultColor;
    }

    if (config.overrideBgColor !== undefined) {
        if (config.overrideBgColor) {
            return config.bgColor || defaultColor;
        }
        return defaultColor;
    }

    // Music widget uses textBackgroundColor for its background configuration
    return config.bgColor || config.textBackgroundColor || defaultColor;
}

/**
 * Generates the CSS border and border-radius declarations from a widget config.
 * Standardizes border and corner rounding across all widgets.
 *
 * @param {Object} config   - widget configuration
 * @returns {string}        - CSS style string
 */
export function buildBaseWidgetStyle(config) {
    const borderRadius = config.appliedBorderRadius || 0;
    const borderStyle = buildBorderStyle(config);
    return `border-radius: ${borderRadius}px; ${borderStyle}`;
}

export const DEFAULT_FG_COLORS = {
    'weather': '#ffffff',
    'notes': '#ffffff',
    'command': '#ffffff',
    'time': '#ffffff',
    'music': '#ffffff',
    'pomodoro': '#ffffff',
    'cpu-ram': '#ffffff',
    'network-speed': '#ffffff',
    'clipboard': '#ffffff',
    'slideshow': '#ffffff',
};

export function resolveWidgetForegroundColor(config) {
    const fallbackColor = '#ffffff';
    const defaultColor = (config && config.globalForegroundColor) || (config && DEFAULT_FG_COLORS[config.type]) || fallbackColor;

    if (!config) {
        return defaultColor;
    }

    if (config.overrideBgColor !== undefined) {
        if (config.overrideBgColor) {
            return config.textColor || defaultColor;
        }
        return defaultColor;
    }

    return config.textColor || defaultColor;
}

// Layout grid constants
export const COLUMNS_COUNT = 28;
export const ROWS_COUNT = 16;

/**
 * Calculates and validates the new dimensions (columns, rows, grid X) for a widget
 * during or after a resizing operation, enforcing any type-specific constraints
 * (e.g., aspect ratios).
 *
 * @param {Object} widgetData   - widget configuration
 * @param {number} newCols      - proposed column span
 * @param {number} newRows      - proposed row span
 * @param {number} newGridX     - proposed X coordinate on the grid
 * @returns {{validCols: number, validRows: number, validX: number}} - validated dimensions
 */
export function calculateResizedDimensions(widgetData, newCols, newRows, newGridX) {
    let validX = Math.max(0, Math.min(newGridX, COLUMNS_COUNT - 1));
    let validCols = Math.max(1, Math.min(newCols, COLUMNS_COUNT - validX));
    let validRows = Math.max(1, Math.min(newRows, ROWS_COUNT - widgetData.y));

    // Enforce 2:1 aspect ratio for large music widgets
    if (widgetData.type === 'music' && widgetData.isLargeLayout) {
        validRows = Math.floor(validCols / 2);
        if (validRows < 1) {
            validRows = 1;
            validCols = 2;
            if (validX + validCols > COLUMNS_COUNT)
                validX = COLUMNS_COUNT - validCols;
        } else {
            validCols = validRows * 2;
        }

        if (widgetData.y + validRows > ROWS_COUNT) {
            validRows = ROWS_COUNT - widgetData.y;
            validCols = validRows * 2;
            if (validRows < 1) {
                validRows = 1;
                validCols = 2;
            }
        }
    }

    return {
        validCols,
        validRows,
        validX,
    };
}

/**
 * Checks whether a proposed widget placement overlaps any existing widgets.
 * Used by both the desktop grid and the preferences helper.
 *
 * @param {number}  x        - Proposed column
 * @param {number}  y        - Proposed row
 * @param {number}  width    - Widget column span
 * @param {number}  height   - Widget row span
 * @param {Array}   widgets  - Array of existing widget data objects
 * @returns {boolean}        - True if there is an overlap
 */
export function checkOverlap(x, y, width, height, widgets) {
    for (const widget of widgets) {
        const overlapX = x < (widget.x + widget.width) && (x + width) > widget.x;
        const overlapY = y < (widget.y + widget.height) && (y + height) > widget.y;
        if (overlapX && overlapY)
            return true;
    }
    return false;
}
