import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import {
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    DEFAULT_BG_COLOR,
    buildBaseWidgetStyle,
    celsiusToFahrenheit,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';
import { scaleFontSize, TEXT_OPACITY } from '../../utils/typography.js';

export const REFRESH_INTERVAL_SECONDS = 1800;

export const HTTP_STATUS_OK = 200;

export const HOURLY_FORECAST_COUNT = 6;

const DEFAULT_WEATHER_BORDER_RADIUS_PX = 24;
export const WEATHER_METADATA_OPACITY = TEXT_OPACITY.metadata;
export const WEATHER_SUBTLE_OPACITY = TEXT_OPACITY.subtle;

const FORECAST_MIN_GRID_WIDTH = 6;
const SIMPLE_MIN_GRID_WIDTH = 4;
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

const decoder = new TextDecoder('utf-8');

const MILLISECONDS_PER_SECOND = 1000;
const OPEN_METEO_FORECAST_DAYS = 2;
const ISO_DATE_KEY_LENGTH = 10;
const ISO_HOUR_KEY_LENGTH = 13;
const LAYOUT_PADDING_PX = 12;

// In-session cache of geocode coords keyed by location name.
const GEOCODE_CACHE = new Map();
const GEOCODE_CACHE_LIMIT = 32;

function formatHourLabel(hourData) {
    const timestampSeconds = Number.isFinite(hourData.time_epoch)
        ? hourData.time_epoch
        : Date.parse(hourData.time_str) / 1000;
    if (!Number.isFinite(timestampSeconds))
        return '--';
    return new Date(timestampSeconds * 1000).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
    });
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
const WEATHER_CODE_FOG_GROUP = [1030, 1039, 1042, 1135, 1147];
const WEATHER_CODE_DUST_GROUP = [1015, 1018, 1021, 1024, 1027, 1033, 1036, 1045, 1048];
const WEATHER_CODE_SLEET_GROUP = [1198, 1201];
const WEATHER_CODE_HAIL_GROUP = [1237, 1261, 1264];
const WEATHER_CODE_RAIN_GROUP = [1063, 1072, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195];
const WEATHER_CODE_THUNDERSTORMS_GROUP = [1087, 1273, 1276, 1279, 1282];
const WEATHER_CODE_SNOW_BLIZZARD = 1117;
const WEATHER_CODE_SNOW_GROUP = [1066, 1114, 1210, 1213, 1219, 1222, 1225];

// Resolves code or text description to a standard WeatherAPI condition code.
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

