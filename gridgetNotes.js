/**
 * ============================================================================
 * STICKY NOTES WIDGET 
 * 
 * This module implements a simple sticky notes widget with limited Markdown support.
 * It handles persistent storage of notes to the disk and toggles between
 * a viewing mode and an editable text area.
 * ============================================================================
 */

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {
    loadJsonFromFile, saveJsonToFile,
    resolveWidgetForegroundColor, DEFAULT_FONT_FAMILY
} from './widgetUtils.js';
import {
    createWidgetContainer
} from './widgetUIUtils.js';

const DEFAULT_NOTE_TEXT = "📝 Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**";

function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);

    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    escaped = escaped.replace(/\*(.*?)\*/g, '<i>$1</i>');
    escaped = escaped.replace(/^- \[ \]/gm, '☐ ');
    escaped = escaped.replace(/^- \[x\]/gm, '☑ ');
    escaped = escaped.replace(/^### (.*$)/gm, '<span size="large" weight="bold">$1</span>');
    escaped = escaped.replace(/^## (.*$)/gm, '<span size="x-large" weight="bold">$1</span>');
    escaped = escaped.replace(/^# (.*$)/gm, '<span size="xx-large" weight="bold">$1</span>');

    return escaped;
}

export function createNotesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = config.fontFamily || DEFAULT_FONT_FAMILY;
    const textColor = resolveWidgetForegroundColor(config);

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const notesFilePath = `${config.extensionPath}/notes-${config.id}.json`;
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-weight: bold; font-size: 14px;`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        icon_size: 16,
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
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: 14px;`,
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
        font_name: 'sans-serif 14',
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
        y_expand: true,
    });
    editorContainer.add_child(textEditor);

    editorContainer.connect('style-changed', () => {
        const themeNode = editorContainer.get_theme_node();
        if (themeNode) {
            const color = themeNode.get_foreground_color();
            textEditor.set_color(color);
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
        if (event.get_button() === 1) {
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
