import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

// GNOME's long standing double click and drag defaults. The desktop settings for
// these are not exposed in the schemas GNOME 45 to 50 ship, so they are stated
// here rather than read from a key that does not exist.
const DOUBLE_CLICK_MAX_GAP_MS = 400;
const MAX_DRAG_DISTANCE_PX = 8;

/**
 * Calls `callback` on a short primary click, ignoring drags so this stays usable
 * on actors the desktop can also move.
 *
 * A drag is told from a click by movement, the same as connectDoubleClick below and
 * for the same reason: a time limit throws away deliberate clicks, since a press
 * held for a fraction of a second is ordinary and a fast double click is not much
 * longer than that.
 */
export function connectShortClick(actor, callback) {
    let pressX = 0;
    let pressY = 0;
    let armed = false;
    let stageId = 0;

    const clearStageHandler = () => {
        if (!stageId) return;
        global.stage.disconnect(stageId);
        stageId = 0;
    };

    // The release can arrive on the actor or on the stage, and the desktop grid grabs
    // the pointer in between, so whichever gets here first settles the press. Arming
    // only lasts one press, so a click cannot fire twice.
    const settle = releaseEvent => {
        if (!armed) return Clutter.EVENT_PROPAGATE;
        armed = false;
        clearStageHandler();

        if (releaseEvent.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = releaseEvent.get_coords();
        const dragged = Math.abs(x - pressX) > MAX_DRAG_DISTANCE_PX
            || Math.abs(y - pressY) > MAX_DRAG_DISTANCE_PX;
        if (!dragged)
            callback();
        return Clutter.EVENT_PROPAGATE;
    };

    const disarm = () => {
        armed = false;
        clearStageHandler();
    };

    actor.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        pressX = x;
        pressY = y;
        armed = true;
        clearStageHandler();
        stageId = global.stage.connect('button-release-event', (_stage, releaseEvent) => settle(releaseEvent));
        return Clutter.EVENT_PROPAGATE;
    });

    actor.connect('button-release-event', (_actor, releaseEvent) => settle(releaseEvent));

    actor.connect('destroy', disarm);
    return disarm;
}

/**
 * Calls `callback` on a double click: two primary presses close together in both
 * time and space.
 *
 * The second press is what triggers it, the way GTK does it, rather than the
 * second release. That matters for two reasons. A press held longer than a
 * hundred milliseconds still counts as a click, so a deliberate double click is
 * never thrown away, and there is no stage level release handler to install and
 * tear down on every press. Dragging is told apart from clicking by movement
 * under the desktop's own drag threshold, not by how long the button was held.
 *
 * The press is always propagated, never consumed, so an ancestor that drags the
 * widget still sees it. That is the point of a double click here: a single press
 * stays free for the desktop grid to pick up.
 */
export function connectDoubleClick(actor, callback) {
    let lastPressTime = 0;
    let lastPressX = 0;
    let lastPressY = 0;

    actor.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const now = Date.now();
        const isSecondClick = lastPressTime > 0
            && (now - lastPressTime) <= DOUBLE_CLICK_MAX_GAP_MS
            && Math.abs(x - lastPressX) <= MAX_DRAG_DISTANCE_PX
            && Math.abs(y - lastPressY) <= MAX_DRAG_DISTANCE_PX;

        if (isSecondClick) {
            // Clear first so a third click starts a fresh pair.
            lastPressTime = 0;
            callback();
        } else {
            lastPressTime = now;
            lastPressX = x;
            lastPressY = y;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    return () => {};
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
