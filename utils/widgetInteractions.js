import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

const SHORT_CLICK_MAX_DURATION_MS = 100;

export function connectShortClick(actor, callback) {
    let pressTime = 0;
    let pressStageId = 0;

    const disconnectReleaseHandler = () => {
        if (!pressStageId) return;
        global.stage.disconnect(pressStageId);
        pressStageId = 0;
    };

    actor.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        pressTime = Date.now();
        disconnectReleaseHandler();
        pressStageId = global.stage.connect('button-release-event', (_stage, releaseEvent) => {
            if (releaseEvent.get_button() === Clutter.BUTTON_PRIMARY
                && Date.now() - pressTime <= SHORT_CLICK_MAX_DURATION_MS) {
                callback();
            }
            disconnectReleaseHandler();
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_PROPAGATE;
    });

    actor.connect('destroy', disconnectReleaseHandler);
    return disconnectReleaseHandler;
}

export function launchApplication(command) {
    try {
        const appInfo = Gio.AppInfo.create_from_commandline(command, null, Gio.AppInfoCreateFlags.NONE);
        if (!appInfo) return false;
        appInfo.launch([], null);
        return true;
    } catch (_error) {
        return false;
    }
}
