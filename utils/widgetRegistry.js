// Widget identity lives here: which layouts a type has, what footprint each size
// tier gives it, and which widgets persist data of their own.
//
// This module is imported by the shell and by the preferences process, so it must
// not reach for St, Clutter, Meta, Gtk, Gdk or Adw. Anything that varies per process
// (descriptions, thumbnails) belongs to the preferences side instead.

const WIDE_MUSIC_LAYOUT_ASPECT_RATIO = 1.5;

const TIME_LAYOUTS = Object.freeze({
    default: 'time',
    world: 'worldClock',
});

const WEATHER_LAYOUTS = Object.freeze({
    standard: 'weatherStandard',
    simple: 'weatherSimple',
    forecast: 'weatherForecast',
});

const MUSIC_LAYOUTS = Object.freeze({
    small: 'musicSmall',
    wide: 'musicWide',
});

// Small/Medium/Large footprints on the fixed grid, indexed 0-2.
const SIZE_PRESETS = Object.freeze({
    'time': [[4, 3], [5, 4], [6, 5]],
    'worldClock': [[4, 4], [5, 5], [6, 6]],
    'weatherStandard': [[4, 4], [5, 5], [6, 6]],
    'weatherSimple': [[4, 4], [5, 5], [6, 5]],
    'weatherForecast': [[6, 4], [8, 5], [10, 6]],
    'sun-schedule': [[7, 5], [7, 6], [8, 7]],
    'musicSmall': [[4, 4], [5, 5], [6, 6]],
    'musicWide': [[8, 4], [10, 5], [12, 6]],
    'calendar': [[4, 4], [5, 5], [5, 6]],
    'calendar-grid': [[5, 4], [6, 5], [8, 7]],
    'calendar-agenda': [[7, 4], [9, 5], [13, 7]],
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
});

// Media widgets stay freely resizable instead of following the S/M/L table.
const FREE_FLOW_SIZE_TYPES = Object.freeze(['image', 'slideshow']);

// Data a widget persists beside its settings, and the folder it lives in. One map
// serves both processes so deleting a widget from either side cleans up the same
// files; the two used to disagree and left notes files behind.
const CACHE_FOLDERS = Object.freeze({
    notes: 'notes',
    clipboard: 'clipboard',
    todo: 'todos',
    github: 'github',
});

export const SIZE_PRESET_TIERS = Object.freeze(['Small', 'Medium', 'Large']);
export { FREE_FLOW_SIZE_TYPES, WIDE_MUSIC_LAYOUT_ASPECT_RATIO };

/** Every layout name a weather widget may carry, for callers that validate the value. */
export const WEATHER_LAYOUT_NAMES = Object.freeze(Object.keys(WEATHER_LAYOUTS));

/**
 * Classifies the wide music layout. `isLargeLayout` is set by the preferences adder
 * before the widget has a size, so the intended layout can still be honoured.
 */
export function isWideMusicLayout(widget) {
    if (widget.isLargeLayout) return true;
    return widget.height > 0 && widget.width / widget.height >= WIDE_MUSIC_LAYOUT_ASPECT_RATIO;
}

/**
 * Resolves a widget to its entry in the size table. Returns null for types that are
 * freely resizable.
 */
export function resolveWidgetSizeTableKey(widgetData) {
    switch (widgetData.type) {
        case 'time':
            return (widgetData.layout === 'world') ? TIME_LAYOUTS.world : TIME_LAYOUTS.default;
        case 'weather': {
            const layout = widgetData.layout || 'standard';
            return WEATHER_LAYOUTS[layout] || WEATHER_LAYOUTS.standard;
        }
        case 'music':
            return isWideMusicLayout(widgetData) ? MUSIC_LAYOUTS.wide : MUSIC_LAYOUTS.small;
        default:
            return SIZE_PRESETS[widgetData.type] ? widgetData.type : null;
    }
}

/** App launcher tiles grow with the app count; frames scale one step per preset tier. */
const APP_LAUNCHER_MIN_TILE_COLS = 1;
const APP_LAUNCHER_TILE_STEP = 2;
const APP_LAUNCHER_FRAME_STEP = 1;

function resolveAppLauncherPreset(widgetData, sizeIndex) {
    const appCount = Array.isArray(widgetData.apps) ? widgetData.apps.length : 0;
    let tileCols = APP_LAUNCHER_MIN_TILE_COLS;
    let tileRows = 1;
    if (appCount > 6) { tileCols = 4; tileRows = 2; }
    else if (appCount > 4) { tileCols = 3; tileRows = 2; }
    else if (appCount > 2) { tileCols = 2; tileRows = 2; }
    else if (appCount === 2) { tileCols = 2; tileRows = 1; }
    return {
        width: tileCols + APP_LAUNCHER_TILE_STEP + sizeIndex,
        height: tileRows + APP_LAUNCHER_FRAME_STEP + sizeIndex,
    };
}

/** Returns whether the widget's context menu should offer S/M/L sizing. */
export function supportsSizePresets(widgetData) {
    return !FREE_FLOW_SIZE_TYPES.includes(widgetData.type)
        && (resolveWidgetSizeTableKey(widgetData) !== null || widgetData.type === 'app-launcher');
}

/** Returns the {width, height} footprint for a preset tier, or null when unsupported. */
export function resolveWidgetSizePreset(widgetData, sizeIndex) {
    if (widgetData.type === 'app-launcher')
        return resolveAppLauncherPreset(widgetData, sizeIndex);
    const tableKey = resolveWidgetSizeTableKey(widgetData);
    const table = tableKey ? SIZE_PRESETS[tableKey] : null;
    if (!table || !table[sizeIndex])
        return null;
    return { width: table[sizeIndex][0], height: table[sizeIndex][1] };
}

/** The folder a widget type keeps its data in, or null when it persists nothing. */
export function getWidgetCacheFolder(widgetType) {
    return CACHE_FOLDERS[widgetType] || null;
}
