/**
 * ============================================================================
 * WEATHER COMMON UTILITIES & DATA FETCHING
 * 
 * Provides condition code normalization, asset mapping, Open-Meteo fallback API integration,
 * WeatherAPI fetching, and common UI update utilities for weather widgets.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetFontFamily, DEFAULT_BG_COLOR, buildBaseWidgetStyle, celsiusToFahrenheit } from '../../utils/widgetUtils.js';

/** Refresh interval in seconds (30 minutes) */
export const REFRESH_INTERVAL_SECONDS = 1800;

/** Default fallback location */
export const FALLBACK_LOCATION = 'London';

/** HTTP response status OK */
export const HTTP_STATUS_OK = 200;

/** Hourly forecast items count */
export const HOURLY_FORECAST_COUNT = 6;

/** Default layout metrics */
export const DEFAULT_WEATHER_BORDER_RADIUS_PX = 24;

/**
 * Pango layout constants — GJS doesn't re-export these as named enums,
 * so we define them to avoid magic numbers in label configuration.
 */
export const PANGO_WRAP_WORD_CHAR = 2;
export const PANGO_ELLIPSIZE_NONE = 0;
export const PANGO_ALIGN_LEFT = 0;
export const PANGO_ALIGN_CENTER = 1;
export const PANGO_ALIGN_RIGHT = 2;

/** Days and Months Name Tables */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Configures an St.Label's clutter_text for multi-line wrapping with no ellipsization. */
export function configureWrappingLabel(label, alignment = PANGO_ALIGN_LEFT) {
    label.clutter_text.single_line_mode = false;
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = PANGO_WRAP_WORD_CHAR;
    label.clutter_text.ellipsize = PANGO_ELLIPSIZE_NONE;
    label.clutter_text.set_line_alignment(alignment);
}

/** Weather Condition Codes */
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

/** Resolves code or text description to a standard WeatherAPI condition code. */
export function resolveConditionCode(code, text = '') {
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

/** Gets weather icon path, background gradient colors, and background image path. */
export function getWeatherAssets(extensionPath, code, isDay, folderName = '3x3', text = '') {
    const effectiveCode = resolveConditionCode(code, text);
    const timeOfDay = isDay ? 'day' : 'night';

    const assets = {
        iconPath: `${extensionPath}/assets/weather/icons/wi_clear-${timeOfDay}.svg`,
        bgStart: DEFAULT_BG_COLOR,
        bgEnd: '#0b1a26',
        bgImagePath: '',
    };

    const getImgPath = (name) => `${extensionPath}/assets/weather/${folderName}/${name}-${timeOfDay}.png`;
    const getIconPath = (name) => `${extensionPath}/assets/weather/icons/wi_${name}.svg`;

    if (effectiveCode === WEATHER_CODE_CLEAR) {
        assets.iconPath = isDay ? getIconPath('clear-day') : getIconPath('clear-night');
        assets.bgStart = isDay ? '#2b84d4' : '#121e33';
        assets.bgEnd = isDay ? '#19568f' : '#080d17';
        assets.bgImagePath = getImgPath('clear');
    } else if (effectiveCode === WEATHER_CODE_PARTLY_CLOUDY) {
        assets.iconPath = isDay ? getIconPath('partly-cloudy-day') : getIconPath('partly-cloudy-night');
        assets.bgStart = isDay ? '#5b8cbd' : '#25354a';
        assets.bgEnd = isDay ? '#335e87' : '#101a29';
        assets.bgImagePath = getImgPath('partly-cloudy');
    } else if (effectiveCode === WEATHER_CODE_CLOUDY_1 || effectiveCode === WEATHER_CODE_CLOUDY_2) {
        assets.iconPath = getIconPath('cloudy');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#4E5A67' : '#2b3338';
        assets.bgImagePath = getImgPath('cloudy');
    } else if (WEATHER_CODE_FOG_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('fog');
        assets.bgStart = isDay ? '#a1aba3' : '#3c403e';
        assets.bgEnd = isDay ? '#848a85' : '#1e211f';
        assets.bgImagePath = getImgPath('fog');
    } else if (WEATHER_CODE_DUST_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('dust');
        assets.bgStart = isDay ? '#c2a884' : '#4a3d2c';
        assets.bgEnd = isDay ? '#947a57' : '#2b2318';
        assets.bgImagePath = getImgPath('sandstorm');
    } else if (WEATHER_CODE_SLEET_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('sleet');
        assets.bgStart = isDay ? '#5a8f9c' : '#1d343b';
        assets.bgEnd = isDay ? '#35636e' : '#0a161a';
        assets.bgImagePath = getImgPath('freezing-rain');
    } else if (WEATHER_CODE_HAIL_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('hail');
        assets.bgStart = isDay ? '#7b8c9c' : '#212a33';
        assets.bgEnd = isDay ? '#546373' : '#0d131a';
        assets.bgImagePath = getImgPath('hail');
    } else if (WEATHER_CODE_RAIN_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('rain');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#4E5A67' : '#2b3338';
        assets.bgImagePath = getImgPath('rain');
    } else if (WEATHER_CODE_THUNDERSTORMS_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('thunderstorms');
        assets.bgStart = '#232533';
        assets.bgEnd = '#0b0c12';
        assets.bgImagePath = getImgPath('storm');
    } else if (effectiveCode === WEATHER_CODE_SNOW_BLIZZARD) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#b8d6eb' : '#465661';
        assets.bgEnd = isDay ? '#8db2cf' : '#212d36';
        assets.bgImagePath = getImgPath('blizzard');
    } else if (WEATHER_CODE_SNOW_GROUP.includes(effectiveCode)) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#8dafc4' : '#243a4a';
        assets.bgEnd = isDay ? '#68899c' : '#12202b';
        assets.bgImagePath = getImgPath('snow');
    }

    if (!GLib.file_test(assets.iconPath, GLib.FileTest.EXISTS)) {
        assets.iconPath = `${extensionPath}/assets/weather/icons/wi_clear-${timeOfDay}.svg`;
    }

    if (assets.bgImagePath && !GLib.file_test(assets.bgImagePath, GLib.FileTest.EXISTS))
        assets.bgImagePath = '';

    return assets;
}

