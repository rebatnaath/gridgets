// Widget identity lives here: which layouts a type has, what footprint each size
// tier gives it, and which widgets persist data of their own.
//
// This module is imported by the shell and by the preferences process, so it must
// not reach for St, Clutter, Meta, Gtk, Gdk or Adw. Anything that varies per process
// (descriptions, thumbnails) belongs to the preferences side instead.

import { MIN_CITY_COUNT, resolveCityList } from './worldClockCities.js';

const WIDE_MUSIC_LAYOUT_ASPECT_RATIO = 1.5;

const TIME_LAYOUTS = Object.freeze({
    default: 'time',
    world: 'worldClock',
    worldPair: 'worldClockPair',
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
    'time': [[4, 4], [5, 5], [6, 6]],
    'worldClock': [[4, 3], [5, 5], [6, 6]],
    'worldClockPair': [[4, 3]],
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
    'top-stories': [[10, 8], [11, 9], [12, 10]],
});

// Media widgets stay freely resizable instead of following the S/M/L table.
const FREE_FLOW_SIZE_TYPES = Object.freeze(['image', 'slideshow']);

// Data a widget persists beside its settings, and the folder it lives in. One map
// serves both processes so deleting a widget from either side cleans up the same files.
const CACHE_FOLDERS = Object.freeze({
    notes: 'notes',
    clipboard: 'clipboard',
    todo: 'todos',
    github: 'github',
    'top-stories': 'top-stories',
    'rss-headlines': 'rss-headlines',
    quotes: 'quotes',
    weather: 'weather',
    'sun-schedule': 'sun-schedule',
});

/**
 * Publisher section feeds, grouped by genre. A genre is expressed as which sections get
 * merged rather than as a topic query, because aggregator feeds carry no per-article
 * image: Google News returns its own logo as og:image for every story, so filtering one
 * would leave every card showing the same picture.
 *
 * Every feed here was checked for both images and dates, and all of them carry 100% of
 * each. That is the whole constraint on this list, and it is why familiar outlets are
 * absent: The Guardian, Al Jazeera, DW, Nature, Science Daily, TechCrunch, the NYT and
 * Business Insider all publish parseable feeds with dates and no images at all, so adding
 * them would silently drop those cards to the monogram. Sports is thin for the same
 * reason - most club and league feeds 404 or serve no items.
 */
const TOP_STORY_FEEDS = Object.freeze({
    'top': Object.freeze([
        { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
        { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
        { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
        { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
        { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
        { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
        { name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/world.xml' },
        { name: 'The Hill', url: 'https://thehill.com/news/feed/' },
    ]),
    'business': Object.freeze([
        { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
        { name: 'Sky Business', url: 'https://feeds.skynews.com/feeds/rss/business.xml' },
        { name: 'NPR Business', url: 'https://feeds.npr.org/1006/rss.xml' },
        { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
        { name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
        { name: 'Fortune', url: 'https://fortune.com/feed/fortune-feeds/?id=3230629' },
    ]),
    'sports': Object.freeze([
        { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
        { name: 'Sky Sports', url: 'https://feeds.skynews.com/feeds/rss/sports.xml' },
        { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/' },
    ]),
    'technology': Object.freeze([
        { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
        { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
        { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
        { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
        { name: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
        { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml' },
        { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    ]),
    'science': Object.freeze([
        { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/' },
        { name: 'Phys.org', url: 'https://phys.org/rss-feed/' },
        { name: 'Quanta', url: 'https://api.quantamagazine.org/feed/' },
        { name: 'Live Science', url: 'https://www.livescience.com/feeds/all' },
        { name: 'NPR Science', url: 'https://feeds.npr.org/1007/rss.xml' },
    ]),
});

export const DEFAULT_TOP_STORY_GENRE = 'top';
export const TOP_STORY_GENRE_NAMES = Object.freeze(Object.keys(TOP_STORY_FEEDS));

/** Titles for the context menu and the widget's own heading, so the two cannot disagree. */
export const TOP_STORY_GENRE_LABELS = Object.freeze({
    'top': 'Top Stories',
    'business': 'Business',
    'sports': 'Sports',
    'technology': 'Technology',
    'science': 'Science',
});

export function getTopStoryGenreLabel(genre) {
    return TOP_STORY_GENRE_LABELS[genre] || TOP_STORY_GENRE_LABELS.top;
}

/** Heading icon per genre, all of them Adwaita so no extra icon theme is needed. */
export const TOP_STORY_GENRE_ICONS = Object.freeze({
    'top': 'application-rss+xml-symbolic',
    'business': 'system-users-symbolic',
    'sports': 'applications-games-symbolic',
    'technology': 'computer-symbolic',
    'science': 'applications-science-symbolic',
});

export function getTopStoryGenreIcon(genre) {
    return TOP_STORY_GENRE_ICONS[genre] || TOP_STORY_GENRE_ICONS.top;
}

/** Feed set for a genre, falling back to the mixed top-stories set for anything unknown. */
export function getTopStoryFeeds(genre) {
    return TOP_STORY_FEEDS[genre] || TOP_STORY_FEEDS.top;
}

export const SIZE_PRESET_TIERS = Object.freeze(['Small', 'Medium', 'Large']);
export { WIDE_MUSIC_LAYOUT_ASPECT_RATIO };

/**
 * Classifies the wide music layout. `isLargeLayout` is set by the preferences adder
 * before the widget has a size, so the intended layout can still be honoured.
 *
 * The aspect test is a fallback for a widget saved before that flag existed. Both music
 * footprints are 2:1 in cells, so on the fixed grid the ratio is 2.0 at any cell size and
 * this can only ever say yes; the flag is what actually chooses the layout.
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
            if (widgetData.layout !== 'world')
                return TIME_LAYOUTS.default;
            // Two cities fill the smallest cell on their own, so a pair stops at 4x4 and
            // has no tiers above it. resolveCityList is what the widget itself renders, so
            // the cap cannot disagree with the number of rows on the face.
            return resolveCityList(widgetData.cities).length <= MIN_CITY_COUNT
                ? TIME_LAYOUTS.worldPair
                : TIME_LAYOUTS.world;
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
    if (!table || !table.length)
        return null;
    // A tier past the end of a short table resolves to its largest size rather than to
    // nothing, so a widget whose table shrank keeps a real footprint.
    const tier = table[Math.min(sizeIndex, table.length - 1)];
    return { width: tier[0], height: tier[1] };
}

/**
 * How many size tiers this widget actually offers. A world clock with two cities has a
 * one-entry table, so offering Medium and Large would list choices that do nothing.
 */
export function sizePresetTierCount(widgetData) {
    if (widgetData.type === 'app-launcher')
        return SIZE_PRESET_TIERS.length;
    const tableKey = resolveWidgetSizeTableKey(widgetData);
    const table = tableKey ? SIZE_PRESETS[tableKey] : null;
    return table ? Math.min(table.length, SIZE_PRESET_TIERS.length) : 0;
}

/** The folder a widget type keeps its data in, or null when it persists nothing. */
export function getWidgetCacheFolder(widgetType) {
    return CACHE_FOLDERS[widgetType] || null;
}
