import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { connectTimerCleanup, createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import {
    REFRESH_INTERVAL_SECONDS,
    createBackgroundImageActor,
    createMainLayout,
    fetchWeatherViaOpenMeteo,
    releaseWeatherSession,
    resolveWeatherLayoutVariant,
} from './weatherCommon.js';
import { buildForecastLayout, attachForecastScaler } from './weatherForecast.js';
import { buildSimpleLayout, attachSimpleScaler } from './weatherSimple.js';
import { buildStandardLayout, attachStandardScaler } from './weatherStandard.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';

export { createSunScheduleNode } from './solarSchedule.js';

const GNOME_WEATHER_BUS_NAME = 'org.gnome.Weather';
const GNOME_WEATHER_OBJECT_PATH = '/org/gnome/Weather';
const COORDINATE_TOLERANCE = 0.0001;

function launchGnomeWeather() {
    return launchApplication('gnome-weather');
}

function findSerializedWeatherLocation(widgetData, GWeather) {
    // Gio.Settings is not a GtkWidget: it has no destroy(), and GJS finalises
    // it on collection.
    const settings = new Gio.Settings({ schema_id: 'org.gnome.Weather' });
    const world = GWeather.Location.get_world();
    // 'locations' is an "av" (array of variants). Each element has to stay a
    // GVariant for deserialize(); deep_unpack() would hand it a plain object.
    const locations = settings.get_value('locations');
    const locationCount = locations.n_children();

    for (let index = 0; index < locationCount; index++) {
        // get_child_value on an "av" returns another variant, so unwrap it
        // to reach the a{sv} payload deserialize() expects.
        const serializedLocation = locations.get_child_value(index).get_variant();
        const location = world.deserialize(serializedLocation);
        if (!location?.has_coords()) continue;

        const [latitude, longitude] = location.get_coords();
        const hasSavedCoordinates = Number.isFinite(widgetData.lat) && Number.isFinite(widgetData.lon);
        const coordinatesMatch = hasSavedCoordinates
            && Math.abs(latitude - widgetData.lat) <= COORDINATE_TOLERANCE
            && Math.abs(longitude - widgetData.lon) <= COORDINATE_TOLERANCE;
        const nameMatches = !hasSavedCoordinates
            && location.get_name()?.localeCompare(widgetData.location, undefined, { sensitivity: 'base' }) === 0;

        if (coordinatesMatch || nameMatches)
            return serializedLocation;
    }

    return null;
}

function callGnomeWeatherAction(actionName) {
    return new Promise((resolve, reject) => {
        const parameters = new GLib.Variant('(sava{sv})', [
            actionName,
            [],
            {},
        ]);

        Gio.DBus.session.call(
            GNOME_WEATHER_BUS_NAME,
            GNOME_WEATHER_OBJECT_PATH,
            'org.gtk.Actions',
            'Activate',
            parameters,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

function closeGnomeWeather() {
    return new Promise(resolve => {
        const connection = Gio.DBus.session;
        let timeoutId = 0;
        let isFinished = false;
        const ownerChangedId = connection.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            GNOME_WEATHER_BUS_NAME,
            Gio.DBusSignalFlags.NONE,
            (_connection, _senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                const values = Array.isArray(parameters) ? parameters : parameters.deep_unpack();
                const [name, , newOwner] = values;
                if (name === GNOME_WEATHER_BUS_NAME && !newOwner)
                    finish();
            }
        );
        const finish = () => {
            if (isFinished) return;
            isFinished = true;
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
                timeoutId = 0;
            }
            connection.signal_unsubscribe(ownerChangedId);
            resolve();
        };

        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            timeoutId = 0;
            finish();
            return GLib.SOURCE_REMOVE;
        });
        callGnomeWeatherAction('quit').catch(finish);
    });
}

function activateGnomeWeatherLocation(serializedLocation) {
    return new Promise((resolve, reject) => {
        const parameters = new GLib.Variant('(sava{sv})', [
            'show-location',
            [new GLib.Variant('v', serializedLocation)],
            {},
        ]);

        Gio.DBus.session.call(
            GNOME_WEATHER_BUS_NAME,
            GNOME_WEATHER_OBJECT_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            parameters,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

async function showGnomeWeatherLocation(widgetData, widgetNode) {
    if (isActorDestroyed(widgetNode)) return;

    try {
        const { default: GWeather } = await import('gi://GWeather?version=4.0');
        if (isActorDestroyed(widgetNode)) return;

        const serializedLocation = findSerializedWeatherLocation(widgetData, GWeather);
        if (!serializedLocation) {
            launchGnomeWeather();
            return;
        }

        await closeGnomeWeather();
        if (isActorDestroyed(widgetNode)) return;
        await activateGnomeWeatherLocation(serializedLocation);
    } catch (error) {
        console.error('Unable to open the selected weather location:', error);
        launchGnomeWeather();
    }
}

export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    connectShortClick(widgetNode, () => showGnomeWeatherLocation(widgetData, widgetNode));

    const bgImageActor = createBackgroundImageActor(widgetNode);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode);
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);

    let uiElements;
    if (layoutVariant === 'forecast') {
        uiElements = buildForecastLayout(layout, widgetData);
        attachForecastScaler(widgetNode, uiElements, widgetData);
    } else if (layoutVariant === 'simple') {
        uiElements = buildSimpleLayout(layout, widgetData);
        attachSimpleScaler(widgetNode, uiElements, widgetData);
    } else {
        uiElements = buildStandardLayout(layout, widgetData);
        attachStandardScaler(widgetNode, uiElements, widgetData);
    }

    widgetNode.add_child(layout);

    const context = {
        widgetData,
        uiElements,
        widgetNode,
        bgImageActor,
        isDynamicColor,
        isDynamicImage,
        extensionPath,
    };

    const triggerWeatherFetch = () => {
        if (isActorDestroyed(widgetNode)) return;
        releaseWeatherSession(widgetNode);
        fetchWeatherViaOpenMeteo(context);
    };

    triggerWeatherFetch();

    const state = {
        timerId: null,
        unlockTimeoutId: 0,
        networkTimeoutId: 0,
    };
    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        triggerWeatherFetch();
        return GLib.SOURCE_CONTINUE;
    });

    const onUnlock = () => {
        if (isActorDestroyed(widgetNode)) return;
        if (state.unlockTimeoutId)
            GLib.Source.remove(state.unlockTimeoutId);
        state.unlockTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            state.unlockTimeoutId = 0;
            if (!isActorDestroyed(widgetNode))
                triggerWeatherFetch();
            return GLib.SOURCE_REMOVE;
        });
    };

    let screenShieldSignalId = 0;
    if (Main.screenShield) {
        screenShieldSignalId = Main.screenShield.connect('unlock', onUnlock);
    }

    const netMonitor = Gio.NetworkMonitor.get_default();
    let netAvailableId = 0;
    netAvailableId = netMonitor.connect('network-changed', (_monitor, available) => {
        if (available && !isActorDestroyed(widgetNode)) {
            if (state.networkTimeoutId)
                GLib.Source.remove(state.networkTimeoutId);
            state.networkTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                state.networkTimeoutId = 0;
                if (!isActorDestroyed(widgetNode))
                    triggerWeatherFetch();
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    connectTimerCleanup(widgetNode, state);
    registerWidgetCleanup(widgetNode, () => releaseWeatherSession(widgetNode));
    registerWidgetCleanup(widgetNode, () => {
        if (state.unlockTimeoutId) {
            GLib.Source.remove(state.unlockTimeoutId);
            state.unlockTimeoutId = 0;
        }
        if (state.networkTimeoutId) {
            GLib.Source.remove(state.networkTimeoutId);
            state.networkTimeoutId = 0;
        }
        for (const signalId of [...(bgImageActor.backgroundSignalIds || []), ...(layout.backgroundSignalIds || [])]) {
            widgetNode.disconnect(signalId);
        }
        if (screenShieldSignalId && Main.screenShield) {
            Main.screenShield.disconnect(screenShieldSignalId);
            screenShieldSignalId = 0;
        }
        if (netAvailableId) {
            netMonitor.disconnect(netAvailableId);
            netAvailableId = 0;
        }
    });

    return widgetNode;
}
