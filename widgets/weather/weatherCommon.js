import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import { formatSnapshotAge, loadLastGoodCache, saveLastGoodCache } from '../../utils/lastGoodCache.js';
export { formatSnapshotAge };
import {
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    resolveWidgetCornerRadius,
    DEFAULT_BG_COLOR,
    buildBaseWidgetStyle,
    celsiusToFahrenheit,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';
import { clampWidgetScale } from '../../utils/typography.js';
import { addSettleAfterResize } from '../../utils/resizeSettle.js';
import { scaleFontSize, TEXT_OPACITY } from '../../utils/typography.js';
import { HTTP_STATUS_OK, createGetMessage } from '../../utils/httpClient.js';

export const REFRESH_INTERVAL_SECONDS = 1800;


export const HOURLY_FORECAST_COUNT = 6;

export const WEATHER_METADATA_OPACITY = TEXT_OPACITY.metadata;
export const WEATHER_SUBTLE_OPACITY = TEXT_OPACITY.subtle;

const FORECAST_MIN_GRID_WIDTH = 6;
const SIMPLE_MIN_GRID_WIDTH = 4;
/** Cached conditions and forecast stop being shown past this; the widget falls back to its placeholders. */
export const WEATHER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LOCATION_COORDINATE_TOLERANCE = 0.0001;

export const WEATHER_LOADING_TEXT = 'Loading…';
export const LOCATION_UNAVAILABLE_TEXT = 'Location unavailable';
export const HIGH_LOW_LOADING_TEXT = 'H:--° L:--°';

export function scaleWeatherValue(value, scale, minimum = 1) {
    return scaleFontSize(value, scale, minimum);
}

export function buildWeatherTextStyle(fontCss, {
    fontSize,
    fontWeight,
    color = 'inherit',
    opacity,
    textAlign,
    margin,
} = {}) {
    const properties = [fontCss, `font-size: ${fontSize}px;`, `font-weight: ${fontWeight};`];
    if (color)
        properties.push(`color: ${color};`);
    if (opacity !== undefined)
        properties.push(`opacity: ${opacity};`);
    if (textAlign)
        properties.push(`text-align: ${textAlign};`);
    if (margin)
        properties.push(margin);
    return properties.join(' ');
}


// Font-family CSS or empty string to inherit the system theme font.
export function buildFontCss(widgetData) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    return fontFamily ? `font-family: ${fontFamily}; ` : '';
}

/**
 * The scale the responsive scaler would compute, for use before it is attached.
 *
 * Its first pass is deferred to an idle, so a layout that only styles itself from the
 * callback paints one frame at its unscaled BASE_* sizes. Falls back to the reference
 * size while the actor is still unallocated, which is a scale of 1.
 */
export function initialScaleFor(widgetNode, refWidth, refHeight) {
    const width = widgetNode.width > 0 ? widgetNode.width : refWidth;
    const height = widgetNode.height > 0 ? widgetNode.height : refHeight;
    return clampWidgetScale(Math.min(width / refWidth, height / refHeight));
}

const decoder = new TextDecoder('utf-8');

const MILLISECONDS_PER_SECOND = 1000;
const OPEN_METEO_FORECAST_DAYS = 2;
const WEATHER_REQUEST_TIMEOUT_SECONDS = 30;
const ISO_DATE_KEY_LENGTH = 10;
const ISO_HOUR_KEY_LENGTH = 13;
const LAYOUT_PADDING_PX = 12;

const GEOCODE_CACHE = new Map();
const GEOCODE_CACHE_LIMIT = 32;
let cachedGnomeWeatherIconDirectory = null;

/**
 * The hour key for a moment in the location's own timezone. Open-Meteo reports its series
 * in that zone, so its keys carry no offset and cannot be compared against UTC.
 */
function locationHourKey(epochMs, utcOffsetSeconds) {
    const local = new Date(epochMs + utcOffsetSeconds * MILLISECONDS_PER_SECOND);
    const pad = value => String(value).padStart(2, '0');
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}`;
}

/**
 * The hour as the location reads it.
 *
 * The request asks for `timezone=auto`, so time_str is already the location's own clock
 * and its is_day flag was computed from it. The digits are taken from that string rather
 * than from a Date: building one from the hour and minute makes a local wall-clock
 * instant, and formatting it re-enters the system zone, which shifts the label away from
 * the icon beside it. The 12/24h choice still follows the system, since that is a
 * presentation preference rather than a time.
 */
function formatHourLabel(hourData) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(hourData.time_str || ''));
    if (!match)
        return '--';
    const hour = Number(match[4]);
    const minute = match[5];
    if (!hour12Clock())
        return `${String(hour).padStart(2, '0')}:${minute}`;
    const suffix = hour < 12 ? 'AM' : 'PM';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}:${minute} ${suffix}`;
}

let cachedHour12 = null;
function hour12Clock() {
    if (cachedHour12 === null)
        cachedHour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
    return cachedHour12;
}

