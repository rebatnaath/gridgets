import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile, saveJsonToFileSync } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, scheduleDeferredUpdate, attachButtonFeedback } from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const DEFAULT_NOTE_TEXT = 'Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**';
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 160;
const BASE_TITLE_FONT_SIZE = 14;
const BASE_CONTENT_FONT_SIZE = 14;
const BASE_ICON_SIZE = 16;
const MIN_FONT_SIZE = 11;
const MIN_ICON_SIZE = 13;
const BORDER_ALPHA = 0.14;
const MARKDOWN_RULES = [
    [/\*\*(.*?)\*\*/g, '<b>$1</b>'],
    [/\*(.*?)\*/g, '<i>$1</i>'],
    [/^- \[ \]/gm, '[ ] '],
    [/^- \[x\]/gm, '[x] '],
    [/^### (.*$)/gm, '<span size="large" weight="bold">$1</span>'],
    [/^## (.*$)/gm, '<span size="x-large" weight="bold">$1</span>'],
    [/^# (.*$)/gm, '<span size="xx-large" weight="bold">$1</span>'],
];

function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);
    for (const [regex, replacement] of MARKDOWN_RULES) {
        escaped = escaped.replace(regex, replacement);
    }
    return escaped;
}

export function createNotesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);
    const titleFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));
    const contentFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_CONTENT_FONT_SIZE * scale));
    const iconSize = Math.max(MIN_ICON_SIZE, Math.round(BASE_ICON_SIZE * scale));

    const baseDir = getGridgetsDataDir('notes');
    const notesFilePath = GLib.build_filenamev([
        baseDir,
        `notes-${config.id}.json`
    ]);

    let noteContent = DEFAULT_NOTE_TEXT;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
    });

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: 'margin-bottom: 8px;',
    });

    const titleLabel = new St.Label({
        text: 'Quick Notes',
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: ${SECONDARY_OPACITY};`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        icon_size: iconSize,
        style: `color: ${textColor}; opacity: 0.6;`,
    });

    const editButton = new St.Button({
        child: editIcon,
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(titleLabel);
    headerBox.add_child(editButton);
    attachButtonFeedback(editButton);
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

    const scrollContent = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_child(scrollContent);
    contentBox.add_child(scrollView);

    const displayLabel = new St.Label({
        style: `${fontCss}color: ${textColor}; font-size: ${contentFontSize}px;`,
        x_expand: true,
        y_expand: true,
    });
    displayLabel.clutter_text.line_wrap = true;
    displayLabel.clutter_text.use_markup = true;

    const editorContainer = new St.BoxLayout({
        style: `color: ${textColor};`,
        x_expand: true,
        y_expand: true,
    });

    const textEditor = new Clutter.Text({
        font_name: `${fontFamily ? `${fontFamily} ` : ''}${contentFontSize}px`,
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
        y_expand: true,
    });
    editorContainer.add_child(textEditor);

    editorContainer.connect('style-changed', () => {
        if (isActorDestroyed(container) || !editorContainer.get_stage()) return;
        textEditor.set_color(editorContainer.get_theme_node().get_foreground_color());
    });

    let isEditingActive = false;
    const state = { deferredUpdateId: null };
    scrollContent.add_child(displayLabel);
    scrollContent.add_child(editorContainer);

    const showNoteViewer = () => {
        if (global.stage.get_key_focus() === textEditor) {
            global.stage.set_key_focus(null);
        }
        displayLabel.clutter_text.set_markup(convertMarkdownToPango(noteContent));
        editorContainer.hide();
        displayLabel.show();
        editIcon.set_icon_name('document-edit-symbolic');
        isEditingActive = false;
    };

    const showNoteEditor = () => {
        textEditor.text = noteContent;
        displayLabel.hide();
        editorContainer.show();
        global.stage.set_key_focus(textEditor);
        editIcon.set_icon_name('object-select-symbolic');
        isEditingActive = true;
    };

    textEditor.connect('text-changed', () => {
        if (isEditingActive) {
            noteContent = textEditor.text;
            scheduleDeferredUpdate(state, 500, () => saveJsonToFile(notesFilePath, { notes: noteContent }));
        }
    });

    registerWidgetCleanup(container, () => {
        if (state.deferredUpdateId) {
            GLib.Source.remove(state.deferredUpdateId);
            state.deferredUpdateId = null;
        }
        if (isEditingActive) {
            noteContent = textEditor.text;
            saveJsonToFileSync(notesFilePath, { notes: noteContent });
            if (global.stage.get_key_focus() === textEditor) {
                global.stage.set_key_focus(null);
            }
        }
    });

    editButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            if (isEditingActive) {
                noteContent = textEditor.text;
                showNoteViewer();
                saveJsonToFile(notesFilePath, { notes: noteContent });
            } else {
                showNoteEditor();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    showNoteViewer();
    container.add_child(contentBox);

    loadJsonFromFileAsync(notesFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && savedData.notes !== undefined) {
            noteContent = savedData.notes;
            if (!isEditingActive) {
                showNoteViewer();
            }
        } else if (!loadError) {
            saveJsonToFile(notesFilePath, { notes: noteContent });
        }
    });

    return container;
}
