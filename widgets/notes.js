/**
 * ============================================================================
 * STICKY NOTES WIDGET
 * 
 * Sticky notes widget supporting basic Markdown rendering (bold, italic, checkboxes,
 * headers). Persists notes to JSON on disk and toggles viewing/editing states.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    loadJsonFromFile,
    saveJsonToFile,
    resolveWidgetForegroundColor,
    resolveWidgetFontFamily
} from '../utils/widgetUtils.js';
import { createWidgetContainer } from '../utils/widgetUIUtils.js';

/** Default placeholder content */
const DEFAULT_NOTE_TEXT = '📝 Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**';

/** Layout & scaling metrics */
const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 160;
const BASE_TITLE_FONT_SIZE = 14;
const BASE_CONTENT_FONT_SIZE = 14;
const BASE_ICON_SIZE = 16;
const MIN_FONT_SIZE = 11;
const MIN_ICON_SIZE = 13;

/** Mouse button constants */
const BUTTON_PRIMARY = 1;

/** Markdown replacement rules (Pattern -> Replacement) */
const MARKDOWN_RULES = [
    [/\*\*(.*?)\*\*/g, '<b>$1</b>'],
    [/\*(.*?)\*/g, '<i>$1</i>'],
    [/^- \[ \]/gm, '☐ '],
    [/^- \[x\]/gm, '☑ '],
    [/^### (.*$)/gm, '<span size="large" weight="bold">$1</span>'],
    [/^## (.*$)/gm, '<span size="x-large" weight="bold">$1</span>'],
    [/^# (.*$)/gm, '<span size="xx-large" weight="bold">$1</span>'],
];

/** Converts plain text markdown into Pango markup XML string. */
function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);
    for (const [regex, replacement] of MARKDOWN_RULES) {
        escaped = escaped.replace(regex, replacement);
    }
    return escaped;
}

/** Creates a sticky note widget node. */
export function createNotesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveWidgetFontFamily(config);
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let isDestroyed = false;

    const scale = Math.max(0.5, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const titleFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));
    const contentFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_CONTENT_FONT_SIZE * scale));
    const iconSize = Math.max(MIN_ICON_SIZE, Math.round(BASE_ICON_SIZE * scale));

    const notesFilePath = GLib.build_filenamev([
        config.extensionPath || '',
        `notes-${config.id}.json`
    ]);

    const savedData = loadJsonFromFile(notesFilePath);
    let noteContent = (savedData && savedData.notes !== undefined) ? savedData.notes : DEFAULT_NOTE_TEXT;

    const contentBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
    });

    const headerBox = new St.BoxLayout({
        vertical: false,
        style: 'margin-bottom: 8px;',
    });

    const titleLabel = new St.Label({
        text: 'Quick Notes',
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: ${titleFontSize}px;`,
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
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

    const scrollContent = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_child(scrollContent);
    contentBox.add_child(scrollView);

    const displayLabel = new St.Label({
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${contentFontSize}px;`,
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
        font_name: `${fontFamily} ${contentFontSize}px`,
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
        y_expand: true,
    });
    editorContainer.add_child(textEditor);

    const styleChangedSignalId = editorContainer.connect('style-changed', () => {
        if (isDestroyed) return;
        const themeNode = editorContainer.get_theme_node();
        if (themeNode) {
            textEditor.set_color(themeNode.get_foreground_color());
        }
    });

    container.connect('destroy', () => {
        isDestroyed = true;
        if (styleChangedSignalId) {
            editorContainer.disconnect(styleChangedSignalId);
        }
    });

    let isEditingActive = false;
    scrollContent.add_child(displayLabel);
    scrollContent.add_child(editorContainer);

    const showNoteViewer = () => {
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
        textEditor.grab_key_focus();
        editIcon.set_icon_name('object-select-symbolic');
        isEditingActive = true;
    };

    editButton.connect('button-press-event', (actor, event) => {
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

    return container;
}
