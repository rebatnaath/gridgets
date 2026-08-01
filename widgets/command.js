import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../utils/widgetUtils.js';
import { createWidgetContainer } from '../utils/widgetUIUtils.js';

const DEFAULT_ICON = 'system-run-symbolic';
const DEFAULT_COMMAND = 'echo "Hello World"';
const DEFAULT_COMMAND_NAME = 'Quick Launch';
const DRAG_THRESHOLD_PIXELS = 10;
const CENTER_CLICK_MARGIN_RATIO = 0.20;
const DEFAULT_ICON_SIZE = 68;
const MIN_SCALED_ICON_SIZE = 14;
const BASE_TITLE_FONT_SIZE = 14;
const MIN_TITLE_FONT_SIZE = 8;
const LOADING_ICON_SIZE = 32;
const UI_PADDING_PIXELS = 12;
const OVERLAY_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.5)';
const BASE_CONTAINER_SIZE = 160;
const BUTTON_PRIMARY = 1;
function buildTerminalScript(commandString) {
    const escapedCommand = commandString.replace(/'/g, "'\\''");
    return `
for term in kgx gnome-terminal ptyxis x-terminal-emulator alacritty xterm; do
    if command -v $term >/dev/null 2>&1; then
        if [ "$term" = "gnome-terminal" ] || [ "$term" = "ptyxis" ]; then
            exec $term --wait -- bash -c '${escapedCommand}'
        elif [ "$term" = "kgx" ]; then
            exec $term --wait -e bash -c '${escapedCommand}; exit_code=$?; ppid_name=$(ps -o comm= -p $PPID 2>/dev/null); if [ "$ppid_name" = ".kgx-wrapped" ] || [ "$ppid_name" = "kgx" ]; then kill -TERM $PPID; fi; exit $exit_code'
        else
            exec $term -e bash -c '${escapedCommand}'
        fi
        exit 0
    fi
done
bash -c '${escapedCommand}'
`;
}

function isWithinClickableCenter(relativeX, relativeY, containerWidth, containerHeight) {
    const marginX = containerWidth * CENTER_CLICK_MARGIN_RATIO;
    const marginY = containerHeight * CENTER_CLICK_MARGIN_RATIO;
    return relativeX >= marginX && relativeX <= containerWidth - marginX
        && relativeY >= marginY && relativeY <= containerHeight - marginY;
}

export function createCommandNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);

    const commandString = config.commandString || DEFAULT_COMMAND;
    const iconName = config.iconName || DEFAULT_ICON;
    const cleanImagePath = (config.imagePath || '').replace(/^file:\/\//, '');
    const commandName = config.commandName || DEFAULT_COMMAND_NAME;
    const showText = config.showText !== false;
    const hasValidImage = cleanImagePath.length > 0 && GLib.file_test(cleanImagePath, GLib.FileTest.EXISTS);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let idleSourceId = null;

    container.connect('destroy', () => {
        if (idleSourceId) {
            GLib.Source.remove(idleSourceId);
            idleSourceId = null;
        }
    });

    const wrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    const commandImage = hasValidImage
        ? new St.Widget({
            style: `background-image: url("file://${cleanImagePath}"); background-size: contain; background-repeat: no-repeat; background-position: center;`,
            width: DEFAULT_ICON_SIZE,
            height: DEFAULT_ICON_SIZE,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        })
        : new St.Icon({
            icon_name: iconName,
            icon_size: DEFAULT_ICON_SIZE,
            style: `color: ${textColor};`,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

    wrapper.add_child(commandImage);

    let titleLabel = null;
    if (showText) {
        const contentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            style: `padding: ${UI_PADDING_PIXELS}px;`,
        });

        titleLabel = new St.Label({
            text: commandName,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${BASE_TITLE_FONT_SIZE}px; text-align: center; text-shadow: 0px 2px 4px rgba(0,0,0,0.8);`,
            x_align: Clutter.ActorAlign.CENTER,
        });

        contentBox.add_child(titleLabel);
        wrapper.add_child(contentBox);
    }

    const updateScaling = () => {
        if (container.isDestroyed) return;
        const currentWidth = container.width || width || BASE_CONTAINER_SIZE;
        const currentHeight = container.height || height || BASE_CONTAINER_SIZE;
        const scale = Math.max(0.2, Math.min(currentWidth / BASE_CONTAINER_SIZE, currentHeight / BASE_CONTAINER_SIZE));

        const userIconScale = config.iconScale !== undefined ? config.iconScale : 1.0;
        const scaledIconSize = Math.max(MIN_SCALED_ICON_SIZE, Math.round(DEFAULT_ICON_SIZE * scale * userIconScale));
        const scaledFontSize = Math.max(MIN_TITLE_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));

        if (hasValidImage) {
            commandImage.set_width(scaledIconSize);
            commandImage.set_height(scaledIconSize);
        } else {
            commandImage.set_icon_size(scaledIconSize);
        }

        if (titleLabel) {
            titleLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${scaledFontSize}px; text-align: center; text-shadow: 0px 2px 4px rgba(0,0,0,0.8);`;
        }
    };

    container.connect('notify::width', updateScaling);
    container.connect('notify::height', updateScaling);

    idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        idleSourceId = null;
        updateScaling();
        return GLib.SOURCE_REMOVE;
    });

    const executionOverlay = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `background-color: ${OVERLAY_BACKGROUND_COLOR};`,
        visible: false,
    });
    const loadingIcon = new St.Icon({
        icon_name: 'emblem-synchronizing-symbolic',
        icon_size: LOADING_ICON_SIZE,
        style: `color: ${textColor};`,
    });
    executionOverlay.add_child(loadingIcon);
    wrapper.add_child(executionOverlay);
    container.add_child(wrapper);

    let isCommandRunning = false;
    let pressX = 0;
    let pressY = 0;

    container.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            [pressX, pressY] = event.get_coords();
        }
        return Clutter.EVENT_PROPAGATE;
    });

    container.connect('button-release-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY && !isCommandRunning) {
            if (container.actionOverlay)
                return Clutter.EVENT_PROPAGATE;

            const [releaseX, releaseY] = event.get_coords();
            const isClickNotDrag = Math.abs(releaseX - pressX) < DRAG_THRESHOLD_PIXELS
                && Math.abs(releaseY - pressY) < DRAG_THRESHOLD_PIXELS;

            if (isClickNotDrag) {
                const [success, relativeX, relativeY] = container.transform_stage_point(releaseX, releaseY);
                if (success && isWithinClickableCenter(relativeX, relativeY, container.width, container.height)) {
                    executeCommand();
                }
            }
        }
        return Clutter.EVENT_PROPAGATE;
    });

    const executeCommand = () => {
        if (container.isDestroyed) return;
        isCommandRunning = true;
        executionOverlay.show();

        try {
            const terminalScript = buildTerminalScript(commandString);
            const subprocess = new Gio.Subprocess({
                argv: ['/bin/sh', '-c', terminalScript],
                flags: Gio.SubprocessFlags.NONE
            });
            subprocess.init(null);

            subprocess.wait_async(null, (proc, res) => {
                isCommandRunning = false;
                if (!container.isDestroyed) {
                    executionOverlay.hide();
                }
                try {
                    proc.wait_finish(res);
                    Main.notify('Command Finished', `${commandName} execution completed.`);
                } catch (e) {
                    Main.notify('Command Failed', `Error executing ${commandName}: ${e.message}`);
                }
            });
        } catch (e) {
            isCommandRunning = false;
            if (!container.isDestroyed) {
                executionOverlay.hide();
            }
            Main.notify('Command Error', `Failed to start ${commandName}: ${e.message}`);
        }
    };

    return container;
}
