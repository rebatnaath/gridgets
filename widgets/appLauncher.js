import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba, resolveDesktopAppInfo } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const MAX_APPS = 8;
const DEFAULT_APP_ICON = 'application-x-executable-symbolic';
const DRAG_THRESHOLD_PIXELS = 10;
const OUTER_MARGIN = 12;
const GRID_GAP = 10;
const TILE_RADIUS = 14;
const TILE_BASE_ALPHA = 0.07;
const TILE_HOVER_ALPHA = 0.13;
const BORDER_ALPHA = 0.14;
const TILE_PADDING_RATIO = 0.1;
const TILE_PADDING_MIN = 3;
const TILE_PADDING_MAX = 10;

const ICON_SIZE_RATIO = 0.72;
const MIN_ICON_SIZE = 8;
const MAX_ICON_SIZE = 200;

function computeGridLayout(appCount) {
    if (appCount <= 1) return { cols: 1, rows: 1 };
    if (appCount <= 2) return { cols: 2, rows: 1 };
    if (appCount <= 4) return { cols: 2, rows: 2 };
    if (appCount <= 6) return { cols: 3, rows: 2 };
    return { cols: 4, rows: 2 };
}

function buildTileStyle(tileRgba, padding) {
    return `background-color: ${tileRgba}; border-radius: ${TILE_RADIUS}px; padding: ${padding}px;`;
}

export function createAppLauncherNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const tileBaseBg = cssColorToRgba(textColor, TILE_BASE_ALPHA);
    const tileHoverBg = cssColorToRgba(textColor, TILE_HOVER_ALPHA);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const apps = Array.isArray(config.apps) ? config.apps.slice(0, MAX_APPS) : [];

    if (apps.length === 0) {
        const emptyLabel = new St.Label({
            text: 'No apps configured',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: `${fontCss}color: ${textColor}; opacity: 0.55; font-size: 14px;`,
        });
        container.add_child(emptyLabel);
        return container;
    }

    const { cols, rows } = computeGridLayout(apps.length);

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: `padding: ${OUTER_MARGIN}px;`,
    });

    const grid = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: `spacing: ${GRID_GAP}px;`,
    });

    outerBox.add_child(grid);
    container.add_child(outerBox);

    const cells = [];

    const launchApp = (appInfo, app, displayName) => {
        if (isActorDestroyed(container)) return;

        if (appInfo) {
            try {
                appInfo.launch([], null);
                return;
            } catch (e) {
                console.debug(`Failed to launch ${app.id}:`, e);
            }
        }

        Main.notify('App Launcher', `Could not launch ${displayName}`);
    };

    const updateCell = (cell, padding, iconSize) => {
        cell.padding = padding;
        cell.button.set_style(buildTileStyle(cell.hovered ? tileHoverBg : tileBaseBg, padding));
        cell.icon.set_icon_size(iconSize);
    };

    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            style: `spacing: ${GRID_GAP}px;`,
        });
        grid.add_child(rowBox);

        for (let colIndex = 0; colIndex < cols; colIndex++) {
            const appIndex = rowIndex * cols + colIndex;
            if (appIndex >= apps.length) break;

            const app = apps[appIndex];
            const appInfo = resolveDesktopAppInfo(app.id);
            const displayName = (app.name && app.name.trim() !== '') ? app.name : app.id.replace(/\.desktop$/i, '');

            const button = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_expand: true,
                style: buildTileStyle(tileBaseBg, TILE_PADDING_MIN),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const cellBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const appIcon = new St.Icon({
                icon_name: DEFAULT_APP_ICON,
                icon_size: MIN_ICON_SIZE,
                style: `color: ${textColor};`,
                x_align: Clutter.ActorAlign.CENTER,
            });

            const gicon = appInfo ? appInfo.get_icon() : null;
            if (gicon) {
                appIcon.gicon = gicon;
            }

            cellBox.add_child(appIcon);
            button.set_child(cellBox);
            rowBox.add_child(button);

            const cell = { icon: appIcon, button, padding: TILE_PADDING_MIN, hovered: false, pressX: 0, pressY: 0 };

            button.connect('enter-event', () => {
                cell.hovered = true;
                button.set_style(buildTileStyle(tileHoverBg, cell.padding));
                return Clutter.EVENT_PROPAGATE;
            });
            button.connect('leave-event', () => {
                cell.hovered = false;
                button.set_style(buildTileStyle(tileBaseBg, cell.padding));
                return Clutter.EVENT_PROPAGATE;
            });

            button.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
                    return Clutter.EVENT_PROPAGATE;
                const [x, y] = event.get_coords();
                cell.pressX = x;
                cell.pressY = y;
                return Clutter.EVENT_STOP;
            });

            button.connect('button-release-event', (_actor, event) => {
                if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
                    return Clutter.EVENT_PROPAGATE;

                const [releaseX, releaseY] = event.get_coords();
                const isClickNotDrag = Math.abs(releaseX - cell.pressX) < DRAG_THRESHOLD_PIXELS
                    && Math.abs(releaseY - cell.pressY) < DRAG_THRESHOLD_PIXELS;

                if (isClickNotDrag) {
                    launchApp(appInfo, app, displayName);
                }
                return Clutter.EVENT_STOP;
            });

            cells.push(cell);
        }
    }

    const updateScaling = () => {
        if (isActorDestroyed(container)) return;
        const currentWidth = container.width || width || 240;
        const currentHeight = container.height || height || 180;
        const contentWidth = Math.max(1, currentWidth - (OUTER_MARGIN * 2));
        const contentHeight = Math.max(1, currentHeight - (OUTER_MARGIN * 2));

        const cellWidth = (contentWidth - (GRID_GAP * (cols - 1))) / cols;
        const cellHeight = (contentHeight - (GRID_GAP * (rows - 1))) / rows;
        const minCell = Math.max(MIN_ICON_SIZE, Math.min(cellWidth, cellHeight));

        const padding = Math.min(TILE_PADDING_MAX, Math.max(TILE_PADDING_MIN, Math.round(minCell * TILE_PADDING_RATIO)));
        const available = Math.max(MIN_ICON_SIZE, minCell - (padding * 2));

        const iconSize = Math.min(MAX_ICON_SIZE, Math.max(MIN_ICON_SIZE, Math.round(available * ICON_SIZE_RATIO)));

        for (const cell of cells) {
            updateCell(cell, padding, iconSize);
        }
    };

    container.connect('notify::width', updateScaling);
    container.connect('notify::height', updateScaling);

    let idleSourceId = null;
    registerWidgetCleanup(container, () => {
        if (idleSourceId) {
            GLib.Source.remove(idleSourceId);
            idleSourceId = null;
        }
    });

    idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        idleSourceId = null;
        updateScaling();
        return GLib.SOURCE_REMOVE;
    });

    return container;
}