function cacheBounded(cache, capacity, cacheKey, cacheValue) {
    if (cache.size >= capacity)
        cache.delete(cache.keys().next().value);
    cache.set(cacheKey, cacheValue);
}

const WEATHER_CODE_CLEAR = 1000;
const WEATHER_CODE_PARTLY_CLOUDY = 1003;
const WEATHER_CODE_CLOUDY_1 = 1006;
const WEATHER_CODE_CLOUDY_2 = 1009;
// These groups must stay exhaustive over the WeatherAPI condition code space
// (https://www.weatherapi.com/docs/weather_conditions.json). A code in no group falls
// through to clear-sky, which silently renders rain as a sunny day.
const WEATHER_CODE_FOG_GROUP = [1012, 1030, 1039, 1042, 1135, 1147];
const WEATHER_CODE_DUST_GROUP = [1015, 1018, 1021, 1024, 1027, 1033, 1036, 1045, 1048];
const WEATHER_CODE_SLEET_GROUP = [1069, 1198, 1201, 1204, 1207, 1249, 1252];
const WEATHER_CODE_HAIL_GROUP = [1237, 1261, 1264];
const WEATHER_CODE_RAIN_GROUP = [1063, 1072, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246];
const WEATHER_CODE_THUNDERSTORMS_GROUP = [1087, 1273, 1276, 1279, 1282];
const WEATHER_CODE_SNOW_BLIZZARD = 1117;
const WEATHER_CODE_SNOW_GROUP = [1066, 1114, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258];

function resolveConditionCode(code, text = '') {
    if (typeof code === 'number' && code > 0) return code;
    const lower = (text || '').toLowerCase();
    if (lower.includes('clear') || lower.includes('sun')) return WEATHER_CODE_CLEAR;
    if (lower.includes('partly')) return WEATHER_CODE_PARTLY_CLOUDY;
    if (lower.includes('cloud') || lower.includes('overcast')) return WEATHER_CODE_CLOUDY_1;
    if (lower.includes('fog') || lower.includes('mist')) return WEATHER_CODE_FOG_GROUP[0];
    if (lower.includes('dust') || lower.includes('sand')) return WEATHER_CODE_DUST_GROUP[0];
    if (lower.includes('sleet') || lower.includes('freezing')) return WEATHER_CODE_SLEET_GROUP[0];
    if (lower.includes('hail')) return WEATHER_CODE_HAIL_GROUP[0];
    if (lower.includes('rain') || lower.includes('drizzle') || lower.includes('shower')) return WEATHER_CODE_RAIN_GROUP[0];
    if (lower.includes('thunder') || lower.includes('storm')) return WEATHER_CODE_THUNDERSTORMS_GROUP[0];
    if (lower.includes('blizzard')) return WEATHER_CODE_SNOW_BLIZZARD;
    if (lower.includes('snow') || lower.includes('flurry')) return WEATHER_CODE_SNOW_GROUP[0];
    return WEATHER_CODE_CLEAR;
}

const WEATHER_ASSET_RULES = [
    {
        matches: code => code === WEATHER_CODE_CLEAR,
        dayIcon: 'weather-clear',
        nightIcon: 'weather-clear-night',
        dayBackground: ['#2b84d4', '#1a5a9e', 'clear-day'],
        nightBackground: ['#121e33', '#0a1221', 'clear-night'],
    },
    {
        matches: code => code === WEATHER_CODE_PARTLY_CLOUDY,
        dayIcon: 'weather-few-clouds',
        nightIcon: 'weather-few-clouds-night',
        dayBackground: ['#5b8cbd', '#3d6a94', 'partly-cloudy-day'],
        nightBackground: ['#25354a', '#152335', 'partly-cloudy-night'],
    },
    {
        matches: code => code === WEATHER_CODE_CLOUDY_1,
        dayIcon: 'weather-few-clouds',
        // Without this the night hours fall back to dayIcon and show a sun after dark.
        nightIcon: 'weather-few-clouds-night',
        dayBackground: ['#121D2B', '#1a2a3d', 'cloudy-day'],
        nightBackground: ['#14181a', '#0c0f12', 'cloudy-day'],
    },
    {
        matches: code => code === WEATHER_CODE_CLOUDY_2,
        dayIcon: 'weather-overcast',
        dayBackground: ['#0e1520', '#162030', 'overcast-day'],
        nightBackground: ['#0c0f12', '#0a0d10', 'overcast-day'],
    },
    {
        matches: code => WEATHER_CODE_FOG_GROUP.includes(code),
        dayIcon: 'weather-fog',
        dayBackground: ['#a1aba3', '#7a8480', 'fog-day'],
        nightBackground: ['#3c403e', '#252825', 'fog-day'],
    },
    {
        matches: code => WEATHER_CODE_DUST_GROUP.includes(code),
        dayIcon: 'weather-windy',
        dayBackground: ['#c2a884', '#a08460', 'sandstorm-day'],
        nightBackground: ['#4a3d2c', '#302618', 'sandstorm-day'],
    },
    {
        matches: code => WEATHER_CODE_SLEET_GROUP.includes(code),
        dayIcon: 'weather-showers',
        dayBackground: ['#5a8f9c', '#3d6e78', 'rain-day'],
        nightBackground: ['#1d343b', '#112126', 'rain-day'],
    },
    {
        matches: code => WEATHER_CODE_HAIL_GROUP.includes(code),
        dayIcon: 'weather-showers',
        dayBackground: ['#7b8c9c', '#5a6b7a', 'rain-day'],
        nightBackground: ['#212a33', '#131a22', 'rain-day'],
    },
    {
        matches: code => WEATHER_CODE_RAIN_GROUP.includes(code),
        dayIcon: 'weather-showers',
        dayBackground: ['#121D2B', '#1a2a3d', 'rain-day'],
        nightBackground: ['#14181a', '#0c0f12', 'rain-day'],
    },
    {
        matches: code => WEATHER_CODE_THUNDERSTORMS_GROUP.includes(code),
        dayIcon: 'weather-storm',
        nightIcon: 'weather-storm',
        dayBackground: ['#232533', '#151622', 'rain-day'],
        nightBackground: ['#232533', '#151622', 'rain-day'],
    },
    {
        matches: code => code === WEATHER_CODE_SNOW_BLIZZARD,
        dayIcon: 'weather-snow',
        dayBackground: ['#b8d6eb', '#8bb5d0', 'snow-day'],
        nightBackground: ['#465661', '#2e3b44', 'snow-day'],
    },
    {
        matches: code => WEATHER_CODE_SNOW_GROUP.includes(code),
        dayIcon: 'weather-snow',
        dayBackground: ['#8dafc4', '#6d92a8', 'snow-day'],
        nightBackground: ['#243a4a', '#162633', 'snow-day'],
    },
];

