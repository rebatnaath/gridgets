import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveAccentColor, cssColorToRgba, resolveWidgetCornerRadius, saveJsonToFile, saveJsonToFileSync, resolveChildCornerRadius } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, ICON_OPACITY_SECONDARY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { relativeTimeFromIso } from '../../utils/feedText.js';
import { createWidgetContainer, registerWidgetCleanup, connectTimerCleanup, scheduleDeferredUpdate, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_HEADER_FONT_SIZE = TYPOGRAPHY_SIZE.label;
const BASE_TITLE_FONT_SIZE = 24;
const BASE_CONTENT_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
const BASE_FOOTER_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_ICON_SIZE = 16;
const BASE_SWATCH_SIZE = 22;
const BASE_EDIT_BUTTON_SIZE = 34;
// The menu and close glyphs need a little more presence than the in-card edit icon.
const BASE_MENU_ICON_SIZE = 18;
const BASE_PANEL_CLOSE_ICON_SIZE = 20;

// The slide-in note list borrows the clipboard's shape: a header, then pinned and recent
// sections, each row a title with its age and a pin toggle.
const BASE_PANEL_PADDING_PX = 16;
const BASE_PANEL_SPACING_PX = 12;
const BASE_PANEL_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.title;
const BASE_PANEL_ROW_FONT_SIZE = TYPOGRAPHY_SIZE.label;
const BASE_PANEL_PREVIEW_FONT_SIZE = TYPOGRAPHY_SIZE.compact;
const BASE_PANEL_META_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_PANEL_SECTION_FONT_SIZE = TYPOGRAPHY_SIZE.metadata;
const BASE_PANEL_ROW_PADDING_V_PX = 10;
const BASE_PANEL_ROW_PADDING_H_PX = 12;
const BASE_PANEL_ROW_RADIUS_PX = 14;
// Each row leads with a coloured tile carrying the title's initial, the same stand-in the
// news grid uses when a thumbnail is missing.
const BASE_PANEL_TILE_SIZE_PX = 34;
const BASE_PANEL_TILE_LETTER_RATIO = 0.5;
// Keep the corner proportional to the tile. resolveChildCornerRadius grows its result as the
// widget shrinks, which would round a small tile all the way into a circle.
const BASE_PANEL_TILE_CORNER_RATIO = 0.28;
const BASE_PANEL_PIN_SIZE_PX = 16;
const BASE_PANEL_ICON_BUTTON_PX = 34;
const BASE_PANEL_ICON_SIZE_PX = 16;
const PANEL_ANIMATION_MS = 220;
const PIN_HOVER_ALPHA = 0.18;
// The new-note button carries a filled accent tint; other panel buttons rest on a plain surface.
const ACCENT_BUTTON_ALPHA = 0.30;
const PANEL_ACTION_HOVER_ALPHA = 0.10;
// The open note's row picks up a faint accent wash so it reads apart from the plain rows.
const ACTIVE_ROW_ALPHA = 0.16;
const ACTIVE_ROW_HOVER_ALPHA = 0.24;

const NOTE_PALETTE = Object.freeze([
    { id: 'yellow', color: '#F6D77A' },
    { id: 'pink', color: '#FF9FC4' },
    { id: 'blue', color: '#8FC4FF' },
    { id: 'green', color: '#8FE0B0' },
]);
const DEFAULT_NOTE_COLOR_ID = 'yellow';
const NOTE_TEXT_COLOR = '#2B2410';
// A translucent tint of the note's own ink, so the edit button reads on every palette colour.
const NOTE_EDIT_BUTTON_BG = 'rgba(43, 36, 16, 0.12)';
const NOTE_SWATCH_RING = 'rgba(255, 255, 255, 0.92)';

const MARKDOWN_RULES = [
    // Link text is kept and the URL dropped: St.Label has no activate-link signal, so a
    // rendered <a> would look clickable without doing anything. The label is underlined
    // instead, and a bare URL is underlined where it stands.
    [/\[([^\]]+)\]\(([^)]+)\)/g, '<u>$1</u>'],
    [/(https?:\/\/[^\s<]+)/g, '<u>$1</u>'],
    // Ahead of the bold and italic rules, which would otherwise each match half of a
    // ***span*** and cross the tags, which pango rejects.
    [/\*{3,}(.*?)\*{3,}/g, '<b><i>$1</i></b>'],
    [/\*\*(.*?)\*\*/g, '<b>$1</b>'],
    [/\*(.*?)\*/g, '<i>$1</i>'],
    [/~~(.*?)~~/g, '<s>$1</s>'],
    [/^#{1,6}\s+(.*$)/gm, '<b>$1</b>'],
    [/^- \[ \]\s*/gm, '[ ] '],
    [/^- \[[xX]\]\s*/gm, '[x] '],
    [/^[-*+] (.*$)/gm, '• $1'],
    // markup_escape_text has already turned the leading ">" into "&gt;".
    [/^&gt; (.*$)/gm, '<i>$1</i>'],
];