// Keeps a child actor the same size as its widget node. The signal ids are
// stored on the actor so the caller can disconnect them on teardown.
function trackWidgetSize(actor, widgetNode) {
    actor.backgroundSignalIds = [
        widgetNode.connect('notify::width', () => {
            if (!isActorDestroyed(actor))
                actor.set_width(resolveSaneExtent(widgetNode.width));
        }),
        widgetNode.connect('notify::height', () => {
            if (!isActorDestroyed(actor))
                actor.set_height(resolveSaneExtent(widgetNode.height));
        }),
    ];
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
    const executablePath = GLib.find_program_in_path('gnome-weather');
    if (!executablePath) return '';

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
    return `${installationDirectory}/share/icons/hicolor/scalable/status`;
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

    iconActor.gicon = Gio.ThemedIcon.new(iconNames);
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

    const currentHourStr = json.current ? json.current.last_updated_hour : null;
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

function updateTextLabels(json, uiElements, useFahrenheit) {
    const current = json.current;
    if (!current) return;

    const forecast = (json.forecast && json.forecast.forecastday && json.forecast.forecastday[0]) ? json.forecast.forecastday[0].day : null;
    const unit = useFahrenheit ? '°F' : '°C';
    const highLabel = 'H';
    const lowLabel = 'L';

    const currentTemp = useFahrenheit ? current.temp_f : current.temp_c;
    if (uiElements.tempLabel) uiElements.tempLabel.text = `${Math.round(currentTemp)}${unit}`;
    if (uiElements.conditionLabel && current.condition) uiElements.conditionLabel.text = current.condition.text;
    if (json.location && json.location.name && uiElements.cityLabel) uiElements.cityLabel.text = json.location.name;

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
        const borderRadius = widgetData.appliedBorderRadius ??
            widgetData.borderRadius ??
            DEFAULT_WEATHER_BORDER_RADIUS_PX;
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

function updateWeatherUi(json, context) {
    const { widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath } = context;
    if (isActorDestroyed(widgetNode) || !json || !json.current) return;

    const useFahrenheit = widgetData.useFahrenheit !== undefined ? widgetData.useFahrenheit : (widgetData.globalUseFahrenheit === true);
    const isDay = json.current.is_day !== undefined ? (json.current.is_day === 1 || json.current.is_day === true) : true;
    const condCode = resolveConditionCode(json.current.condition ? json.current.condition.code : null, json.current.condition ? json.current.condition.text : '');
    const folderName = getAssetSizeForWidget(widgetData);
    const assets = getWeatherAssets(extensionPath, condCode, isDay, folderName, json.current.condition ? json.current.condition.text : '');

    updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage);
    updateTextLabels(json, uiElements, useFahrenheit);

    if (uiElements.conditionIcon) {
        setWeatherIcon(uiElements.conditionIcon, assets.iconName);
    }

    updateHourlyForecastUi(json, uiElements, json.current.last_updated_epoch, extensionPath, useFahrenheit, folderName);
}

function getWmoConditionText(code) {
    switch (code) {
        case 0: return 'Sunny';
        case 1: return 'Mainly Clear';
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

function fetchJsonAsync(session, url) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sessionObject, result) => {
            try {
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

        if (isActorDestroyed(widgetNode) || !geoJson.results || geoJson.results.length === 0) return;
        const { latitude, longitude, name } = geoJson.results[0];
        cacheBounded(GEOCODE_CACHE, GEOCODE_CACHE_LIMIT, locationName, { latitude, longitude, name });

        await fetchOpenMeteoWeather({ latitude, longitude, name }, context);
    } catch (error) {
        if (error instanceof Gio.IOErrorEnum && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
        console.error('Error fetching Open-Meteo fallback:', error);
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
        const weatherCode = hourlyData.weathercode?.[timeIndex] ?? currentCode;
        const isDay = hourlyData.is_day?.[timeIndex] ?? weatherJson.current_weather.is_day;
        const temperatureCelsius = hourlyData.temperature_2m[timeIndex];
        const dateKey = timeString.slice(0, ISO_DATE_KEY_LENGTH);
        const hourEntry = {
            time_epoch: Math.floor(Date.parse(timeString) / MILLISECONDS_PER_SECOND),
            time_str: timeString,
            temp_c: temperatureCelsius,
            temp_f: celsiusToFahrenheit(temperatureCelsius),
            is_day: isDay === 1 || isDay === true,
            condition: {
                code: wmoToWeatherApiCode(weatherCode),
                text: getWmoConditionText(weatherCode),
            },
        };
        const dayEntries = hourlyGroups.get(dateKey) || [];
        dayEntries.push(hourEntry);
        hourlyGroups.set(dateKey, dayEntries);
    });
    return hourlyGroups;
}

function buildOpenMeteoDailyForecasts(weatherJson, hourlyGroups) {
    return [...hourlyGroups.entries()].map(([dateKey, hourEntries], dayIndex) => {
        let highTemperature = weatherJson.current_weather.temperature;
        let lowTemperature = weatherJson.current_weather.temperature;
        if (weatherJson.daily?.temperature_2m_max?.[dayIndex] !== undefined) {
            highTemperature = weatherJson.daily.temperature_2m_max[dayIndex];
            lowTemperature = weatherJson.daily.temperature_2m_min[dayIndex];
        }
        return {
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
    const nowLocation = new Date(nowLocationMs);
    const padNumber = (value) => String(value).padStart(2, '0');
    const currentHour = `${nowLocation.getUTCFullYear()}-${padNumber(nowLocation.getUTCMonth() + 1)}-${padNumber(nowLocation.getUTCDate())}T${padNumber(nowLocation.getUTCHours())}`;
    const hourlyGroups = buildOpenMeteoHourlyGroups(weatherJson, currentCode);
    return {
        location: { name: locationName },
        current: {
            temp_c: currentWeather.temperature,
            temp_f: celsiusToFahrenheit(currentWeather.temperature),
            is_day: currentWeather.is_day,
            last_updated_epoch: Math.floor(nowLocationMs / MILLISECONDS_PER_SECOND),
            last_updated_hour: currentHour,
            condition: {
                code: wmoToWeatherApiCode(currentCode),
                text: getWmoConditionText(currentCode),
            },
        },
        forecast: {
            forecastday: buildOpenMeteoDailyForecasts(weatherJson, hourlyGroups),
        },
    };
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
        if (isActorDestroyed(widgetNode) || !weatherJson.current_weather) return;
        updateWeatherUi(buildOpenMeteoPayload(weatherJson, name), context);
    } catch (error) {
        if (error instanceof Gio.IOErrorEnum && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
        console.error('Error fetching Open-Meteo fallback:', error);
    }
}

export function fetchWeatherViaOpenMeteo(context) {
    const { widgetData, widgetNode } = context;
    if (isActorDestroyed(widgetNode)) return;
    const location = widgetData.location;

    if (!widgetNode.weatherSession) {
        widgetNode.weatherSession = new Soup.Session();
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
