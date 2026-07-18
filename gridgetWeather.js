/**
 * ============================================================================
 * WEATHER FORECAST WIDGET 
 * 
 * This module fetches and displays current weather conditions and hourly forecasts.
 * It supports multiple layouts (simple, standard, forecast) and parses data
 * from external weather APIs, dynamically adapting the UI to the time of day.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, DEFAULT_BG_COLORS, buildBaseWidgetStyle, DEFAULT_FONT_FAMILY } from './widgetUtils.js';
import { createWidgetContainer, connectTimerCleanup } from './widgetUIUtils.js';



const REFRESH_INTERVAL_SECONDS = 1800;
const FALLBACK_LOCATION = 'London';
const HTTP_STATUS_OK = 200;
const HOURLY_FORECAST_COUNT = 6;

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

//  Asset resolution 
function getWeatherAssets(extensionPath, code, isDay, folderName = '3x3') {
    const timeOfDay = isDay ? 'day' : 'night';

    let assets = {
        iconPath: `${extensionPath}/assets/weather/icons/wi_not-available.svg`,
        bgStart: DEFAULT_BG_COLORS['weather'],
        bgEnd: '#0b1a26',
        bgImagePath: '',
    };

    const getImgPath = (name) => `${extensionPath}/assets/weather/${folderName}/${name}-${timeOfDay}.png`;
    const getIconPath = (name) => `${extensionPath}/assets/weather/icons/wi_${name}.svg`;

    // Map WeatherAPI.com condition codes to local assets and color gradients
    if (code === WEATHER_CODE_CLEAR) {
        assets.iconPath = isDay ? getIconPath('clear-day') : getIconPath('clear-night');
        assets.bgStart = isDay ? '#2b84d4' : '#121e33';
        assets.bgEnd = isDay ? '#19568f' : '#080d17';
        assets.bgImagePath = getImgPath('clear');
    } else if (code === WEATHER_CODE_PARTLY_CLOUDY) {
        assets.iconPath = isDay ? getIconPath('partly-cloudy-day') : getIconPath('partly-cloudy-night');
        assets.bgStart = isDay ? '#5b8cbd' : '#25354a';
        assets.bgEnd = isDay ? '#335e87' : '#101a29';
        assets.bgImagePath = getImgPath('partly-cloudy');
    } else if (code === WEATHER_CODE_CLOUDY_1 || code === WEATHER_CODE_CLOUDY_2) {
        assets.iconPath = getIconPath('cloudy');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#4E5A67' : '#2b3338';
        assets.bgImagePath = getImgPath('cloudy');
    } else if (WEATHER_CODE_FOG_GROUP.includes(code)) {
        assets.iconPath = getIconPath('fog');
        assets.bgStart = isDay ? '#a1aba3' : '#3c403e';
        assets.bgEnd = isDay ? '#848a85' : '#1e211f';
        assets.bgImagePath = getImgPath('fog');
    } else if (WEATHER_CODE_DUST_GROUP.includes(code)) {
        assets.iconPath = getIconPath('dust');
        assets.bgStart = isDay ? '#c2a884' : '#4a3d2c';
        assets.bgEnd = isDay ? '#947a57' : '#2b2318';
        assets.bgImagePath = getImgPath('sandstorm');
    } else if (WEATHER_CODE_SLEET_GROUP.includes(code)) {
        assets.iconPath = getIconPath('sleet');
        assets.bgStart = isDay ? '#5a8f9c' : '#1d343b';
        assets.bgEnd = isDay ? '#35636e' : '#0a161a';
        assets.bgImagePath = getImgPath('freezing-rain');
    } else if (WEATHER_CODE_HAIL_GROUP.includes(code)) {
        assets.iconPath = getIconPath('hail');
        assets.bgStart = isDay ? '#7b8c9c' : '#212a33';
        assets.bgEnd = isDay ? '#546373' : '#0d131a';
        assets.bgImagePath = getImgPath('hail');
    } else if (WEATHER_CODE_RAIN_GROUP.includes(code)) {
        assets.iconPath = getIconPath('rain');
        assets.bgStart = isDay ? '#121D2B' : '#14181a';
        assets.bgEnd = isDay ? '#4E5A67' : '#2b3338';
        assets.bgImagePath = getImgPath('rain');
    } else if (WEATHER_CODE_THUNDERSTORMS_GROUP.includes(code)) {
        assets.iconPath = getIconPath('thunderstorms');
        assets.bgStart = '#232533';
        assets.bgEnd = '#0b0c12';
        assets.bgImagePath = getImgPath('storm');
    } else if (code === WEATHER_CODE_SNOW_BLIZZARD) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#b8d6eb' : '#465661';
        assets.bgEnd = isDay ? '#8db2cf' : '#212d36';
        assets.bgImagePath = getImgPath('blizzard');
    } else if (WEATHER_CODE_SNOW_GROUP.includes(code)) {
        assets.iconPath = getIconPath('snow');
        assets.bgStart = isDay ? '#8dafc4' : '#243a4a';
        assets.bgEnd = isDay ? '#68899c' : '#12202b';
        assets.bgImagePath = getImgPath('snow');
    }

    if (assets.bgImagePath && !GLib.file_test(assets.bgImagePath, GLib.FileTest.EXISTS))
        assets.bgImagePath = '';

    return assets;
}

//  Widget construction 

// buildBaseWidget removed
function createBackgroundImageActor(widgetNode, widgetData) {
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

function createMainLayout(widgetNode, widgetData) {
    const borderWidth = widgetData.appliedBorderWidth || 0;
    const contentScale = widgetData.contentScale !== undefined ? widgetData.contentScale : 1.0;

    const layout = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: 'padding: 16px;',
        x: borderWidth,
        y: borderWidth,
        width: widgetNode.width - borderWidth * 2,
        height: widgetNode.height - borderWidth * 2,
    });

    // Apply content scale and set pivot to center
    layout.set_scale(contentScale, contentScale);
    layout.set_pivot_point(0.5, 0.5);

    widgetNode.connect('notify::width', () => layout.set_width(Math.max(0, widgetNode.width - borderWidth * 2)));
    widgetNode.connect('notify::height', () => layout.set_height(Math.max(0, widgetNode.height - borderWidth * 2)));

    return layout;
}

//  Layout variants 

function createFallbackIcon(extensionPath) {
    return new Gio.FileIcon({
        file: Gio.File.new_for_path(`${extensionPath}/assets/weather/icons/wi_not-available.svg`),
    });
}

function buildForecastLayout(layout, widgetData, extensionPath) {
    const uiElements = { hourlyActors: [] };

    const topLayout = new St.BoxLayout({ vertical: false, x_expand: true, y_expand: true });
    const leftLayout = new St.BoxLayout({ vertical: true, x_expand: true });
    uiElements.cityLabel = new St.Label({ text: widgetData.location || FALLBACK_LOCATION, style: 'font-weight: bold; font-size: 16px; margin-bottom: 4px;' });
    uiElements.tempLabel = new St.Label({ text: '--°', style: 'font-size: 52px; font-weight: 300;' });
    leftLayout.add_child(uiElements.cityLabel);
    leftLayout.add_child(uiElements.tempLabel);
    topLayout.add_child(leftLayout);

    const rightLayout = new St.BoxLayout({ vertical: true });
    const iconWrapper = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.END, x_expand: true });
    uiElements.conditionIcon = new St.Icon({ gicon: createFallbackIcon(extensionPath), icon_size: 38, style: 'margin-bottom: 8px;' });
    iconWrapper.add_child(uiElements.conditionIcon);

    uiElements.conditionLabel = new St.Label({ text: 'Loading...', style: 'font-size: 12px; font-weight: bold; text-align: right;' });
    uiElements.conditionLabel.clutter_text.set_line_alignment(2);
    uiElements.highLowLabel = new St.Label({ text: 'H:--° L:--°', style: 'font-size: 11px; opacity: 0.8;' });

    rightLayout.add_child(iconWrapper);
    rightLayout.add_child(uiElements.conditionLabel);
    rightLayout.add_child(uiElements.highLowLabel);
    topLayout.add_child(rightLayout);

    layout.add_child(topLayout);
    const divider = new St.Widget({ style: 'background-color: currentColor; opacity: 0.2; height: 1px; margin-top: 8px; margin-bottom: 12px;' });
    layout.add_child(divider);

    const hourlyContainer = new St.BoxLayout({ vertical: false, x_expand: true });
    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        const hourBox = new St.BoxLayout({ vertical: true, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        const timeLbl = new St.Label({ text: '--', style: 'font-size: 11px; font-weight: bold; margin-bottom: 8px; text-align: center;' });
        timeLbl.clutter_text.set_line_alignment(1);

        const icon = new St.Icon({ gicon: createFallbackIcon(extensionPath), icon_size: 30, style: 'margin-bottom: 8px;' });
        const hourlyIconWrapper = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.CENTER, x_expand: true });
        hourlyIconWrapper.add_child(icon);

        const tempLbl = new St.Label({ text: '--°', style: 'font-size: 12px; font-weight: bold; text-align: center;' });
        tempLbl.clutter_text.set_line_alignment(1);

        hourBox.add_child(timeLbl);
        hourBox.add_child(hourlyIconWrapper);
        hourBox.add_child(tempLbl);
        hourlyContainer.add_child(hourBox);
        uiElements.hourlyActors.push({ timeLbl, icon, tempLbl });
    }
    layout.add_child(hourlyContainer);

    return uiElements;
}

function buildSimpleLayout(layout) {
    const uiElements = { hourlyActors: [] };
    const simpleBox = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER, x_expand: true });
    uiElements.tempLabel = new St.Label({ text: '--°', style: 'font-size: 56px; font-weight: 300; margin-right: 24px;' });

    const rightBox = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER });
    uiElements.conditionLabel = new St.Label({ text: 'Loading...', style: 'font-size: 24px; font-weight: bold; margin-bottom: 6px;' });
    uiElements.dateLabel = new St.Label({ text: '---', style: 'font-size: 16px; opacity: 0.8;' });

    rightBox.add_child(uiElements.conditionLabel);
    rightBox.add_child(uiElements.dateLabel);
    simpleBox.add_child(uiElements.tempLabel);
    simpleBox.add_child(rightBox);
    layout.add_child(simpleBox);

    return uiElements;
}

function buildStandardLayout(layout, widgetData, extensionPath) {
    const uiElements = { hourlyActors: [] };
    uiElements.cityLabel = new St.Label({ text: widgetData.location || FALLBACK_LOCATION, style: 'font-weight: bold; font-size: 16px; margin-bottom: 4px;' });
    uiElements.tempLabel = new St.Label({ text: '--°', style: 'font-size: 42px; font-weight: 300; margin-bottom: 12px;' });
    layout.add_child(uiElements.cityLabel);
    layout.add_child(uiElements.tempLabel);

    const spacer = new St.Widget({ y_expand: true });
    layout.add_child(spacer);

    const conditionLayout = new St.BoxLayout({ vertical: false });
    uiElements.conditionIcon = new St.Icon({
        gicon: createFallbackIcon(extensionPath),
        icon_size: 27,
        style: 'margin-right: 6px;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: 'font-size: 14px; font-weight: bold;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    conditionLayout.add_child(uiElements.conditionIcon);
    conditionLayout.add_child(uiElements.conditionLabel);
    layout.add_child(conditionLayout);

    uiElements.highLowLabel = new St.Label({ text: 'H:--° L:--°', style: 'font-size: 12px; opacity: 0.7; margin-top: 4px;' });
    layout.add_child(uiElements.highLowLabel);

    return uiElements;
}

//  Data update 
function getAssetSizeForWidget(widgetData) {
    const isForecast = widgetData.width === 6;
    const isSimple = widgetData.width === 4;
    return (isForecast || isSimple) ? '4x6' : '3x3';
}

function updateHourlyForecastUi(json, uiElements, currentEpoch, extensionPath, useFahrenheit) {
    if (!uiElements.hourlyActors || uiElements.hourlyActors.length === 0)
        return;

    let allHours = [];
    if (json.forecast.forecastday.length > 0)
        allHours = allHours.concat(json.forecast.forecastday[0].hour);
    if (json.forecast.forecastday.length > 1)
        allHours = allHours.concat(json.forecast.forecastday[1].hour);

    const futureHours = allHours.filter(h => h.time_epoch > currentEpoch);

    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        if (futureHours[i] && uiElements.hourlyActors[i]) {
            const hourData = futureHours[i];
            const date = new Date(hourData.time_epoch * 1000);
            let hours = date.getHours();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;

            const temp = useFahrenheit ? hourData.temp_f : hourData.temp_c;
            uiElements.hourlyActors[i].timeLbl.text = `${hours} ${ampm}`;
            uiElements.hourlyActors[i].tempLbl.text = `${Math.round(temp)}°`;

            const hourlyAssets = getWeatherAssets(extensionPath, hourData.condition.code, hourData.is_day);
            uiElements.hourlyActors[i].icon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(hourlyAssets.iconPath) });
        }
    }
}

function updateTextLabels(json, uiElements, useFahrenheit) {
    const current = json.current;
    const forecast = json.forecast.forecastday[0].day;
    const unit = useFahrenheit ? '°F' : '°C';

    const currentTemp = useFahrenheit ? current.temp_f : current.temp_c;
    const highTemp = useFahrenheit ? forecast.maxtemp_f : forecast.maxtemp_c;
    const lowTemp = useFahrenheit ? forecast.mintemp_f : forecast.mintemp_c;

    if (uiElements.tempLabel) uiElements.tempLabel.text = `${Math.round(currentTemp)}${unit}`;
    if (uiElements.conditionLabel) uiElements.conditionLabel.text = current.condition.text;
    if (uiElements.highLowLabel) uiElements.highLowLabel.text = `H:${Math.round(highTemp)}${unit} L:${Math.round(lowTemp)}${unit}`;

    if (uiElements.dateLabel) {
        const date = new Date(current.last_updated_epoch * 1000);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        uiElements.dateLabel.text = `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
    }
}

function updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage) {
    const fontFamily = widgetData.fontFamily || DEFAULT_FONT_FAMILY;
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
        const customBg = resolveWidgetBackgroundColor(widgetData);
        const customText = resolveWidgetForegroundColor(widgetData);
        widgetNode.style = `
            background-color: ${customBg};
            color: ${customText};
            font-family: ${fontFamily};
            ${baseStyle}
        `;
    }

    const borderRadius = widgetData.appliedBorderRadius || 0;
    const borderWidth = widgetData.appliedBorderWidth || 0;
    const innerRadius = Math.max(0, borderRadius - borderWidth);
    
    if (isDynamicImage && assets.bgImagePath) {
        bgImageActor.style = `
            background-image: url("file://${assets.bgImagePath}");
            background-size: cover;
            background-position: center;
            opacity: 1;
            border-radius: ${innerRadius}px;
        `;
    } else {
        bgImageActor.style = '';
    }
}

function updateWeatherUi(json, uiElements, widgetData, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath) {
    const current = json.current;
    const useFahrenheit = widgetData.useFahrenheit !== undefined ? widgetData.useFahrenheit : widgetData.globalUseFahrenheit === true;

    updateTextLabels(json, uiElements, useFahrenheit);
    updateHourlyForecastUi(json, uiElements, current.last_updated_epoch, extensionPath, useFahrenheit);

    const assetSize = getAssetSizeForWidget(widgetData);
    const assets = getWeatherAssets(extensionPath, current.condition.code, current.is_day, assetSize);

    if (uiElements.conditionIcon)
        uiElements.conditionIcon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(assets.iconPath) });

    updateWidgetStyle(widgetNode, bgImageActor, widgetData, assets, isDynamicColor, isDynamicImage);
}

//  API communication 
function fetchWeatherData(widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath) {
    if (!widgetNode.weatherSession)
        widgetNode.weatherSession = new Soup.Session();

    const apiKey = widgetData.apiKey;
    if (!apiKey || apiKey.trim() === '') {
        if (uiElements.conditionLabel)
            uiElements.conditionLabel.text = 'Missing API Key';
        return;
    }

    const location = widgetData.location || FALLBACK_LOCATION;

    // Request 2 days of forecast to ensure we can display tomorrow's high/low temperatures
    // even when querying late in the current day.
    const url = `http://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(location)}&days=2&aqi=no&alerts=no`;

    const message = Soup.Message.new('GET', url);
    widgetNode.weatherSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, response) => {
        try {
            const bytes = session.send_and_read_finish(response);
            if (message.get_status() === HTTP_STATUS_OK) {
                const decoder = new TextDecoder('utf-8');
                const json = JSON.parse(decoder.decode(bytes.get_data()));
                updateWeatherUi(json, uiElements, widgetData, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath);
            }
        } catch (error) {
            console.error('Weather fetch error:', error);
            if (uiElements.conditionLabel)
                uiElements.conditionLabel.text = 'Error';
        }
    });
}

//  Public entry point 
export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    // extensionPath is injected into widgetData by desktopGrid before calling this function
    const extensionPath = widgetData.extensionPath || '';

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    const bgImageActor = createBackgroundImageActor(widgetNode, widgetData);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode, widgetData);

    const isForecast = widgetData.width === 6;
    const isSimple = widgetData.width === 4;

    let uiElements;
    if (isForecast)
        uiElements = buildForecastLayout(layout, widgetData, extensionPath);
    else if (isSimple)
        uiElements = buildSimpleLayout(layout);
    else
        uiElements = buildStandardLayout(layout, widgetData, extensionPath);

    widgetNode.add_child(layout);

    const triggerWeatherFetch = () => {
        fetchWeatherData(widgetData, uiElements, widgetNode, bgImageActor, isDynamicColor, isDynamicImage, extensionPath);
    };

    triggerWeatherFetch();

    const state = { timerId: null };

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        triggerWeatherFetch();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(widgetNode, state);

    widgetNode.connect('destroy', () => {
        if (widgetNode.weatherSession) {
            widgetNode.weatherSession.abort();
            widgetNode.weatherSession = null;
        }
    });

    return widgetNode;
}