/** Creates background image actor for weather widget container. */
export function createBackgroundImageActor(widgetNode, widgetData) {
    const borderWidth = widgetData.appliedBorderWidth || 0;
    const bgImageActor = new St.Widget({
        style: '',
        x: borderWidth,
        y: borderWidth,
        width: widgetNode.width - borderWidth * 2,
        height: widgetNode.height - borderWidth * 2,
    });

    widgetNode.connect('notify::width', () => bgImageActor.set_width(Math.max(0, widgetNode.width - borderWidth * 2)));
    widgetNode.connect('notify::height', () => bgImageActor.set_height(Math.max(0, widgetNode.height - borderWidth * 2)));

    return bgImageActor;
}

/** Creates main layout container box for weather content. */
export function createMainLayout(widgetNode, widgetData) {
    const borderWidth = widgetData.appliedBorderWidth || 0;

    const layout = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
        x: borderWidth,
        y: borderWidth,
        width: widgetNode.width - borderWidth * 2,
        height: widgetNode.height - borderWidth * 2,
    });

    widgetNode.connect('notify::width', () => layout.set_width(Math.max(0, widgetNode.width - borderWidth * 2)));
    widgetNode.connect('notify::height', () => layout.set_height(Math.max(0, widgetNode.height - borderWidth * 2)));

    return layout;
}

/** Creates fallback GIcon pointing to default clear day icon. */
export function createFallbackIcon(extensionPath) {
    return new Gio.FileIcon({
        file: Gio.File.new_for_path(`${extensionPath}/assets/weather/icons/wi_clear-day.svg`),
    });
}

/** Resolves asset size folder name based on widget width grid size. */
export function getAssetSizeForWidget(widgetData) {
    const isForecast = widgetData.width === 6;
    const isSimple = widgetData.width === 4;
    return (isForecast || isSimple) ? '4x6' : '3x3';
}

