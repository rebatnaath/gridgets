import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { WidgetActor, attachResponsiveScaler, registerWidgetCleanup } from '../shell/widgetUIUtils.js';
import { isActorDestroyed, watchActorLifecycle } from '../utils/actorLifecycle.js';
import { connectDoubleClick, openExternalUri } from '../utils/widgetInteractions.js';
import { clampText } from '../utils/feedText.js';
import {
    MIN_FONT_SIZE,
    TYPOGRAPHY_SIZE,
    TYPOGRAPHY_WEIGHT,
    clampWidgetScale,
    scaleFontSize,
} from '../utils/typography.js';
import {
    cssColorToRgba,
    resolveExplicitFontFamily,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
    isDarkBackgroundColor,
} from '../utils/widgetUtils.js';
import Gio from 'gi://Gio';
import { isOnClipboard } from './clipboardPaste.js';
import { extensionIndex } from './fileOperations.js';
import { desktopFileFor, isDesktopIcon, resolveDesktopEntry, DESKTOP_ENTRY_SUFFIX } from '../desktopIcons/desktopIcons.js';

/**
 * launch_uris for a document, launch with an empty argument list for a .desktop file: the
 * launcher is the app info itself and its Exec line supplies the command.
 */
export function launchDesktopIcon(widgetData) {
    const file = desktopFileFor(widgetData);
    if (!file)
        return;
    const path = file.get_path();

    if (!path.endsWith(DESKTOP_ENTRY_SUFFIX)) {
        if (!openExternalUri(file.get_uri()))
            console.error(`Gridgets: nothing is registered to open ${file.get_uri()}`);
        return;
    }

    const appInfo = Gio.DesktopAppInfo.new_from_filename(path);
    if (!appInfo) {
        console.error(`Gridgets: ${file.get_uri()} is not a usable launcher file`);
        return;
    }

    try {
        // No arguments here, which is what this call wants: the app info is the launcher
        // itself and its Exec line supplies the command.
        appInfo.launch([], global.create_app_launch_context(0, -1));
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be run:`, error);
    }
}

const ICON_SIZE_PX = 48;

// Scales with the icon: a fixed inset would swallow a third of a small cell.
const ICON_CONTENT_PADDING_PX = 8;
const ICON_HIGHLIGHT_RADIUS_PX = 6;
const ICON_SELECTED_ALPHA = 0.85;
const ICON_HOVER_ALPHA = 0.16;
const MESSAGE_PADDING_PX = 3;
const MESSAGE_BACKGROUND = 'rgba(0, 0, 0, 0.78)';
const MESSAGE_COLOUR = '#f6d32d';

function iconContentPadding(scale) {
    return `padding: ${Math.round(ICON_CONTENT_PADDING_PX * scale)}px;`;
}

function messageLabelStyle() {
    return `background-color: ${MESSAGE_BACKGROUND}; color: ${MESSAGE_COLOUR}; padding: 1px ${MESSAGE_PADDING_PX}px;`;
}

// An unset accent parses to a transparent fill, which would read as no highlight at all.
function resolveHighlightColor(widgetData, textColor) {
    const accent = widgetData.globalAccentColor;
    if (typeof accent === 'string' && accent !== '' && cssColorToRgba(accent, 1) !== 'rgba(0, 0, 0, 0)')
        return accent;
    return textColor || '#ffffff';
}

function applyIconFrame(controller) {
    const alpha = controller.selected
        ? ICON_SELECTED_ALPHA
        : controller.hovered ? ICON_HOVER_ALPHA : null;

    if (alpha === null) {
        controller.frameActor.hide();
        return;
    }

    controller.frameActor.style =
        `background-color: ${cssColorToRgba(controller.highlightColor, alpha)}; border-radius: ${ICON_HIGHLIGHT_RADIUS_PX}px;`;
    controller.frameActor.show();
}

const LABEL_MAX_CHARS = 20;
const MESSAGE_MAX_CHARS = 34;

// One entry and one message label per icon, reached from the node the grid already holds.
const ICON_CONTROLLERS = new WeakMap();

// Nodes that already carry the selection teardown below. selectIcon runs on every press, so
// registering each time would stack an identical callback per click on the same node.
const SELECTION_TEARDOWNS = new WeakSet();

// The icon is left alone in both states: hiding it to make room for the message made an
// emptied entry look like the icon had been deleted.
function setRenameMessage(controller, message) {
    if (message === '') {
        controller.messageLabel.text = '';
        controller.messageLabel.hide();
        return;
    }

    controller.messageLabel.text = clampText(message, MESSAGE_MAX_CHARS);
    controller.messageLabel.show();
}

// The cell at scale one; sized from the cell so the label has room under the glyph.
const REFERENCE_WIDTH_PX = 72;
const REFERENCE_HEIGHT_PX = 84;

export function createDesktopIconNode(widgetData, width, height, xPosition, yPosition) {
    // The icon has no card, so its label sits straight on the wallpaper. On a light theme
    // the foreground washes out against a light desktop, so the label takes the
    // background colour there and the text colour everywhere else. Reacting to the
    // background rather than color-scheme means it also follows a theme override.
    const textColor = resolveWidgetForegroundColor(widgetData);
    const labelColor = isDarkBackgroundColor(resolveWidgetBackgroundColor(widgetData))
        ? textColor
        : resolveWidgetBackgroundColor(widgetData);
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    // No card: the icon sits on the wallpaper, so the container background is not used.
    // No padding on the cell either, which would inset the highlight as well.
    const rootContainer = new WidgetActor({
        style: `${fontCss}background-color: transparent; border: none; box-shadow: none;`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    rootContainer.set_clip_to_allocation(true);

    const box = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const file = desktopFileFor(widgetData);
    // An uninstalled app leaves its entry until the next sync; the grid tolerates no node.
    if (!file) {
        console.error(`Gridgets: ${widgetData.fileName} has no file behind it and cannot be drawn`);
        return null;
    }
    const { label, icon } = resolveDesktopEntry(file);

    const iconActor = new St.Icon({ gicon: icon, icon_size: ICON_SIZE_PX });
    const labelActor = new St.Label({
        text: clampText(label, LABEL_MAX_CHARS),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // In the label's row, so the icon stays visible while typing.
    const renameEntry = new St.Entry({
        text: '',
        can_focus: true,
        visible: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });

    // Overlaid on the BinLayout so it needs no row. At the top, because the entry owns the
    // bottom row while editing.
    const messageLabel = new St.Label({
        text: '',
        visible: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        style: messageLabelStyle(),
    });
    // A ClutterText property: passing line_wrap to the St.Label constructor throws and the
    // widget is never built.
    messageLabel.clutter_text.line_wrap = true;

    // Not reactive: Clutter hit-tests the topmost reactive actor, so this one is passed over
    // and cannot swallow the click that put it there.
    const frameActor = new St.Widget({
        visible: false,
        reactive: false,
        x_expand: true,
        y_expand: true,
    });

    box.add_child(iconActor);
    box.add_child(labelActor);
    box.add_child(renameEntry);
    // Before the box: a BinLayout stacks children in arrival order, and this one fills, so
    // added last it would paint over the icon.
    rootContainer.add_child(frameActor);
    rootContainer.add_child(box);
    rootContainer.add_child(messageLabel);

    const updateScaling = (scale) => {
        if (isActorDestroyed(rootContainer))
            return;
        const fontSize = `${scaleFontSize(TYPOGRAPHY_SIZE.label, scale, MIN_FONT_SIZE.label)}px`;

        iconActor.icon_size = Math.round(ICON_SIZE_PX * scale);
        // On the content box, so the highlight still fills the whole cell.
        box.style = iconContentPadding(scale);
        labelActor.style = `${fontCss}color: ${labelColor}; font-size: ${fontSize}; font-weight: ${TYPOGRAPHY_WEIGHT.medium};`;
        renameEntry.style = `${fontCss}color: ${labelColor}; font-size: ${fontSize};`;
        messageLabel.style = `${fontCss}${messageLabelStyle()} font-size: ${fontSize};`;
    };

    // Sized on the way in: the scaler defers its first pass and the icon would paint at full
    // size for a frame.
    updateScaling(clampWidgetScale(Math.min(width / REFERENCE_WIDTH_PX, height / REFERENCE_HEIGHT_PX)));
    attachResponsiveScaler(rootContainer, REFERENCE_WIDTH_PX, REFERENCE_HEIGHT_PX, updateScaling);

    // A double click launches; a single press is left to the grid so the widget can be dragged.
    connectDoubleClick(rootContainer, () => launchDesktopIcon(widgetData));

    applyInitialClipboardEmphasis(rootContainer, file.get_uri());

    ICON_CONTROLLERS.set(rootContainer, {
        frameActor,
        highlightColor: resolveHighlightColor(widgetData, textColor),
        hovered: false,
        selected: false,
        entry: renameEntry,
        labelActor,
        messageLabel,
        editing: false,
    });

    // A rename can still be in flight when the node goes, and its idle source holds a
    // callback against an actor that no longer exists.
    registerWidgetCleanup(rootContainer, () => abortInlineRename(ICON_CONTROLLERS.get(rootContainer)));

    return watchActorLifecycle(rootContainer);
}

/**
 * Starts renaming an icon, with the entry and every reason shown inside the widget.
 *
 * `validate` is asked on each keystroke and returns '' when the name is usable, so the
 * reason appears as it is typed rather than only on Return. `onAccepted` runs on Return
 * with the final text and returns the same `{ ok, message }` shape as the file operations,
 * which is how a failure that only the filesystem can report still stays in the widget.
 *
 * Returns false if the icon is gone or already being renamed.
 */
export function beginInlineRename(actor, { initialText = '', validate, onAccepted }) {
    if (isActorDestroyed(actor))
        return false;

    const controller = ICON_CONTROLLERS.get(actor);
    if (!controller || controller.editing)
        return false;

    controller.editing = true;
    controller.validate = validate;
    controller.onAccepted = onAccepted;

    controller.labelActor.hide();
    controller.entry.text = initialText;
    controller.entry.show();
    // Up to the extension, so typing replaces the name and leaves the extension standing.
    // A name with no extension, or a leading dot like `.bashrc`, is selected whole.
    const stemLength = extensionIndex(initialText);
    controller.entry.clutter_text.set_selection(0, stemLength > 0 ? stemLength : initialText.length);

    // Not now: the menu still holds a grab, and focusing inside its activate handler leaves
    // the entry editable with no caret.
    controller.focusIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        controller.focusIdle = 0;
        if (isActorDestroyed(actor) || !controller.editing)
            return GLib.SOURCE_REMOVE;
        controller.entry.grab_key_focus();
        return GLib.SOURCE_REMOVE;
    });

    controller.onTextChanged = controller.entry.clutter_text.connect('text-changed', () => {
        setRenameMessage(controller, controller.validate ? controller.validate(controller.entry.get_text()) : '');
    });

    // On the clutter_text: St.Entry is not where key-press-event fires, so a handler
    // connected to it never runs.
    controller.onKeyPress = controller.entry.clutter_text.connect('key-press-event', (_text, event) => {
        const symbol = event.get_key_symbol();
        const isReturn = symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter;
        if (!isReturn && symbol !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;

        if (!isReturn) {
            endInlineRename(actor);
            return Clutter.EVENT_STOP;
        }

        const text = controller.entry.get_text();
        const problem = controller.validate ? controller.validate(text) : '';
        if (problem !== '') {
            setRenameMessage(controller, problem);
            return Clutter.EVENT_STOP;
        }

        const result = controller.onAccepted ? controller.onAccepted(text) : { ok: true };
        if (result && result.ok === false) {
            // The name passed validation and the filesystem still refused it, so the
            // reason comes from the operation rather than from validate.
            setRenameMessage(controller, result.message);
            return Clutter.EVENT_STOP;
        }

        endInlineRename(actor, { text: result?.name ?? text });
        return Clutter.EVENT_STOP;
    });

    return true;
}

// Drops the state a rename holds. Safe on a controller whose actors are already gone, so
// the node's teardown can call it without disconnecting signals that have disconnected
// themselves with the actor.
function abortInlineRename(controller) {
    if (!controller)
        return;
    if (controller.focusIdle) {
        GLib.Source.remove(controller.focusIdle);
        controller.focusIdle = 0;
    }
    controller.editing = false;
    controller.validate = null;
    controller.onAccepted = null;
}

/**
 * Stops renaming, leaving the label showing `text` when one was given.
 *
 * The name is applied to the label rather than left to the next resync because the icon
 * glyph is chosen from the file's name: a renamed .desktop file would keep the old glyph
 * until something rebuilt the node.
 */
function endInlineRename(actor, { text } = {}) {
    const controller = ICON_CONTROLLERS.get(actor);
    if (!controller || !controller.editing)
        return;

    controller.entry.clutter_text.disconnect(controller.onTextChanged);
    // From the same object it was connected to, or the handler is left on the text.
    controller.entry.clutter_text.disconnect(controller.onKeyPress);
    abortInlineRename(controller);

    controller.entry.hide();
    if (typeof text === 'string')
        controller.labelActor.text = clampText(text, LABEL_MAX_CHARS);
    controller.labelActor.show();
    setRenameMessage(controller, '');

    // Hand the keyboard back rather than leaving it on an actor that is about to be hidden.
    if (!isActorDestroyed(actor) && global.stage)
        global.stage.set_key_focus(null);
}

// A no-op for anything that is not a desktop icon, so the grid can sweep every node without
// knowing which are icons.
function setIconSelected(actor, isSelected) {
    const controller = ICON_CONTROLLERS.get(actor);
    if (!controller || isActorDestroyed(actor))
        return;

    controller.selected = isSelected;
    applyIconFrame(controller);
}

/**
 * Frames an icon under the pointer, more faintly than a selected one.
 *
 * Selection wins over hover: an icon that is selected and still under the pointer keeps the
 * selected frame, so moving the mouse across the desktop does not dim a chosen icon.
 */
export function setIconHovered(actor, isHovered) {
    const controller = ICON_CONTROLLERS.get(actor);
    if (!controller || isActorDestroyed(actor))
        return;

    controller.hovered = isHovered;
    applyIconFrame(controller);
}

// One selection across every grid. GNOME keys bindings by name and keeps the first
// registration, so the shortcuts are registered once for the whole extension; a selection
// held per grid would leave the key acting on whichever grid happened to register first,
// and two grids could each believe an icon was selected.
let selectedIcon = null;

const selectionListeners = new Set();

/**
 * Clears the selection without telling anyone. Returns whether there was one, so a caller
 * that is about to set a new selection notifies once rather than twice.
 */
function dropSelection() {
    if (!selectedIcon)
        return false;
    const { actor } = selectedIcon;
    selectedIcon = null;
    setIconSelected(actor, false);
    return true;
}

export function selectIcon(grid, actor, widgetData) {
    const hadSelection = dropSelection();
    // Only a desktop icon is selectable. Every other widget shares this handler, and the
    // keyboard shortcuts are registered process-wide, so recording one of those would let
    // F2 reach for a file that a weather widget has no name for.
    if (isDesktopIcon(widgetData)) {
        setIconSelected(actor, true);
        selectedIcon = { grid, actor, widgetData };
        // A rebuild destroys the node the selection points at, which is also how the
        // selection ends when the entry is deleted. The shortcuts are bound to it, so they
        // have to be released when it goes rather than left holding a dead actor.
        if (!SELECTION_TEARDOWNS.has(actor)) {
            SELECTION_TEARDOWNS.add(actor);
            registerWidgetCleanup(actor, () => {
                if (selectedIcon && selectedIcon.actor === actor)
                    clearIconSelection();
            });
        }
    }
    if (hadSelection || selectedIcon)
        notifySelectionChanged();
}

export function clearIconSelection() {
    if (dropSelection())
        notifySelectionChanged();
}

/**
 * Called with the new selection, or null when there is none. This is what the shortcuts
 * are bound to: Mutter only takes an accelerator from the rest of the session while a
 * binding for it exists, so leaving them unregistered is what keeps Ctrl+X, Ctrl+C and F2
 * working in the file manager and in text fields until an icon here is selected.
 */
export function onSelectionChanged(listener) {
    selectionListeners.add(listener);
    return () => selectionListeners.delete(listener);
}

function notifySelectionChanged() {
    for (const listener of selectionListeners)
        listener(selectedIcon);
}

/** The selected icon, or null once its node has gone. */
export function getSelectedIcon() {
    if (selectedIcon && isActorDestroyed(selectedIcon.actor))
        selectedIcon = null;
    return selectedIcon;
}

// Only a cut is dimmed: a copy leaves the file in place and has nothing to announce.
// Opacity is an unsigned byte, so a 0-1 fraction truncates to nothing.
const CUT_OPACITY = 0.4;
const NORMAL_OPACITY = 1.0;

function setOpacityFraction(actor, fraction) {
    actor.opacity = Math.round(255 * fraction);
}

// false restores full opacity, which is also how a previous cut is unmarked.
export function setClipboardEmphasis(actor, isCut) {
    if (isActorDestroyed(actor))
        return;
    setOpacityFraction(actor, isCut ? CUT_OPACITY : NORMAL_OPACITY);
}

// Read once at construction: St.Clipboard has no signals, and a throw here runs while
// the node is being created.
function applyInitialClipboardEmphasis(actor, uri) {
    isOnClipboard([uri], (onClipboard, isCut) => {
        if (onClipboard)
            setClipboardEmphasis(actor, isCut);
    });
}