// The mockup card is 340x420 logical (a portrait sticky), so the scaler normalises to that.
const REF_WIDTH_PX = 340;
const REF_HEIGHT_PX = 420;
const BASE_CONTENT_PADDING_PX = 14;
const BASE_CARD_PADDING_PX = 14;
const BASE_CARD_RADIUS_PX = 16;
const BASE_CARD_SPACING_PX = 10;
const BASE_COLOR_ROW_GAP_PX = 8;
const BASE_SWATCH_GAP_PX = 8;
const CLUTTER_OPACITY_OPAQUE = 255;

function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);

    const codeSpans = [];
    // Pull inline code out first so the emphasis and list rules cannot rewrite what is
    // inside it, then paste it back once they have run.
    escaped = escaped.replace(/`([^`]+)`/g, (_match, code) => {
        codeSpans.push(`<span font_family="monospace">${code}</span>`);
        return `\u0000${codeSpans.length - 1}\u0000`;
    });

    for (const [regex, replacement] of MARKDOWN_RULES) {
        escaped = escaped.replace(regex, replacement);
    }

    return escaped.replace(/\u0000(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)]);
}

function stripTitleMarkup(line) {
    return line
        .replace(/^#{1,6}\s*/, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .trim();
}

// The first non-blank line reads as the note's heading; everything after it is body.
function splitNote(text) {
    const lines = text.split('\n');
    let index = 0;
    while (index < lines.length && lines[index].trim() === '') index++;
    const title = index < lines.length ? stripTitleMarkup(lines[index]) : '';
    const body = lines.slice(index + 1).join('\n').replace(/^\n+/, '');
    return { title, body };
}

function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatNoteDate(unixSeconds) {
    const dateTime = unixSeconds > 0
        ? GLib.DateTime.new_from_unix_local(unixSeconds)
        : GLib.DateTime.new_now_local();
    return dateTime.format('%e %b').trim();
}

function resolveNoteColor(colorId) {
    return NOTE_PALETTE.find(entry => entry.id === colorId) || NOTE_PALETTE[0];
}

function generateNoteId() {
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Compact "5m ago"/"now" label for a stored timestamp; empty when it is not a number. */
function relativeNoteTime(timestamp) {
    if (!Number.isFinite(timestamp))
        return '';
    // Notes store unix seconds; Date wants milliseconds.
    return relativeTimeFromIso(new Date(timestamp * 1000).toISOString(), { compact: true });
}

/** The heading shown in the list; an untitled note still needs a clickable label. */
function noteTitle(note) {
    const title = splitNote(note.content).title;
    return title.length > 0 ? title : 'Untitled';
}

/** The letter shown on the note's colour tile; falls back to '?' for an untitled note. */
function noteInitial(note) {
    const title = splitNote(note.content).title.trim();
    return title.length > 0 ? title[0].toUpperCase() : '?';
}

/** The note's first body line, shown under the title as a one-line preview. */
function notePreview(note) {
    const { body } = splitNote(note.content);
    const line = body.split('\n').find(candidate => candidate.trim().length > 0) || '';
    return stripTitleMarkup(line);
}

export function createNotesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const themeTextColor = resolveWidgetForegroundColor(config);
    const { card: surfaceCard, highlight: surfaceHighlight } = resolveWidgetSurfaces(config);
    // The panel sits on the widget's own background so its rows, drawn in `card`, stand out
    // the same way the clipboard's rows do.
    const surfaceBackground = resolveWidgetBackgroundColor(config);
    const accentHex = resolveAccentColor(config);
    const containerRadius = resolveWidgetCornerRadius(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const baseDir = getGridgetsDataDir('notes');
    const notesFilePath = GLib.build_filenamev([baseDir, `notes-${config.id}.json`]);

    // Working copy of the active note; synced into state.notes whenever it is saved.
    let noteContent = '';
    let noteColorId = DEFAULT_NOTE_COLOR_ID;
    let noteUpdatedAt = 0;
    let isEditingActive = false;
    let currentScale = 1;
    let lastEditorFontSize = null;
    let panelOpen = false;

    // One widget now owns many notes, so the file holds the whole list plus which one is open.
    const state = { notes: [], activeNoteId: null, deferredUpdateId: null };

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const noteCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });

    const headerLabel = new St.Label({
        text: 'QUICK NOTES',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const editButton = new St.Button({
        child: editIcon,
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    attachButtonFeedback(editButton);

    headerBox.add_child(headerLabel);
    headerBox.add_child(editButton);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    // EXTERNAL keeps the adjustment live (wheel scrolling and the vfade still work) without
    // drawing a scrollbar, so text flows downward and the writing area never reflows.
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);

    const scrollContent = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const titleView = new St.Label({ x_expand: true });
    titleView.clutter_text.line_wrap = true;

    const bodyView = new St.Label({ x_expand: true });
    bodyView.clutter_text.line_wrap = true;
    bodyView.clutter_text.use_markup = true;

    // BinLayout overlays the hint and editor, and its preferred size keeps the editor tall
    // enough to be visible. It centres non-expanding children regardless of x_align/y_align,
    // so the placeholder expands and then aligns itself to the start to sit on the first line.
    const editorContainer = new St.Widget({
        x_expand: true,
        y_expand: true,
    });
    editorContainer.set_layout_manager(new Clutter.BinLayout());

    const titleHint = new St.Label({
        text: 'Title',
        x_expand: true,
        y_expand: true,
    });
    titleHint.set_x_align(Clutter.ActorAlign.START);
    titleHint.set_y_align(Clutter.ActorAlign.START);

    let textEditor = new Clutter.Text({
        font_name: fontFamily ? `${fontFamily} ` : '',
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
        y_expand: true,
    });

    editorContainer.add_child(titleHint);
    editorContainer.add_child(textEditor);
    wireEditor(textEditor);

    editorContainer.connect('style-changed', () => {
        applyEditorColors(textEditor);
    });

    scrollContent.add_child(titleView);
    scrollContent.add_child(bodyView);
    scrollContent.add_child(editorContainer);
    scrollView.set_child(scrollContent);

    const scrollArea = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    scrollArea.add_child(scrollView);

    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const metaLabel = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.START });
    const statusLabel = new St.Label({ x_align: Clutter.ActorAlign.END });
    footerBox.add_child(metaLabel);
    footerBox.add_child(statusLabel);

    noteCard.add_child(headerBox);
    noteCard.add_child(scrollArea);
    noteCard.add_child(footerBox);

    const colorRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });

    // The hamburger replaces the old "Note colour" caption and opens the note list.
    const menuIcon = new St.Icon({
        icon_name: 'open-menu-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const menuButton = new St.Button({
        child: menuIcon,
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    attachButtonFeedback(menuButton);
    menuButton.connect('enter-event', () => {
        menuButton.set_style(menuButtonStyle(true));
        return Clutter.EVENT_PROPAGATE;
    });
    menuButton.connect('leave-event', () => {
        menuButton.set_style(menuButtonStyle(false));
        return Clutter.EVENT_PROPAGATE;
    });
    menuButton.connect('clicked', () => openPanel());

    const swatchBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    colorRow.add_child(menuButton);
    colorRow.add_child(swatchBox);

    const swatches = NOTE_PALETTE.map((entry) => {
        const button = new St.Button({ can_focus: true, reactive: true });
        button.connect('clicked', () => {
            noteColorId = entry.id;
            // Persist before restyle so the list's colour dot reads the new palette id.
            persistNote();
            restyle(currentScale);
        });
        swatchBox.add_child(button);
        return { id: entry.id, button };
    });

    contentBox.add_child(noteCard);
    contentBox.add_child(colorRow);
    container.add_child(contentBox);

    // The list rides on top of the card in the same BinLayout and slides in from the right.
    const menuPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        reactive: true,
    });
    menuPanel.translation_x = width;
    menuPanel.reactive = false;

    const panelHeader = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const panelTitleLabel = new St.Label({
        text: 'Notes',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const panelCountLabel = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    // Pushes the action buttons to the far right of the header, past the count pill.
    const panelHeaderSpacer = new St.BoxLayout({ x_expand: true });

    const newNoteButton = new St.Button({
        child: new St.Icon({ icon_name: 'list-add-symbolic' }),
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const closePanelButton = new St.Button({
        child: new St.Icon({ icon_name: 'window-close-symbolic' }),
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    attachButtonFeedback(newNoteButton);
    attachButtonFeedback(closePanelButton);
    // The + button is filled with the accent; the close button rests on a plain surface.
    newNoteButton.connect('enter-event', () => {
        newNoteButton.set_style(panelIconButtonStyle(true, true));
        return Clutter.EVENT_PROPAGATE;
    });
    newNoteButton.connect('leave-event', () => {
        newNoteButton.set_style(panelIconButtonStyle(false, true));
        return Clutter.EVENT_PROPAGATE;
    });
    closePanelButton.connect('enter-event', () => {
        closePanelButton.set_style(panelIconButtonStyle(true, false));
        return Clutter.EVENT_PROPAGATE;
    });
    closePanelButton.connect('leave-event', () => {
        closePanelButton.set_style(panelIconButtonStyle(false, false));
        return Clutter.EVENT_PROPAGATE;
    });
    newNoteButton.connect('clicked', () => createNewNote());
    closePanelButton.connect('clicked', () => closePanel());

    panelHeader.add_child(panelTitleLabel);
    panelHeader.add_child(panelCountLabel);
    panelHeader.add_child(panelHeaderSpacer);
    panelHeader.add_child(newNoteButton);
    panelHeader.add_child(closePanelButton);

    const noteListScroll = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    noteListScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    const noteListBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    noteListScroll.set_child(noteListBox);

    menuPanel.add_child(panelHeader);
    menuPanel.add_child(noteListScroll);
    container.add_child(menuPanel);

    function cardMetrics(scale) {
        return {
            contentPadding: Math.round(BASE_CONTENT_PADDING_PX * scale),
            cardPadding: Math.round(BASE_CARD_PADDING_PX * scale),
            cardRadius: resolveChildCornerRadius(BASE_CARD_RADIUS_PX, scale),
            cardSpacing: Math.round(BASE_CARD_SPACING_PX * scale),
            cardGap: Math.round(BASE_CARD_SPACING_PX * scale),
            colorRowGap: Math.round(BASE_COLOR_ROW_GAP_PX * scale),
            swatchGap: Math.round(BASE_SWATCH_GAP_PX * scale),
            swatchSize: Math.round(BASE_SWATCH_SIZE * scale),
            editButtonSize: Math.round(BASE_EDIT_BUTTON_SIZE * scale),
            headerFontSize: scaleFontSize(BASE_HEADER_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            titleFontSize: scaleFontSize(BASE_TITLE_FONT_SIZE, scale, MIN_FONT_SIZE.title),
            contentFontSize: scaleFontSize(BASE_CONTENT_FONT_SIZE, scale, MIN_FONT_SIZE.body),
            footerFontSize: scaleFontSize(BASE_FOOTER_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            iconSize: scaleFontSize(BASE_ICON_SIZE, scale),
            menuIconSize: scaleFontSize(BASE_MENU_ICON_SIZE, scale),
            menuButtonSize: Math.round(BASE_EDIT_BUTTON_SIZE * scale),
            panelPadding: Math.round(BASE_PANEL_PADDING_PX * scale),
            panelSpacing: Math.round(BASE_PANEL_SPACING_PX * scale),
            panelTitleFontSize: scaleFontSize(BASE_PANEL_TITLE_FONT_SIZE, scale, MIN_FONT_SIZE.title),
            panelRowFontSize: scaleFontSize(BASE_PANEL_ROW_FONT_SIZE, scale, MIN_FONT_SIZE.label),
            panelPreviewFontSize: scaleFontSize(BASE_PANEL_PREVIEW_FONT_SIZE, scale, MIN_FONT_SIZE.label),
            panelMetaFontSize: scaleFontSize(BASE_PANEL_META_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            panelSectionFontSize: scaleFontSize(BASE_PANEL_SECTION_FONT_SIZE, scale, MIN_FONT_SIZE.metadata),
            panelRowPaddingV: scaleFontSize(BASE_PANEL_ROW_PADDING_V_PX, scale),
            panelRowPaddingH: scaleFontSize(BASE_PANEL_ROW_PADDING_H_PX, scale),
            panelRowRadius: resolveChildCornerRadius(BASE_PANEL_ROW_RADIUS_PX, scale),
            panelTileSize: Math.round(BASE_PANEL_TILE_SIZE_PX * scale),
            panelTileRadius: Math.max(2, Math.round(BASE_PANEL_TILE_SIZE_PX * scale * BASE_PANEL_TILE_CORNER_RATIO)),
            panelTileFontSize: Math.max(1, Math.round(BASE_PANEL_TILE_SIZE_PX * scale * BASE_PANEL_TILE_LETTER_RATIO)),
            panelPinSize: scaleFontSize(BASE_PANEL_PIN_SIZE_PX, scale),
            panelIconButtonSize: Math.round(BASE_PANEL_ICON_BUTTON_PX * scale),
            panelIconSize: scaleFontSize(BASE_PANEL_ICON_SIZE_PX, scale),
            panelCloseIconSize: scaleFontSize(BASE_PANEL_CLOSE_ICON_SIZE, scale),
        };
    }

    function menuButtonStyle(hovered) {
        return `background-color: ${hovered ? surfaceHighlight : 'transparent'};`
            + `border-radius: ${Math.round(metrics.menuButtonSize * 0.32)}px;`
            + `padding: 0;`
            + `width: ${metrics.menuButtonSize}px; height: ${metrics.menuButtonSize}px;`;
    }

    function panelIconButtonStyle(hovered, tinted) {
        const background = tinted
            ? cssColorToRgba(accentHex, hovered ? ACCENT_BUTTON_ALPHA + PANEL_ACTION_HOVER_ALPHA : ACCENT_BUTTON_ALPHA)
            : (hovered ? cssColorToRgba(accentHex, PANEL_ACTION_HOVER_ALPHA) : surfaceHighlight);
        return `background-color: ${background};`
            + `border-radius: ${Math.round(metrics.panelIconButtonSize * 0.32)}px;`
            + `padding: 0;`
            + `width: ${metrics.panelIconButtonSize}px; height: ${metrics.panelIconButtonSize}px;`;
    }

    function refreshFooter() {
        metaLabel.set_text(`${formatNoteDate(noteUpdatedAt)} · ${countWords(noteContent)} words`);
        statusLabel.set_text(isEditingActive ? 'editing' : 'saved');
    }

    // The placeholder only belongs on an empty first line while editing, so the writer can see
    // where the title goes without it lingering over a filled-in note.
    function refreshTitleHint() {
        titleHint.visible = isEditingActive && splitNote(noteContent).title.length === 0;
    }

    let metrics = cardMetrics(currentScale);

    function restyle(scale) {
        currentScale = scale;
        metrics = cardMetrics(scale);
        const palette = resolveNoteColor(noteColorId);

        contentBox.set_style(`padding: ${metrics.contentPadding}px; spacing: ${metrics.cardGap}px;`);

        noteCard.set_style(
            `background-color: ${palette.color};`
            + `border-radius: ${metrics.cardRadius}px;`
            + `padding: ${metrics.cardPadding}px;`
            + `spacing: ${metrics.cardSpacing}px;`);

        headerBox.set_style(`spacing: ${metrics.cardSpacing}px;`);
        headerLabel.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.headerFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`);
        headerLabel.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata));

        editButton.set_style(
            `background-color: ${NOTE_EDIT_BUTTON_BG};`
            + `border-radius: ${Math.round(metrics.editButtonSize * 0.32)}px;`
            + `padding: 0;`
            + `width: ${metrics.editButtonSize}px; height: ${metrics.editButtonSize}px;`);
        editIcon.set_icon_size(metrics.iconSize);
        editIcon.set_style(`color: ${NOTE_TEXT_COLOR};`);
        editIcon.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * ICON_OPACITY_SECONDARY));

        titleView.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.titleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; font-style: italic;`);
        bodyView.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.contentFontSize}px;`);

        metaLabel.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.footerFontSize}px;`);
        metaLabel.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary));
        statusLabel.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.footerFontSize}px;`);
        statusLabel.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary));

        colorRow.set_style(`spacing: ${metrics.colorRowGap}px;`);
        menuButton.set_style(menuButtonStyle(false));
        menuIcon.set_icon_size(metrics.menuIconSize);
        menuIcon.set_style(`color: ${themeTextColor};`);
        menuIcon.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * ICON_OPACITY_SECONDARY));
        swatchBox.set_style(`spacing: ${metrics.swatchGap}px;`);
        for (const swatch of swatches) {
            const selected = swatch.id === noteColorId;
            swatch.button.set_style(
                `background-color: ${resolveNoteColor(swatch.id).color};`
                + `border-radius: 999px;`
                + `padding: 0;`
                + `border: 2px solid ${selected ? NOTE_SWATCH_RING : 'transparent'};`
                + `width: ${metrics.swatchSize}px; height: ${metrics.swatchSize}px;`);
        }

        editorContainer.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR};`);
        titleHint.set_style(`${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.contentFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; font-style: italic;`);
        titleHint.set_opacity(Math.round(CLUTTER_OPACITY_OPAQUE * 0.4));
        applyEditorFontSize(metrics.contentFontSize);
        refreshTitleHint();

        menuPanel.set_style(
            `background-color: ${surfaceBackground};`
            + `border-radius: ${containerRadius}px;`
            + `padding: ${metrics.panelPadding}px;`
            + `spacing: ${metrics.panelSpacing}px;`);
        panelHeader.set_style(`spacing: ${metrics.panelSpacing}px;`);
        panelTitleLabel.set_style(`${fontCss}color: ${themeTextColor}; font-size: ${metrics.panelTitleFontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold};`);
        panelCountLabel.set_style(
            `background-color: ${surfaceHighlight};`
            + `border-radius: ${Math.round(metrics.panelMetaFontSize * 0.9)}px;`
            + `padding: ${Math.round(3 * currentScale)}px ${Math.round(8 * currentScale)}px;`
            + `${fontCss}color: ${themeTextColor}; font-size: ${metrics.panelMetaFontSize}px;`);
        panelCountLabel.set_opacity(CLUTTER_OPACITY_OPAQUE);
        newNoteButton.set_style(panelIconButtonStyle(false, true));
        closePanelButton.set_style(panelIconButtonStyle(false, false));
        newNoteButton.child.set_style(`color: ${themeTextColor};`);
        closePanelButton.child.set_style(`color: ${themeTextColor};`);
        newNoteButton.child.set_opacity(CLUTTER_OPACITY_OPAQUE);
        closePanelButton.child.set_opacity(CLUTTER_OPACITY_OPAQUE);
        newNoteButton.child.set_icon_size(metrics.panelIconSize);
        closePanelButton.child.set_icon_size(metrics.panelCloseIconSize);
        noteListBox.set_style(`spacing: ${metrics.panelSpacing}px;`);
        if (!panelOpen)
            menuPanel.translation_x = container.get_width() || width;
        renderNoteList();
    }

    function makeNote(content = '') {
        return {
            id: generateNoteId(),
            content,
            color: DEFAULT_NOTE_COLOR_ID,
            pinned: false,
            updatedAt: Math.floor(GLib.get_real_time() / 1000000),
        };
    }

    /** Coerce one stored entry; anything without text is dropped rather than shown blank. */
    function normalizeStoredNote(entry) {
        if (!entry || typeof entry.content !== 'string')
            return null;
        return {
            id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : generateNoteId(),
            content: entry.content,
            color: resolveNoteColor(entry.color).id,
            pinned: entry.pinned === true,
            updatedAt: Number.isFinite(entry.updatedAt)
                ? entry.updatedAt
                : Math.floor(GLib.get_real_time() / 1000000),
        };
    }

    function getActiveNote() {
        return state.notes.find(note => note.id === state.activeNoteId) || state.notes[0] || null;
    }

    function syncActiveFromState() {
        const note = getActiveNote();
        if (!note)
            return;
        noteContent = note.content;
        noteColorId = note.color;
        noteUpdatedAt = note.updatedAt;
    }

    function syncStateFromActive() {
        const note = getActiveNote();
        if (!note)
            return;
        note.content = noteContent;
        note.color = noteColorId;
        note.updatedAt = noteUpdatedAt;
    }

    function persistState() {
        saveJsonToFile(notesFilePath, { notes: state.notes, activeNoteId: state.activeNoteId });
    }

    function persistNote() {
        syncStateFromActive();
        persistState();
    }

    function openPanel() {
        if (panelOpen) return;
        panelOpen = true;
        if (global.stage.get_key_focus() === textEditor)
            global.stage.set_key_focus(null);
        renderNoteList();
        menuPanel.translation_x = container.get_width() || width;
        menuPanel.reactive = true;
        menuPanel.ease({
            translation_x: 0,
            duration: PANEL_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    function closePanel() {
        if (!panelOpen) return;
        panelOpen = false;
        menuPanel.reactive = false;
        menuPanel.ease({
            translation_x: container.get_width() || width,
            duration: PANEL_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    function selectNote(noteId) {
        if (noteId === state.activeNoteId) {
            closePanel();
            return;
        }
        // Deferred: rebuilding the list destroys this row while its click is still emitting.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            persistNote();
            state.activeNoteId = noteId;
            syncActiveFromState();
            restyle(currentScale);
            showNoteViewer();
            persistState();
            closePanel();
            return GLib.SOURCE_REMOVE;
        });
    }

    function createNewNote() {
        persistNote();
        const note = makeNote('');
        state.notes.unshift(note);
        state.activeNoteId = note.id;
        syncActiveFromState();
        restyle(currentScale);
        persistState();
        renderNoteList();
        closePanel();
        showNoteEditor();
    }

    function togglePin(note) {
        // Deferred: renderNoteList destroys this row while its click is still emitting.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            // Flush any in-progress edits first, so toggling a pin never drops unsaved text.
            syncStateFromActive();
            note.pinned = !note.pinned;
            persistState();
            renderNoteList();
            return GLib.SOURCE_REMOVE;
        });
    }

    function buildSectionHeader(label) {
        return new St.Label({
            text: label.toUpperCase(),
            style: `${fontCss}color: ${themeTextColor};`
                + `font-size: ${metrics.panelSectionFontSize}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`
                + `letter-spacing: ${Math.round(1 * currentScale)}px;`
                + `margin-top: ${Math.round(4 * currentScale)}px;`,
            opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
        });
    }

    function buildNoteRow(note, rowRadius) {
        const isActive = note.id === state.activeNoteId;
        const rowPadding = `${metrics.panelRowPaddingV}px ${metrics.panelRowPaddingH}px`;
        // The open note keeps a faint accent wash; the others rest on the plain card surface.
        const idleBackground = isActive ? cssColorToRgba(accentHex, ACTIVE_ROW_ALPHA) : surfaceCard;
        const hoverBackground = isActive ? cssColorToRgba(accentHex, ACTIVE_ROW_HOVER_ALPHA) : surfaceHighlight;
        const normalStyle = `padding: ${rowPadding}; border-radius: ${rowRadius}px; background-color: ${idleBackground};`;
        const hoverStyle = `padding: ${rowPadding}; border-radius: ${rowRadius}px; background-color: ${hoverBackground};`;

        const rowButton = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
            style: normalStyle,
        });
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: `spacing: ${metrics.panelSpacing}px;`,
        });
        rowButton.set_child(row);

        rowButton.connect('enter-event', () => {
            rowButton.style = hoverStyle;
            return Clutter.EVENT_PROPAGATE;
        });
        rowButton.connect('leave-event', () => {
            rowButton.style = normalStyle;
            return Clutter.EVENT_PROPAGATE;
        });

        // BinLayout so the initial can centre; a bare widget would pin it to the corner.
        const tile = new St.Widget({
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
            style: `background-color: ${resolveNoteColor(note.color).color};`
                + `border-radius: ${metrics.panelTileRadius}px;`
                + `width: ${metrics.panelTileSize}px; height: ${metrics.panelTileSize}px;`,
        });
        tile.add_child(new St.Label({
            text: noteInitial(note),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: `${fontCss}color: ${NOTE_TEXT_COLOR}; font-size: ${metrics.panelTileFontSize}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
        }));
        row.add_child(tile);

        const textColumn = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLabel = new St.Label({
            text: noteTitle(note),
            x_expand: true,
            style: `${fontCss}color: ${themeTextColor}; font-size: ${metrics.panelRowFontSize}px;`
                + `font-weight: ${TYPOGRAPHY_WEIGHT.bold};`,
        });
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textColumn.add_child(titleLabel);

        const preview = notePreview(note);
        if (preview.length > 0) {
            const previewLabel = new St.Label({
                text: preview,
                x_expand: true,
                style: `${fontCss}color: ${themeTextColor}; font-size: ${metrics.panelPreviewFontSize}px;`,
                opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
            });
            previewLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textColumn.add_child(previewLabel);
        }
        row.add_child(textColumn);

        const timeLabel = new St.Label({
            text: relativeNoteTime(note.updatedAt),
            y_align: Clutter.ActorAlign.CENTER,
            style: `${fontCss}color: ${themeTextColor}; font-size: ${metrics.panelMetaFontSize}px;`,
            opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
        });
        row.add_child(timeLabel);

        const pinPad = Math.round(4 * currentScale);
        const pinRadius = resolveChildCornerRadius(BASE_PANEL_ROW_RADIUS_PX, currentScale);
        const pinNormalStyle = `padding: ${pinPad}px; border-radius: ${pinRadius}px; background-color: transparent;`;
        const pinHoverStyle = `padding: ${pinPad}px; border-radius: ${pinRadius}px; background-color: ${cssColorToRgba(accentHex, PIN_HOVER_ALPHA)};`;
        const unpinnedOpacity = Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.disabled);

        const pinButton = new St.Button({
            child: new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: metrics.panelPinSize,
                style: `color: ${note.pinned ? accentHex : themeTextColor};`,
            }),
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: pinNormalStyle,
        });
        pinButton.child.opacity = note.pinned ? CLUTTER_OPACITY_OPAQUE : unpinnedOpacity;
        pinButton.connect('enter-event', () => {
            pinButton.style = pinHoverStyle;
            pinButton.child.opacity = CLUTTER_OPACITY_OPAQUE;
            return Clutter.EVENT_PROPAGATE;
        });
        pinButton.connect('leave-event', () => {
            pinButton.style = pinNormalStyle;
            pinButton.child.opacity = note.pinned ? CLUTTER_OPACITY_OPAQUE : unpinnedOpacity;
            return Clutter.EVENT_PROPAGATE;
        });
        pinButton.connect('clicked', () => togglePin(note));
        row.add_child(pinButton);

        rowButton.connect('clicked', () => selectNote(note.id));
        return rowButton;
    }

    function renderNoteList() {
        if (isActorDestroyed(container)) return;
        noteListBox.destroy_all_children();

        panelCountLabel.set_text(`${state.notes.length}`);

        const pinned = state.notes.filter(note => note.pinned)
            .slice().sort((a, b) => b.updatedAt - a.updatedAt);
        const recent = state.notes.filter(note => !note.pinned)
            .slice().sort((a, b) => b.updatedAt - a.updatedAt);

        if (pinned.length > 0) {
            noteListBox.add_child(buildSectionHeader('Pinned'));
            pinned.forEach(note => noteListBox.add_child(buildNoteRow(note, metrics.panelRowRadius)));
        }
        if (recent.length > 0) {
            noteListBox.add_child(buildSectionHeader('Recent'));
            recent.forEach(note => noteListBox.add_child(buildNoteRow(note, metrics.panelRowRadius)));
        }
    }

    function refreshViewer() {
        const { title, body } = splitNote(noteContent);
        titleView.set_text(title);
        titleView.visible = title.length > 0;
        bodyView.clutter_text.set_markup(convertMarkdownToPango(body));
        refreshFooter();
    }

    function showNoteViewer() {
        if (global.stage.get_key_focus() === textEditor)
            global.stage.set_key_focus(null);
        editorContainer.hide();
        titleView.show();
        bodyView.show();
        refreshViewer();
        editIcon.set_icon_name('document-edit-symbolic');
        isEditingActive = false;
        refreshTitleHint();
        refreshFooter();
    }

    function showNoteEditor() {
        textEditor.text = noteContent;
        titleView.hide();
        bodyView.hide();
        editorContainer.show();
        applyEditorColors(textEditor);
        global.stage.set_key_focus(textEditor);
        editIcon.set_icon_name('object-select-symbolic');
        isEditingActive = true;
        refreshTitleHint();
        refreshFooter();
    }

    function onEditorChanged(editor) {
        if (!isEditingActive) return;
        noteContent = editor.text;
        noteUpdatedAt = Math.floor(GLib.get_real_time() / 1000000);
        refreshTitleHint();
        refreshFooter();
        scheduleDeferredUpdate(state, 500, persistNote);
    }

    // Clutter.Text draws text, caret and selection itself, so it ignores the container's CSS
    // colour. Restate the note's ink here, and give the selection a light-on-dark pair so the
    // theme's default highlight does not swallow dark text.
    function applyEditorColors(editor) {
        if (!editorContainer.get_stage()) return;
        const node = editorContainer.get_theme_node();
        if (!node) return;
        const ink = node.get_foreground_color();
        editor.set_color(ink);
        editor.set_cursor_color(ink);
        editor.set_selection_color(ink);
        const cardNode = noteCard.get_theme_node();
        if (cardNode)
            editor.set_selected_text_color(cardNode.get_background_color());
    }

    function wireEditor(editor) {
        editor.connect('text-changed', () => onEditorChanged(editor));
        editor.connect('key-press-event', (_actor, event) => {
            if (!isEditingActive) return Clutter.EVENT_PROPAGATE;
            const key = event.get_key_symbol();
            // Tab is normally focus traversal; inside a note it should indent instead.
            if (key === Clutter.KEY_Tab) {
                editor.delete_selection();
                const position = editor.get_cursor_position();
                editor.insert_text('\t', position);
                // insert_text leaves the selection bound behind the cursor, which would show the
                // freshly inserted tab as selected; collapse both to the same spot.
                editor.set_selection_bound(position + 1);
                editor.set_cursor_position(position + 1);
                return Clutter.EVENT_STOP;
            }
            if (key !== Clutter.KEY_Return && key !== Clutter.KEY_KP_Enter)
                return Clutter.EVENT_PROPAGATE;
            // Shift+Enter keeps the default newline insertion; plain Enter commits the note.
            if (event.get_state() & Clutter.ModifierType.SHIFT_MASK)
                return Clutter.EVENT_PROPAGATE;
            noteContent = editor.text;
            noteUpdatedAt = Math.floor(GLib.get_real_time() / 1000000);
            showNoteViewer();
            persistNote();
            return Clutter.EVENT_STOP;
        });
    }

    function applyEditorFontSize(contentFontSize) {
        // Rebuilding the editor churns the text buffer and drops key focus, and the scaler
        // fires on both width and height changes. Only a font-size change needs the rebuild.
        if (lastEditorFontSize === contentFontSize) return;
        lastEditorFontSize = contentFontSize;

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
        applyEditorColors(newEditor);
        wireEditor(newEditor);
        textEditor = newEditor;
        if (wasEditing)
            global.stage.set_key_focus(textEditor);
    }

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        if (isEditingActive) {
            noteContent = textEditor.text;
            noteUpdatedAt = Math.floor(GLib.get_real_time() / 1000000);
            syncStateFromActive();
            if (global.stage.get_key_focus() === textEditor)
                global.stage.set_key_focus(null);
        }
        // Guard the empty state so a widget torn down before its file loads cannot write [].
        if (state.notes.length > 0)
            saveJsonToFileSync(notesFilePath, { notes: state.notes, activeNoteId: state.activeNoteId });
    });

    editButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (isEditingActive) {
            noteContent = textEditor.text;
            noteUpdatedAt = Math.floor(GLib.get_real_time() / 1000000);
            showNoteViewer();
            persistNote();
        } else {
            showNoteEditor();
        }
        return Clutter.EVENT_STOP;
    });

    restyle(clampWidgetScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX)));
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (!isActorDestroyed(container)) restyle(scale);
    });

    showNoteViewer();

    loadJsonFromFileAsync(notesFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;

        let restored = false;
        if (savedData && Array.isArray(savedData.notes)) {
            state.notes = savedData.notes.map(normalizeStoredNote).filter(Boolean);
            restored = state.notes.length > 0;
            if (savedData.activeNoteId && state.notes.some(note => note.id === savedData.activeNoteId))
                state.activeNoteId = savedData.activeNoteId;
        } else if (savedData && typeof savedData.notes === 'string') {
            // Legacy single-note file: wrap its text in the new list shape.
            const note = {
                id: generateNoteId(),
                content: savedData.notes,
                color: typeof savedData.color === 'string' ? savedData.color : DEFAULT_NOTE_COLOR_ID,
                pinned: false,
                updatedAt: Number.isFinite(savedData.updatedAt)
                    ? savedData.updatedAt
                    : Math.floor(GLib.get_real_time() / 1000000),
            };
            state.notes = [note];
            state.activeNoteId = note.id;
            restored = true;
        }

        if (!restored) {
            const note = makeNote('');
            state.notes = [note];
            state.activeNoteId = note.id;
        } else if (!state.activeNoteId) {
            state.activeNoteId = state.notes[0].id;
        }

        syncActiveFromState();
        restyle(currentScale);
        if (!isEditingActive)
            showNoteViewer();
        renderNoteList();
        // Do not overwrite a file we failed to read; only save once it loaded or was absent.
        if (restored || !loadError)
            persistState();
    });

    return container;
}
