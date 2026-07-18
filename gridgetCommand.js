/**
 * ============================================================================
 * COMMAND LAUNCHER WIDGET 
 * 
 * This module implements a widget that executes user-defined shell commands.
 * It provides a clickable interface with visual feedback during execution 
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    createWidgetContainer
} from './widgetUIUtils.js';

const DEFAULT_ICON = 'system-run-symbolic';
const DEFAULT_COMMAND = 'echo "Hello World"';

const DRAG_THRESHOLD_PIXELS = 10;
const CENTER_CLICK_MARGIN_RATIO = 0.20;
const DEFAULT_ICON_SIZE = 48;
const LOADING_ICON_SIZE = 32;
const UI_PADDING_PIXELS = 12;
const OVERLAY_BACKGROUND_COLOR = 'rgba(0, 0, 0, 0.5)';

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
    const borderRadius = config.appliedBorderRadius || 0;
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const commandString = config.commandString || DEFAULT_COMMAND;
    const imagePath = config.imagePath || '';
    const commandName = config.commandName || 'Quick Launch';
    const showText = config.showText !== false;
    const imageMargin = config.imageMargin || 0;

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const wrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    let commandImage;
    if (imagePath) {
        commandImage = new St.Widget({
            style: `background-image: url("file://${imagePath}"); background-size: cover; background-repeat: no-repeat; border-radius: ${borderRadius}px; margin: ${imageMargin}px;`,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
    } else {
        commandImage = new St.Icon({
            icon_name: DEFAULT_ICON,
            icon_size: DEFAULT_ICON_SIZE,
            style: `color: ${textColor}; margin: ${imageMargin}px;`,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    wrapper.add_child(commandImage);

    if (showText) {
        const contentBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.END,
            style: `padding: ${UI_PADDING_PIXELS}px;`,
        });

        const titleLabel = new St.Label({
            text: commandName,
            style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: 14px; text-align: center; text-shadow: 0px 2px 4px rgba(0,0,0,0.8);`,
            x_align: Clutter.ActorAlign.CENTER,
        });

        contentBox.add_child(titleLabel);
        wrapper.add_child(contentBox);
    }

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
        icon_name: 'process-working-symbolic',
        icon_size: LOADING_ICON_SIZE,
        style: `color: ${textColor};`,
    });
    executionOverlay.add_child(loadingIcon);
    wrapper.add_child(executionOverlay);
    container.add_child(wrapper);

    let isCommandRunning = false;
    let pressX = 0;
    let pressY = 0;

    container.connect('button-press-event', (actor, event) => {
        if (event.get_button() === 1) {
            [pressX, pressY] = event.get_coords();
        }
        return Clutter.EVENT_PROPAGATE;
    });

    container.connect('button-release-event', (actor, event) => {
        if (event.get_button() === 1 && !isCommandRunning) {
            if (container.editMode && container.editMode !== 0)
                return Clutter.EVENT_PROPAGATE;

            const [releaseX, releaseY] = event.get_coords();
            const dragDistanceX = Math.abs(releaseX - pressX);
            const dragDistanceY = Math.abs(releaseY - pressY);

            const isClickNotDrag = dragDistanceX < DRAG_THRESHOLD_PIXELS
                && dragDistanceY < DRAG_THRESHOLD_PIXELS;

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
                try {
                    if (executionOverlay) {
                        executionOverlay.hide();
                    }
                } catch (err) {
                    // Ignore if already finalized
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
            try {
                if (executionOverlay) {
                    executionOverlay.hide();
                }
            } catch (err) {
                // Ignore if already finalized
            }
            Main.notify('Command Error', `Failed to start ${commandName}: ${e.message}`);
        }
    };

    return container;
}