/** Updates hourly forecast UI actors with parsed forecast day hours. */
export function updateHourlyForecastUi(json, uiElements, currentEpoch, extensionPath, useFahrenheit) {
    if (!uiElements.hourlyActors || uiElements.hourlyActors.length === 0 || !json.forecast || !json.forecast.forecastday)
        return;

    let allHours = [];
    if (json.forecast.forecastday.length > 0 && json.forecast.forecastday[0].hour)
        allHours = allHours.concat(json.forecast.forecastday[0].hour);
    if (json.forecast.forecastday.length > 1 && json.forecast.forecastday[1].hour)
        allHours = allHours.concat(json.forecast.forecastday[1].hour);

    const refEpoch = currentEpoch || Math.floor(Date.now() / 1000);
    let futureHours = allHours.filter(h => h.time_epoch > refEpoch);

    if (futureHours.length < HOURLY_FORECAST_COUNT && allHours.length >= HOURLY_FORECAST_COUNT) {
        futureHours = allHours.slice(0, HOURLY_FORECAST_COUNT);
    }

    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        if (futureHours[i] && uiElements.hourlyActors[i]) {
            const hourData = futureHours[i];
            const date = new Date(hourData.time_epoch * 1000);
            let hours = date.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;

            const temp = useFahrenheit ? hourData.temp_f : hourData.temp_c;
            uiElements.hourlyActors[i].timeLbl.text = `${hours} ${ampm}`;
            uiElements.hourlyActors[i].tempLbl.text = `${Math.round(temp)}°`;

            const condCode = resolveConditionCode(hourData.condition ? hourData.condition.code : null, hourData.condition ? hourData.condition.text : '');
            const isDay = hourData.is_day !== undefined ? (hourData.is_day === 1 || hourData.is_day === true) : true;
            const hourlyAssets = getWeatherAssets(extensionPath, condCode, isDay, '3x3', hourData.condition ? hourData.condition.text : '');
            uiElements.hourlyActors[i].icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(hourlyAssets.iconPath) });
        }
    }
}