function getWeatherAssets(extensionPath, code, isDay, folderName = '3x3', text = '') {
    const effectiveCode = resolveConditionCode(code, text);
    const rule = WEATHER_ASSET_RULES.find(candidate => candidate.matches(effectiveCode));
    const background = isDay ? rule?.dayBackground : rule?.nightBackground;
    const iconName = isDay ? rule?.dayIcon : (rule?.nightIcon || rule?.dayIcon);
    const assets = {
        iconName: iconName || (isDay ? 'weather-clear' : 'weather-clear-night'),
        bgStart: background?.[0] || DEFAULT_BG_COLOR,
        bgEnd: background?.[1] || DEFAULT_BG_COLOR,
        bgImagePath: background ? `${extensionPath}/assets/weather/${folderName}/${background[2]}.png` : '',
    };

    if (assets.bgImagePath && !GLib.file_test(assets.bgImagePath, GLib.FileTest.EXISTS))
        assets.bgImagePath = '';

    return assets;
}

// Clutter reports a non-finite extent while an actor is unallocated; passing
// that through produces an INT32_MIN allocation and a NaN box.
function resolveSaneExtent(extent) {
    if (!Number.isFinite(extent) || extent <= 0) return 0;
    return Math.round(extent);
}

// Keeps a child actor the same size as its widget node, storing the signal ids on it.
function trackWidgetSize(actor, widgetNode) {
    // Held still during a resize drag, per resizeSettle.js, and applied once at the end.
    const resizeToWidget = () => {
        if (isActorDestroyed(actor) || widgetNode.isResizing)
            return;
        actor.set_width(resolveSaneExtent(widgetNode.width));
        actor.set_height(resolveSaneExtent(widgetNode.height));
    };
    actor.backgroundSignalIds = [
        widgetNode.connect('notify::width', resizeToWidget),
        widgetNode.connect('notify::height', resizeToWidget),
    ];
    addSettleAfterResize(widgetNode, resizeToWidget);
    return actor;
}

export function createBackgroundImageActor(widgetNode) {
    return trackWidgetSize(watchActorLifecycle(new St.Widget({
        style: '',
        x: 0,
        y: 0,
        width: widgetNode.width,
        height: widgetNode.height,
    })), widgetNode);
}

