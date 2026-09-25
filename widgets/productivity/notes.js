import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetColors, resolveWidgetForegroundColor, saveJsonToFile, saveJsonToFileSync } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, ICON_OPACITY_SECONDARY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, scheduleDeferredUpdate, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const DEFAULT_NOTE_TEXT = 'Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**';
const BASE_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const BASE_CONTENT_FONT_SIZE = TYPOGRAPHY_SIZE.body;
const BASE_ICON_SIZE = 16;
const MARKDOWN_RULES = [
    [/\*\*(.*?)\*\*/g, '<b>$1</b>'],
    [/\*(.*?)\*/g, '<i>$1</i>'],
    [/^- \[ \]/gm, '[ ] '],
    [/^- \[x\]/gm, '[x] '],
    [/^### (.*$)/gm, '<b>$1</b>'],
    [/^## (.*$)/gm, '<b>$1</b>'],
    [/^# (.*$)/gm, '<b>$1</b>'],
];

const CONTENT_PADDING_PX = 12;
const HEADER_PADDING_V_PX = 10;
const HEADER_PADDING_H_PX = 14;
const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 160;

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
    const { subtleBackground } = resolveWidgetColors(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

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
    });

    const borderRadius = config.appliedBorderRadius || 0;
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
        style: `padding: ${HEADER_PADDING_V_PX}px ${HEADER_PADDING_H_PX}px;`
            + `background-color: ${subtleBackground};`
            + `border-radius: ${borderRadius}px ${borderRadius}px 0 0;`,
    });

    const titleLabel = new St.Label({
        text: 'Quick Notes',
        style: `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        style: `color: ${textColor}; opacity: ${ICON_OPACITY_SECONDARY};`,
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
    const scrollArea = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${CONTENT_PADDING_PX}px;`,
    });
    scrollArea.add_child(scrollView);
    contentBox.add_child(scrollArea);

    const displayLabel = new St.Label({
        style: `${fontCss}color: ${textColor};`,
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

    let textEditor = new Clutter.Text({
        font_name: fontFamily ? `${fontFamily} ` : '',
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
        y_expand: true,
    });
    editorContainer.add_child(textEditor);

    editorContainer.connect('style-changed', () => {
        if (!editorContainer.get_stage()) return;
        textEditor.set_color(editorContainer.get_theme_node().get_foreground_color());
    });

    let isEditingActive = false;
    let lastContentFontSize = null;
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

    function applyScale(scale) {
        const titleFontSize = scaleFontSize(BASE_TITLE_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle);
        const contentFontSize = scaleFontSize(BASE_CONTENT_FONT_SIZE, scale, MIN_FONT_SIZE.body);
        const iconSize = Math.max(1, Math.round(BASE_ICON_SIZE * scale));

        titleLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`);
        editIcon.set_icon_size(iconSize);
        displayLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${contentFontSize}px;`);

        // Rebuilding the editor churns the text buffer and drops key focus, and
        // the scaler fires on both width and height changes. Only the font size
        // affects the rebuild, so skip it when that has not actually changed.
        if (contentFontSize === lastContentFontSize) return;
        lastContentFontSize = contentFontSize;

        const currentText = textEditor.text;
        const wasEditing = isEditingActive;
        editorContainer.remove_child(textEditor);
        textEditor.destroy();
        const newEditor = new Clutter.Text({
            font_name: `${fontFamily ? `${fontFamily} ` : ''}${contentFontSize}px`,
            editable: true,
            selectable: true,
            reactive: true,
            line_wrap: true,
            x_expand: true,
            y_expand: true,
        });
        editorContainer.add_child(newEditor);
        newEditor.text = currentText;
        if (editorContainer.get_stage())
            newEditor.set_color(editorContainer.get_theme_node().get_foreground_color());
        newEditor.connect('text-changed', () => {
            if (isEditingActive) {
                noteContent = newEditor.text;
                scheduleDeferredUpdate(state, 500, () => saveJsonToFile(notesFilePath, { notes: noteContent }));
            }
        });
        textEditor = newEditor;
        if (wasEditing) {
            global.stage.set_key_focus(textEditor);
        }
    }

    applyScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyScale(scale);
    });

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