/** Updates primary text labels (temp, condition, city, high/low, date). */
export function updateTextLabels(json, uiElements, useFahrenheit) {
    const current = json.current;
    if (!current) return;

    const forecast = (json.forecast && json.forecast.forecastday && json.forecast.forecastday[0]) ? json.forecast.forecastday[0].day : null;
    const unit = useFahrenheit ? '°F' : '°C';

    const currentTemp = useFahrenheit ? current.temp_f : current.temp_c;
    if (uiElements.tempLabel) uiElements.tempLabel.text = `${Math.round(currentTemp)}${unit}`;
    if (uiElements.conditionLabel && current.condition) uiElements.conditionLabel.text = current.condition.text;
    if (json.location && json.location.name && uiElements.cityLabel) uiElements.cityLabel.text = json.location.name;

    if (forecast) {
        const highTemp = useFahrenheit ? forecast.maxtemp_f : forecast.maxtemp_c;
        const lowTemp = useFahrenheit ? forecast.mintemp_f : forecast.mintemp_c;
        if (uiElements.highLowLabel) uiElements.highLowLabel.text = `H:${Math.round(highTemp)}${unit} L:${Math.round(lowTemp)}${unit}`;
    }

    if (uiElements.dateLabel) {
        const epoch = current.last_updated_epoch ? current.last_updated_epoch * 1000 : Date.now();
        const date = new Date(epoch);
        uiElements.dateLabel.text = `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
    }
}

/** Updates container style and background image actor. */
export function updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage) {
    const fontFamily = resolveWidgetFontFamily(widgetData);
    const baseStyle = buildBaseWidgetStyle(widgetData);

    if (isDynamicColor) {
        widgetNode.style = `
            background-gradient-direction: vertical;
            background-gradient-start: ${assets.bgStart};
            background-gradient-end: ${assets.bgEnd};
            color: white;
            font-family: ${fontFamily};
            ${baseStyle}
        `;
    } else {
        const bgColor = resolveWidgetBackgroundColor(widgetData);
        const textColor = resolveWidgetForegroundColor(widgetData);
        widgetNode.style = `
            background-color: ${bgColor};
            color: ${textColor};
            font-family: ${fontFamily};
            ${baseStyle}
        `;
    }

    if (isDynamicImage && assets.bgImagePath) {
        const borderRadius = widgetData.borderRadius !== undefined ? widgetData.borderRadius : DEFAULT_WEATHER_BORDER_RADIUS_PX;
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

/** Updates overall weather UI with JSON payload. */
export function updateWeatherUi(json, context) {
    const { widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath } = context;
    if (widgetNode.isDestroyed || !json || !json.current) return;

    const useFahrenheit = widgetData.useFahrenheit !== undefined ? widgetData.useFahrenheit : (widgetData.globalUseFahrenheit === true);
    const isDay = json.current.is_day !== undefined ? (json.current.is_day === 1 || json.current.is_day === true) : true;
    const condCode = resolveConditionCode(json.current.condition ? json.current.condition.code : null, json.current.condition ? json.current.condition.text : '');
    const folderName = getAssetSizeForWidget(widgetData);
    const assets = getWeatherAssets(extensionPath, condCode, isDay, folderName, json.current.condition ? json.current.condition.text : '');

    updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage);
    updateTextLabels(json, uiElements, useFahrenheit);

    if (uiElements.conditionIcon) {
        uiElements.conditionIcon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(assets.iconPath) });
    }

    updateHourlyForecastUi(json, uiElements, json.current.last_updated_epoch, extensionPath, useFahrenheit);
}

/** Maps WMO weather code to condition description. */
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

/** Maps WMO weather code to WeatherAPI condition code equivalent. */
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

/** Performs async HTTP GET request returning parsed JSON payload. */
function fetchJsonAsync(session, url) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', url);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                if (message.get_status() !== HTTP_STATUS_OK) {
                    reject(new Error(`HTTP ${message.get_status()}`));
                    return;
                }
                const bytes = s.send_and_read_finish(res);
                const decoder = new TextDecoder('utf-8');
                resolve(JSON.parse(decoder.decode(bytes.get_data())));
            } catch (err) {
                reject(err);
            }
        });
    });
}

/** Fetches Open-Meteo free API fallback data when WeatherAPI key is missing or fails. */
export async function fetchOpenMeteoFallback(locationName, context) {
    const { widgetNode } = context;
    if (widgetNode.isDestroyed || !widgetNode.weatherSession) return;

    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=en&format=json`;
        const geoJson = await fetchJsonAsync(widgetNode.weatherSession, geoUrl);

        if (widgetNode.isDestroyed || !geoJson.results || geoJson.results.length === 0) return;
        const { latitude, longitude, name } = geoJson.results[0];

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`;
        const wJson = await fetchJsonAsync(widgetNode.weatherSession, weatherUrl);

        if (widgetNode.isDestroyed || !wJson.current_weather) return;

        const currentCode = wJson.current_weather.weathercode;
        const mappedCode = wmoToWeatherApiCode(currentCode);
        const conditionText = getWmoConditionText(currentCode);

        let dailyHigh = wJson.current_weather.temperature;
        let dailyLow = wJson.current_weather.temperature;
        if (wJson.daily && wJson.daily.temperature_2m_max && wJson.daily.temperature_2m_max.length > 0) {
            dailyHigh = wJson.daily.temperature_2m_max[0];
            dailyLow = wJson.daily.temperature_2m_min[0];
        }

        let hourlyList = [];
        if (wJson.hourly && wJson.hourly.time && wJson.hourly.temperature_2m) {
            const isDayBool = wJson.current_weather.is_day === 1 || wJson.current_weather.is_day === true;
            hourlyList = wJson.hourly.time.map((timeStr, i) => {
                const code = (wJson.hourly.weathercode && wJson.hourly.weathercode[i] !== undefined) ? wJson.hourly.weathercode[i] : currentCode;
                return {
                    time_epoch: Math.floor(new Date(timeStr).getTime() / 1000),
                    temp_c: wJson.hourly.temperature_2m[i],
                    temp_f: celsiusToFahrenheit(wJson.hourly.temperature_2m[i]),
                    is_day: isDayBool,
                    condition: {
                        code: wmoToWeatherApiCode(code),
                        text: getWmoConditionText(code),
                    },
                };
            });
        }

        const mapped = {
            location: { name },
            current: {
                temp_c: wJson.current_weather.temperature,
                temp_f: celsiusToFahrenheit(wJson.current_weather.temperature),
                is_day: wJson.current_weather.is_day,
                last_updated_epoch: Math.floor(Date.now() / 1000),
                condition: { code: mappedCode, text: conditionText },
            },
            forecast: {
                forecastday: [{
                    day: {
                        maxtemp_c: dailyHigh,
                        maxtemp_f: celsiusToFahrenheit(dailyHigh),
                        mintemp_c: dailyLow,
                        mintemp_f: celsiusToFahrenheit(dailyLow),
                    },
                    hour: hourlyList,
                }],
            },
        };

        updateWeatherUi(mapped, context);
    } catch (e) {
        console.error('Error fetching Open-Meteo fallback:', e);
    }
}

/** Triggers async weather fetch for target location using Open-Meteo API. */
export function fetchWeatherData(context) {
    const { widgetData, widgetNode } = context;
    if (widgetNode.isDestroyed) return;
    const location = widgetData.location || widgetData.globalWeatherCity || FALLBACK_LOCATION;

    if (!widgetNode.weatherSession) {
        widgetNode.weatherSession = new Soup.Session();
    }

    fetchOpenMeteoFallback(location, context);
}