export function createMainLayout(widgetNode) {
    return trackWidgetSize(watchActorLifecycle(new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${LAYOUT_PADDING_PX}px;`,
        x: 0,
        y: 0,
        width: widgetNode.width,
        height: widgetNode.height,
    })), widgetNode);
}

export function createFallbackIcon() {
    return 'weather-clear';
}

function getGnomeWeatherIconDirectory() {
    // Resolving this walks up to eight symlinks and stats a directory, and it is asked
    // for once per icon on every refresh, so the answer is kept for the session.
    if (cachedGnomeWeatherIconDirectory !== null)
        return cachedGnomeWeatherIconDirectory;

    const executablePath = GLib.find_program_in_path('gnome-weather');
    if (!executablePath) {
        cachedGnomeWeatherIconDirectory = '';
        return cachedGnomeWeatherIconDirectory;
    }

    let resolvedPath = executablePath;
    for (let depth = 0; depth < 8; depth++) {
        const file = Gio.File.new_for_path(resolvedPath);
        const fileInfo = file.query_info(
            'standard::type,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
        if (fileInfo.get_file_type() !== Gio.FileType.SYMBOLIC_LINK)
            break;

        const target = fileInfo.get_symlink_target();
        resolvedPath = GLib.path_is_absolute(target)
            ? target
            : GLib.build_filenamev([GLib.path_get_dirname(resolvedPath), target]);
        resolvedPath = GLib.canonicalize_filename(resolvedPath, null);
    }

    const installationDirectory = GLib.path_get_dirname(GLib.path_get_dirname(resolvedPath));
    cachedGnomeWeatherIconDirectory = `${installationDirectory}/share/icons/hicolor/scalable/status`;
    return cachedGnomeWeatherIconDirectory;
}

function setWeatherIcon(iconActor, iconName) {
    const baseName = String(iconName || 'weather-clear')
        .replace(/-symbolic$/, '')
        .replace(/-(small|large)$/, '');
    const iconNames = [
        `${baseName}-large`,
        `${baseName}-small`,
        baseName,
        `${baseName}-symbolic`,
    ];
    const iconDirectory = getGnomeWeatherIconDirectory();
    if (iconDirectory) {
        for (const themedName of iconNames) {
            const themedPath = GLib.build_filenamev([iconDirectory, `${themedName}.svg`]);
            if (GLib.file_test(themedPath, GLib.FileTest.EXISTS)) {
                iconActor.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(themedPath) });
                return;
            }
        }
    }

    // Gio.ThemedIcon.new() takes a single string in this GJS, not an array, so a
    // fallback chain has to be built by appending. Passing the array instead throws
    // "Expected type string for argument 'iconname' but got type Array", which on any
    // machine without gnome-weather installed would abandon the whole UI update.
    const themedIcon = new Gio.ThemedIcon();
    for (const themedName of iconNames)
        themedIcon.append_name(themedName);
    iconActor.gicon = themedIcon;
}

// Resolves the effective layout variant with the same rule the widget factory uses.
export function resolveWeatherLayoutVariant(widgetData) {
    return widgetData.layout || (
        widgetData.width >= FORECAST_MIN_GRID_WIDTH
            ? 'forecast'
            : (widgetData.width === SIMPLE_MIN_GRID_WIDTH ? 'simple' : 'standard')
    );
}

function getAssetSizeForWidget(widgetData) {
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);
    return layoutVariant === 'forecast' ? '4x6' : '3x3';
}

function updateHourlyForecastUi(json, uiElements, currentEpoch, extensionPath, useFahrenheit, folderName = '3x3') {
    if (!uiElements.hourlyActors || uiElements.hourlyActors.length === 0 || !json.forecast || !json.forecast.forecastday)
        return;

    let allHours = [];
    if (json.forecast.forecastday.length > 0 && json.forecast.forecastday[0].hour)
        allHours = allHours.concat(json.forecast.forecastday[0].hour);
    if (json.forecast.forecastday.length > 1 && json.forecast.forecastday[1].hour)
        allHours = allHours.concat(json.forecast.forecastday[1].hour);

    // Against the current hour, not the hour of the fetch: this also runs on a restored
    // snapshot, where the fetch may have been hours ago and the hours it kept are past.
    const offsetSeconds = json.current ? json.current.utc_offset_seconds : null;
    const currentHourStr = Number.isFinite(offsetSeconds)
        ? locationHourKey(Date.now(), offsetSeconds)
        : (json.current ? json.current.last_updated_hour : null);
    let futureHours;
    if (currentHourStr) {
        futureHours = allHours.filter(hourData => hourData.time_str && hourData.time_str.slice(0, ISO_HOUR_KEY_LENGTH) > currentHourStr);
    } else {
        const refEpoch = currentEpoch || Math.floor(Date.now() / 1000);
        futureHours = allHours.filter(hourData => hourData.time_epoch > refEpoch);
    }

    if (futureHours.length < HOURLY_FORECAST_COUNT && allHours.length >= HOURLY_FORECAST_COUNT) {
        futureHours = allHours.slice(-HOURLY_FORECAST_COUNT);
    }

    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        if (futureHours[i] && uiElements.hourlyActors[i]) {
            const hourData = futureHours[i];
            const displayTemperature = useFahrenheit ? hourData.temp_f : hourData.temp_c;
            uiElements.hourlyActors[i].timeLbl.text = formatHourLabel(hourData);
            uiElements.hourlyActors[i].tempLbl.text = `${Math.round(displayTemperature)}°`;

            const condCode = resolveConditionCode(hourData.condition ? hourData.condition.code : null, hourData.condition ? hourData.condition.text : '');
            const isDay = hourData.is_day !== undefined ? (hourData.is_day === 1 || hourData.is_day === true) : true;
            const hourlyAssets = getWeatherAssets(extensionPath, condCode, isDay, folderName, hourData.condition ? hourData.condition.text : '');
            setWeatherIcon(uiElements.hourlyActors[i].icon, hourlyAssets.iconName);
        }
    }
}

function setCityLabelWithAge(cityLabel, name, ageText) {
    const safeName = GLib.markup_escape_text(String(name || ''), -1);
    if (!ageText) {
        cityLabel.clutter_text.set_markup(safeName);
        return;
    }
    const safeAge = GLib.markup_escape_text(ageText, -1);
    cityLabel.clutter_text.set_markup(`${safeName} <span alpha="${Math.round(WEATHER_METADATA_OPACITY * 100)}%">\u00b7 ${safeAge}</span>`);
}

function updateTextLabels(json, uiElements, useFahrenheit, staleAgeText = '') {
    const current = json.current;
    if (!current) return;

    const forecast = (json.forecast && json.forecast.forecastday && json.forecast.forecastday[0]) ? json.forecast.forecastday[0].day : null;
    const unit = useFahrenheit ? '°F' : '°C';
    const highLabel = 'H';
    const lowLabel = 'L';

    const currentTemp = useFahrenheit ? current.temp_f : current.temp_c;
    if (uiElements.tempLabel) uiElements.tempLabel.text = `${Math.round(currentTemp)}${unit}`;
    if (uiElements.conditionLabel && current.condition) uiElements.conditionLabel.text = current.condition.text;
    if (json.location && json.location.name && uiElements.cityLabel) {
        setCityLabelWithAge(uiElements.cityLabel, json.location.name, staleAgeText);
    }

    if (forecast) {
        const highTemp = useFahrenheit ? forecast.maxtemp_f : forecast.maxtemp_c;
        const lowTemp = useFahrenheit ? forecast.mintemp_f : forecast.mintemp_c;
        if (uiElements.highLowLabel) {
            uiElements.highLowLabel.text = `${highLabel}:${Math.round(highTemp)}${unit} ${lowLabel}:${Math.round(lowTemp)}${unit}`;
        }
    }

}

function updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage) {
    const fontCss = buildFontCss(widgetData);
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const textColor = isDynamicColor
        ? (isDarkBackgroundColor(assets.bgEnd || assets.bgStart) ? '#ffffff' : '#000000')
        : resolveWidgetForegroundColor(widgetData);

    if (isDynamicColor) {
        const bgEnd = assets.bgEnd || assets.bgStart;
        widgetNode.style = `
            background-gradient-direction: vertical;
            background-gradient-start: ${assets.bgStart};
            background-gradient-end: ${bgEnd};
            color: ${textColor};
            ${fontCss}
            ${baseStyle}
        `;
    } else {
        const bgColor = resolveWidgetBackgroundColor(widgetData);
        widgetNode.style = `
            background-color: ${bgColor};
            color: ${textColor};
            ${fontCss}
            ${baseStyle}
        `;
    }

    if (isDynamicImage && assets.bgImagePath) {
        const borderRadius = resolveWidgetCornerRadius(widgetData);
        bgImageActor.style = `
            background-image: url("${assets.bgImagePath}");
            background-size: cover;
            background-position: center;
            border-radius: ${borderRadius}px;
        `;
        bgImageActor.show();
    } else {
        bgImageActor.hide();
    }
}

export function updateWeatherUi(json, context) {
    const { widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath } = context;
    if (isActorDestroyed(widgetNode) || !json || !json.current) return;

    const useFahrenheit = widgetData.useFahrenheit !== undefined ? widgetData.useFahrenheit : (widgetData.globalUseFahrenheit === true);
    const isDay = json.current.is_day !== undefined ? (json.current.is_day === 1 || json.current.is_day === true) : true;
    const condCode = resolveConditionCode(json.current.condition ? json.current.condition.code : null, json.current.condition ? json.current.condition.text : '');
    const folderName = getAssetSizeForWidget(widgetData);
    const assets = getWeatherAssets(extensionPath, condCode, isDay, folderName, json.current.condition ? json.current.condition.text : '');

    updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage);
    updateTextLabels(json, uiElements, useFahrenheit, context.snapshotAgeText || '');

    if (uiElements.conditionIcon) {
        setWeatherIcon(uiElements.conditionIcon, assets.iconName);
    }

    updateHourlyForecastUi(json, uiElements, json.current.last_updated_epoch, extensionPath, useFahrenheit, folderName);
}

/**
 * The condition as a label.
 *
 * The clear codes say "Sunny" by day and "Clear" at night: WMO 0 and 1 describe the sky,
 * not the time, and the icon beside this already switches on is_day. Without that the
 * widget read "Sunny" next to a moon.
 */
function getWmoConditionText(code, isDay = true) {
    switch (code) {
        case 0: return isDay ? 'Sunny' : 'Clear';
        case 1: return isDay ? 'Mainly Clear' : 'Mostly Clear';
        case 2: return 'Partly Cloudy';
        case 3: return 'Overcast';
        case 45: case 48: return 'Foggy';
        case 51: case 53: case 55: return 'Drizzle';
        case 56: case 57: return 'Freezing Drizzle';
        case 61: case 63: case 65: return 'Rain';
        case 66: case 67: return 'Freezing Rain';
        case 71: case 73: case 75: return 'Snow';
        case 77: return 'Snow Grains';
        case 80: case 81: case 82: return 'Rain Showers';
        case 85: case 86: return 'Snow Showers';
        case 95: case 96: case 99: return 'Thunderstorm';
        default: return 'Clear';
    }
}

function wmoToWeatherApiCode(wmo) {
    if (wmo === 0) return 1000;
    if (wmo === 1 || wmo === 2) return 1003;
    if (wmo === 3) return 1006;
    if (wmo === 45 || wmo === 48) return 1030;
    if (wmo >= 51 && wmo <= 57) return 1153;
    if (wmo >= 61 && wmo <= 67) return 1189;
    if (wmo >= 71 && wmo <= 77) return 1213;
    if (wmo >= 80 && wmo <= 82) return 1240;
    if (wmo >= 85 && wmo <= 86) return 1255;
    if (wmo >= 95) return 1087;
    return 1000;
}

// Gio.IOErrorEnum is an enum namespace, not a constructor, so `instanceof` against it is
// always false. A refresh aborts its own request first, so cancellation is expected here.
export function isCancelledError(error) {
    return Boolean(error.matches) && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function fetchJsonAsync(session, url) {
    return new Promise((resolve, reject) => {
        const message = createGetMessage(url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sessionObject, result) => {
            try {
                // Finish the transfer before inspecting the status: on a transport failure
                // the status is 0, so checking first would leak the result.
                const bytes = sessionObject.send_and_read_finish(result);
                if (message.get_status() !== HTTP_STATUS_OK) {
                    reject(new Error(`HTTP ${message.get_status()}`));
                    return;
                }
                resolve(JSON.parse(decoder.decode(bytes.get_data())));
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Fetches Open-Meteo free API fallback data when WeatherAPI key is missing.
export async function fetchOpenMeteoFallback(locationName, context) {
    const { widgetNode } = context;
    if (isActorDestroyed(widgetNode) || !widgetNode.weatherSession) return;

    try {
        const cached = GEOCODE_CACHE.get(locationName);
        if (cached) {
            await fetchOpenMeteoWeather(cached, context);
            return;
        }

        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=en&format=json`;
        const geoJson = await fetchJsonAsync(widgetNode.weatherSession, geoUrl);

        if (isActorDestroyed(widgetNode) || !geoJson.results || geoJson.results.length === 0) {
            if (!isActorDestroyed(widgetNode))
                context.markFetchFailed?.();
            return;
        }
        const { latitude, longitude, name } = geoJson.results[0];
        cacheBounded(GEOCODE_CACHE, GEOCODE_CACHE_LIMIT, locationName, { latitude, longitude, name });

        await fetchOpenMeteoWeather({ latitude, longitude, name }, context);
    } catch (error) {
        if (isCancelledError(error)) return;
        console.error('Error geocoding location for Open-Meteo fallback:', error);
        context.markFetchFailed?.();
    }
}

// Clears the geocoding cache; called from the extension's disable().
export function clearGeocodeCache() {
    GEOCODE_CACHE.clear();
}

function buildOpenMeteoHourlyGroups(weatherJson, currentCode) {
    const hourlyGroups = new Map();
    const hourlyData = weatherJson.hourly;
    if (!hourlyData?.time || !hourlyData.temperature_2m)
        return hourlyGroups;

    hourlyData.time.forEach((timeString, timeIndex) => {
        // Open-Meteo keeps these series parallel, but a short read would otherwise index
        // past the end and put NaN in the temperature column. A gap in the series arrives
        // as null rather than undefined, and rounding that would read as a real 0 degrees.
        const temperatureCelsius = hourlyData.temperature_2m[timeIndex];
        if (!Number.isFinite(temperatureCelsius))
            return;
        const weatherCode = hourlyData.weathercode?.[timeIndex] ?? currentCode;
        const isDay = hourlyData.is_day?.[timeIndex] ?? weatherJson.current_weather.is_day;
        const dateKey = timeString.slice(0, ISO_DATE_KEY_LENGTH);
        const hourEntry = {
            time_epoch: Math.floor(Date.parse(timeString) / MILLISECONDS_PER_SECOND),
            time_str: timeString,
            temp_c: temperatureCelsius,
            temp_f: celsiusToFahrenheit(temperatureCelsius),
            is_day: isDay === 1 || isDay === true,
            condition: {
                code: wmoToWeatherApiCode(weatherCode),
                text: getWmoConditionText(weatherCode, isDay === 1 || isDay === true),
            },
        };
        const dayEntries = hourlyGroups.get(dateKey) || [];
        dayEntries.push(hourEntry);
        hourlyGroups.set(dateKey, dayEntries);
    });
    return hourlyGroups;
}

function buildOpenMeteoDailyForecasts(weatherJson, hourlyGroups) {
    // The daily series is indexed by its own dates rather than by position: the hourly
    // series can start on the day before the first forecast day, which would otherwise
    // shift every high and low onto the wrong column.
    const dailyDates = weatherJson.daily?.time || [];
    return [...hourlyGroups.entries()].map(([dateKey, hourEntries]) => {
        const dayIndex = dailyDates.indexOf(dateKey);
        const currentTemperature = weatherJson.current_weather.temperature;
        let highTemperature = currentTemperature;
        let lowTemperature = currentTemperature;
        if (dayIndex >= 0 && Number.isFinite(weatherJson.daily?.temperature_2m_max?.[dayIndex])) {
            highTemperature = weatherJson.daily.temperature_2m_max[dayIndex];
            lowTemperature = weatherJson.daily.temperature_2m_min[dayIndex];
        }
        return {
            // reindexForecastDays drops days that have already started, and it can only
            // do that if each entry knows which day it is.
            date: dateKey,
            day: {
                maxtemp_c: highTemperature,
                maxtemp_f: celsiusToFahrenheit(highTemperature),
                mintemp_c: lowTemperature,
                mintemp_f: celsiusToFahrenheit(lowTemperature),
            },
            hour: hourEntries,
        };
    });
}

function buildOpenMeteoPayload(weatherJson, locationName) {
    const currentWeather = weatherJson.current_weather;
    const currentCode = currentWeather.weathercode;
    const utcOffsetSeconds = weatherJson.utc_offset_seconds || 0;
    const nowLocationMs = Date.now() + (utcOffsetSeconds * MILLISECONDS_PER_SECOND);
    const currentHour = locationHourKey(Date.now(), utcOffsetSeconds);
    // A missing reading is not a reading of zero, and this value is what gets stored as the
    // widget's last good weather, so an absent one must not be cached as a fact.
    if (!Number.isFinite(currentWeather.temperature))
        return null;
    const hourlyGroups = buildOpenMeteoHourlyGroups(weatherJson, currentCode);
    return {
        location: { name: locationName },
        current: {
            temp_c: currentWeather.temperature,
            temp_f: celsiusToFahrenheit(currentWeather.temperature),
            is_day: currentWeather.is_day,
            last_updated_epoch: Math.floor(nowLocationMs / MILLISECONDS_PER_SECOND),
            last_updated_hour: currentHour,
            // Open-Meteo's hour keys carry no offset, so a restored snapshot can only be
            // re-filtered against the current wall clock if it knows whose clock that is.
            utc_offset_seconds: utcOffsetSeconds,
            condition: {
                code: wmoToWeatherApiCode(currentCode),
                text: getWmoConditionText(currentCode, currentWeather.is_day === 1 || currentWeather.is_day === true),
            },
        },
        forecast: {
            forecastday: buildOpenMeteoDailyForecasts(weatherJson, hourlyGroups),
        },
    };
}

/**
 * A snapshot is only valid for the location it was fetched for. The widget config can
 * change under a cached snapshot (the user picks a different city), and without this the
 * widget would confidently display the previous city's weather.
 */
function snapshotMatchesWidget(snapshot, widgetData) {
    if (!snapshot) return false;
    const widgetHasCoords = Number.isFinite(widgetData?.lat) && Number.isFinite(widgetData?.lon);
    if (widgetHasCoords) {
        if (!Number.isFinite(snapshot.lat) || !Number.isFinite(snapshot.lon))
            return false;
        return Math.abs(snapshot.lat - widgetData.lat) <= LOCATION_COORDINATE_TOLERANCE
            && Math.abs(snapshot.lon - widgetData.lon) <= LOCATION_COORDINATE_TOLERANCE;
    }
    const widgetName = String(widgetData?.location || '');
    const snapshotName = String(snapshot.name || '');
    if (!widgetName || !snapshotName)
        return false;
    return widgetName.localeCompare(snapshotName, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * forecastday[0] means "today" as of the fetch, so a snapshot restored a couple of days
 * later would label past days as upcoming. Days that have already started are dropped and
 * the rest shift down, which keeps the day columns meaning what the user expects.
 */
function reindexForecastDays(json) {
    const days = json?.forecast?.forecastday;
    if (!Array.isArray(days) || days.length === 0)
        return json;
    const fetchDate = String(json?.current?.last_updated_hour || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchDate))
        return json;
    const today = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const nowDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    if (fetchDate >= nowDate)
        return json;
    // Snapshots cached before entries carried a date fall back to the first hour, whose
    // timestamp is the same local day. Without this they would all filter out and the
    // restored widget would lose its whole forecast.
    const dateOfEntry = entry => {
        const explicit = String(entry?.date || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(explicit))
            return explicit;
        const firstHour = entry?.hour?.[0]?.time_str;
        const fromHour = String(firstHour || '').slice(0, ISO_DATE_KEY_LENGTH);
        return /^\d{4}-\d{2}-\d{2}$/.test(fromHour) ? fromHour : '';
    };
    const kept = days.filter(entry => {
        const date = dateOfEntry(entry);
        return date !== '' && date >= nowDate;
    });
    if (kept.length === days.length)
        return json;
    return { ...json, forecast: { ...json.forecast, forecastday: kept } };
}

/** Stores a successful fetch as the widget's last good weather, tagged with its location. */
export function cacheWeatherSnapshot(widgetData, latitude, longitude, name, json) {
    if (!widgetData?.id || !json)
        return;
    saveLastGoodCache('weather', widgetData.id, { lat: latitude, lon: longitude, name, json });
}

/**
 * Offers a stored snapshot to apply. The callback does not run when there is nothing
 * usable, so the widget keeps whatever it already has on screen.
 */
export function restoreWeatherSnapshot(widgetData, apply) {
    if (!widgetData?.id)
        return;
    loadLastGoodCache('weather', widgetData.id, (payload, savedAtMs) => {
        if (!payload || !payload.json || !snapshotMatchesWidget(payload, widgetData))
            return;
        apply(reindexForecastDays(refreshSnapshotText(payload.json)), savedAtMs);
    }, WEATHER_CACHE_MAX_AGE_MS);
}

/**
 * Repairs the labels a snapshot written before they followed is_day.
 *
 * Such a snapshot has "Sunny" frozen in, and nothing else recomputes it, so the widget
 * would read Sunny beside a moon until a fetch replaced the file. Only the two clear-sky
 * labels are corrected, by matching on the stored text: the stored `code` is in
 * weatherapi's numbering while the text helper switches on WMO, so it cannot be re-derived
 * from the code alone.
 */
function refreshSnapshotText(json) {
    // is_day arrives as 0 or 1, so it is compared numerically: 0 === false is not true
    // in JS, and a strict check against a boolean would skip every night payload.
    const repair = (condition, isDay) => {
        if (!condition || (isDay !== 0 && isDay !== false))
            return;
        if (condition.text === 'Sunny')
            condition.text = 'Clear';
        else if (condition.text === 'Mainly Clear')
            condition.text = 'Mostly Clear';
    };

    repair(json.current?.condition, json.current?.is_day);
    for (const day of json.forecast?.forecastday || []) {
        for (const hour of day.hour || [])
            repair(hour.condition, hour.is_day);
    }
    return json;
}


async function fetchOpenMeteoWeather({ latitude, longitude, name }, context) {
    const { widgetNode } = context;
    if (isActorDestroyed(widgetNode) || !widgetNode.weatherSession) return;

    try {
        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?'
            + `latitude=${latitude}&longitude=${longitude}`
            + '&current_weather=true'
            + `&forecast_days=${OPEN_METEO_FORECAST_DAYS}`
            + '&hourly=temperature_2m,weathercode,is_day'
            + '&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto';
        const weatherJson = await fetchJsonAsync(widgetNode.weatherSession, weatherUrl);
        if (isActorDestroyed(widgetNode))
            return;
        // A 200 says the request succeeded, not that the body holds a reading, and a body
        // without one left the widget on its placeholders with nothing in the journal to
        // tell that apart from still loading.
        if (!weatherJson.current_weather) {
            console.error(`Error fetching Open-Meteo weather: response for ${name} had no current conditions`);
            context.markFetchFailed?.();
            return;
        }
        const payload = buildOpenMeteoPayload(weatherJson, name);
        // Nothing to show and nothing worth keeping: the seeded placeholders stay up and
        // the previous snapshot is left alone rather than overwritten with this answer.
        if (!payload) {
            console.error('Error fetching Open-Meteo fallback: response had no current temperature');
            context.markFetchFailed?.();
            return;
        }
        // Marked before painting, not after, so a snapshot read that is still in flight
        // cannot land on top of this and stamp live data with an age.
        if (context.markLiveReading)
            context.markLiveReading();
        context.snapshotAgeText = '';
        updateWeatherUi(payload, context);
        cacheWeatherSnapshot(context.widgetData, latitude, longitude, name, payload);
    } catch (error) {
        if (isCancelledError(error)) return;
        console.error('Error fetching Open-Meteo fallback:', error);
        // A cancelled request is the periodic reload superseding its own predecessor, so
        // it is not a failure; anything else leaves the archive as the only honest source.
        context.markFetchFailed?.();
    }
}

export function fetchWeatherViaOpenMeteo(context) {
    const { widgetData, widgetNode } = context;
    if (isActorDestroyed(widgetNode)) return;
    const location = widgetData.location;

    if (!widgetNode.weatherSession) {
        widgetNode.weatherSession = new Soup.Session({ timeout: WEATHER_REQUEST_TIMEOUT_SECONDS });
    }

    const hasSavedCoordinates = Number.isFinite(widgetData.lat)
        && Number.isFinite(widgetData.lon)
        && Math.abs(widgetData.lat) <= 90
        && Math.abs(widgetData.lon) <= 180;
    if (hasSavedCoordinates) {
        fetchOpenMeteoWeather({ latitude: widgetData.lat, longitude: widgetData.lon, name: location }, context);
        return;
    }

    fetchOpenMeteoFallback(location, context);
}

// Aborts the widget's weather session; pairs with the session created above.
export function releaseWeatherSession(widgetNode) {
    if (widgetNode.weatherSession) {
        widgetNode.weatherSession.abort();
        widgetNode.weatherSession = null;
    }
}
