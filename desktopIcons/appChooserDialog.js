import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ModalDialog } from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { TEXT_OPACITY, TYPOGRAPHY_WEIGHT } from '../utils/typography.js';
import { connectDoubleClick, connectShortClick } from '../utils/widgetInteractions.js';
import { appMatchesFilter, groupAppsForFile, isDirectoryEntry } from './fileOperations.js';

const TITLE_SIZE_PX = 16;
const SUBTITLE_SIZE_PX = 13;
const SECTION_SIZE_PX = 12;
const ROW_ICON_SIZE_PX = 24;
const ROW_PADDING_PX = 8;
const ROW_SPACING_PX = 10;
const LIST_PADDING_PX = 6;
const LIST_HEIGHT_PX = 340;
const LIST_WIDTH_PX = 340;
const LIST_RADIUS_PX = 10;
const HEADER_SPACING_PX = 8;
const HEADER_PADDING_TOP_PX = 2;
const CONTAINER_PADDING_PX = 10;
const CONTAINER_RADIUS_PX = 14;
const SEARCH_RADIUS_PX = 8;
const SEARCH_PADDING_PX = 8;
// On the list's own well, so it reads as part of the list.
const SEARCH_BACKGROUND = 'rgba(0, 0, 0, 0.25)';
const SEARCH_BORDER = 'rgba(255, 255, 255, 0.10)';
const BUTTON_PADDING_PX = '6px 10px';
const BUTTON_RADIUS_PX = 8;
// Equal widths: a box layout centres the title only when both ends match.
const BUTTON_WIDTH_PX = 78;

// Translucent over the dialog's own background, so it reads the same in light and dark.
const BUTTON_BACKGROUND = 'rgba(255, 255, 255, 0.09)';
const BUTTON_BACKGROUND_HOVER = 'rgba(255, 255, 255, 0.16)';
const CONTAINER_BACKGROUND = 'rgba(255, 255, 255, 0.05)';
const LIST_BACKGROUND = 'rgba(0, 0, 0, 0.22)';
const LIST_BORDER = 'rgba(255, 255, 255, 0.10)';

const ROW_BACKGROUND_HOVER = 'rgba(255, 255, 255, 0.07)';
// A white wash, not an accent: -st-accent-bg-color is too close to the panel behind the
// list for a selected row to read as different from it.
const ROW_BACKGROUND_SELECTED = 'rgba(255, 255, 255, 0.20)';
const ROW_BACKGROUND = 'transparent';
const DISABLED_OPACITY = 0.45;

// Stated rather than inherited: a label inside the scroll view inherits the foreground
// colour and paints nothing.
const LABEL_COLOUR = 'color: -st-foreground-color;';

// St styles carry no opacity property, so a fade is the actor's own opacity. The accent
// cannot be lightened in place, and a flat white wash would need the label to flip colour.
const OPEN_HOVER_OPACITY = 0.8;
const ROW_RADIUS_PX = 8;
const LABEL_STYLE = `${LABEL_COLOUR} font-size: ${SUBTITLE_SIZE_PX}px;`;

const rowStyle = (background, extra = '') =>
    `padding: ${ROW_PADDING_PX}px; border-radius: ${ROW_RADIUS_PX}px; background-color: ${background}; ${extra}`;

const SECTION_HEADING_STYLE = [
    LABEL_COLOUR,
    `font-size: ${SECTION_SIZE_PX}px;`,
    `font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`,
    `opacity: ${TEXT_OPACITY.secondary};`,
    `padding: ${ROW_SPACING_PX}px ${ROW_PADDING_PX}px ${ROW_SPACING_PX / 2}px ${ROW_PADDING_PX}px;`,
].join(' ');

/**
 * Colours a button under the pointer rather than scaling it.
 *
 * A button that grows on hover moves the very thing being aimed at, which makes a row of
 * them hard to hit and reads as a toy rather than as a dialog. The change here is a
 * background step only.
 */
function attachHoverTint(button, restingStyle, hoverStyle) {
    button.connect('notify::hover', () => {
        button.style = button.hover ? hoverStyle : restingStyle;
    });
}

/**
 * One application. Its background follows the pointer and the selection, because there is
 * no stylesheet in this extension for a toggle style to come from.
 *
 * The row is a reactive box rather than an St.Button. A button brings the shell's button
 * styling with it, which is what a row in a list is not, and it themed the row's children
 * well enough that the application names stopped painting while their icons still did. A
 * plain box inherits its colour the same way the surrounding labels do.
 *
 * `rowStyleFor` is asked for the style rather than told it, because the answer depends on
 * which row is selected now: a row selected when it is built has to stop showing its hover
 * once another row takes the selection, and go back to it if it is taken back.
 */
function createAppRow(app, onActivate, rowStyleFor) {
    const row = new St.BoxLayout({
        style: `${rowStyleFor(false)} spacing: ${ROW_SPACING_PX}px;`,
        x_expand: true,
        reactive: true,
        track_hover: true,
    });

    const icon = app.get_icon();
    if (icon) {
        row.add_child(new St.Icon({ gicon: icon, icon_size: ROW_ICON_SIZE_PX }));
    }
    row.add_child(new St.Label({
        text: app.get_display_name() || app.get_name(),
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        style: LABEL_STYLE,
    }));

    // A short click selects so Open has something to confirm; a double click confirms
    // outright. Both go through the shared helpers so a drag selects nothing.
    connectShortClick(row, () => onActivate(app, false));
    connectDoubleClick(row, () => onActivate(app, true));
    row.connect('notify::hover', () => {
        row.style = `${rowStyleFor(row.hover)} spacing: ${ROW_SPACING_PX}px;`;
    });
    // The styler comes back with the row: selection restyles a row already built.
    return { row, restyle: isHovered => { row.style = `${rowStyleFor(isHovered)} spacing: ${ROW_SPACING_PX}px;`; } };
}

function createSectionHeading(text) {
    return new St.Label({ text, style: SECTION_HEADING_STYLE });
}

/**
 * Shows the chooser and calls `onChosen` with the picked application, or with null when
 * the dialog is dismissed.
 *
 * Rows select rather than launch, and the Open button is what commits the choice, so the
 * application can be seen before it is used. The current default is selected on opening.
 */
export function showAppChooserDialog({ file, onChosen }) {
    const { preferred, recommended, other } = groupAppsForFile(file);
    if (!preferred && recommended.length === 0 && other.length === 0)
        return false;

    let settled = false;
    // The default handler leads its group but is not selected: Open should not act until
    // something is picked.
    let selected = null;
    const settle = app => {
        if (settled)
            return;
        settled = true;
        onChosen(app);
    };

    const isDirectory = isDirectoryEntry(file);
    const dialog = new ModalDialog({});
    const content = dialog.contentLayout;
    content.set_style(`spacing: ${ROW_SPACING_PX}px; padding-top: ${HEADER_PADDING_TOP_PX}px;`);

    // The shell's own button row sits at the bottom, so the header carries them instead.
    const cancelRestingStyle = `padding: ${BUTTON_PADDING_PX}; width: ${BUTTON_WIDTH_PX}px; border-radius: ${BUTTON_RADIUS_PX}px; background-color: ${BUTTON_BACKGROUND};`;
    const cancelHoverStyle = cancelRestingStyle.replace(BUTTON_BACKGROUND, BUTTON_BACKGROUND_HOVER);
    const cancelButton = new St.Button({
        label: 'Cancel',
        y_align: Clutter.ActorAlign.CENTER,
        style: cancelRestingStyle,
    });
    cancelButton.connect('clicked', () => {
        dialog.close();
        settle(null);
    });
    attachHoverTint(cancelButton, cancelRestingStyle, cancelHoverStyle);

    const title = new St.Label({
        text: isDirectory ? 'Open Folder' : 'Open File',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: `font-size: ${TITLE_SIZE_PX}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`,
    });

    const openRestingStyle = `padding: ${BUTTON_PADDING_PX}; width: ${BUTTON_WIDTH_PX}px; border-radius: ${BUTTON_RADIUS_PX}px; background-color: -st-accent-color; color: -st-accent-fg-color;`;
    const openButton = new St.Button({
        label: 'Open',
        y_align: Clutter.ActorAlign.CENTER,
        style: openRestingStyle,
    });
    openButton.connect('clicked', () => {
        const chosen = selected;
        dialog.close();
        settle(chosen);
    });
    // Opacity is the actor's, not the style's: St ignores an opacity declaration in a style
    // string, so the disabled and hover fades both have to be set on the actor.
    let openEnabled = false;
    const updateOpenOpacity = () => {
        if (!openEnabled)
            openButton.opacity = Math.round(255 * DISABLED_OPACITY);
        else
            openButton.opacity = Math.round(255 * (openButton.hover ? OPEN_HOVER_OPACITY : 1));
    };
    openButton.connect('notify::hover', updateOpenOpacity);
    const setOpenEnabled = enabled => {
        // reactive rather than sensitive: with no stylesheet of our own an insensitive
        // button would look enabled and only stop working.
        openEnabled = enabled;
        openButton.reactive = enabled;
        updateOpenOpacity();
    };
    setOpenEnabled(false);

    const header = new St.BoxLayout({ style: `spacing: ${HEADER_SPACING_PX}px;` });
    header.add_child(cancelButton);
    header.add_child(title);
    header.add_child(openButton);
    content.add_child(header);

    // Escaped rather than trusted: the name is set in bold markup. The length argument is
    // required too; -1 means the string ends at its NUL.
    const panel = new St.BoxLayout({
        vertical: true,
        style: `spacing: ${ROW_SPACING_PX}px; padding: ${CONTAINER_PADDING_PX}px; border-radius: ${CONTAINER_RADIUS_PX}px; background-color: ${CONTAINER_BACKGROUND};`,
    });
    content.add_child(panel);

    const subtitle = new St.Label({ style: LABEL_STYLE });
    subtitle.clutter_text.set_markup(
        `Choose an application to open <b>${GLib.markup_escape_text(file.get_basename(), -1)}</b>`);
    panel.add_child(subtitle);

    const searchEntry = new St.Entry({
        hint_text: 'Type to filter',
        can_focus: true,
        style: `${LABEL_COLOUR} background-color: ${SEARCH_BACKGROUND}; border: 1px solid ${SEARCH_BORDER}; border-radius: ${SEARCH_RADIUS_PX}px; padding: ${SEARCH_PADDING_PX}px;`,
    });
    panel.add_child(searchEntry);

    // A darker well inside the lighter panel, so the list sits in the dialog rather than on it.
    const scrollView = new St.ScrollView({
        style: `width: ${LIST_WIDTH_PX}px; height: ${LIST_HEIGHT_PX}px;`,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
    });
    const listFrame = new St.BoxLayout({
        vertical: true,
        style: `padding: ${LIST_PADDING_PX}px; border: 1px solid ${LIST_BORDER}; border-radius: ${LIST_RADIUS_PX}px; background-color: ${LIST_BACKGROUND};`,
    });
    const rowBox = new St.BoxLayout({
        vertical: true,
        style: `spacing: ${ROW_SPACING_PX / 2}px;`,
    });
    listFrame.add_child(rowBox);
    scrollView.set_child(listFrame);
    panel.add_child(scrollView);

    // One row per application, in its group; a row above the groups would list it twice.
    const rows = new Map();
    const rowFor = app => {
        if (rows.has(app))
            return rows.get(app).row;
        const created = createAppRow(app, activate, isHovered => {
            if (app === selected)
                return rowStyle(ROW_BACKGROUND_SELECTED);
            return rowStyle(isHovered ? ROW_BACKGROUND_HOVER : ROW_BACKGROUND);
        });
        rows.set(app, created);
        return created.row;
    };

    const select = app => {
        selected = app;
        setOpenEnabled(true);
        // Each entry is the row plus its styler, not the styler alone. Restyling every row
        // on select is what makes the highlight appear on the click rather than whenever the
        // pointer next moves and re-runs the hover handler.
        for (const created of rows.values())
            created.restyle(created.row.hover);
    };

    const activate = (app, shouldOpen) => {
        select(app);
        if (!shouldOpen)
            return;
        dialog.close();
        settle(app);
    };

    const groups = [
        { heading: 'Recommended Apps', apps: recommended },
        { heading: 'Other Apps', apps: other },
    ];

    const noMatchesLabel = new St.Label({
        text: 'No application matches.',
        visible: false,
        style: `${LABEL_STYLE} padding: ${ROW_SPACING_PX}px ${ROW_PADDING_PX}px;`,
    });

    const render = () => {
        // remove_child, never destroy_all_children: the rows are cached and reused, and
        // destroying them frees the memory the next keystroke re-adds them into.
        for (const child of rowBox.get_children())
            rowBox.remove_child(child);

        const needle = searchEntry.get_text();
        let shown = 0;

        for (const { heading, apps } of groups) {
            // A group with nothing matching takes its heading with it.
            const visible = apps.filter(app => appMatchesFilter(app, needle));
            if (visible.length === 0)
                continue;
            rowBox.add_child(createSectionHeading(heading));
            for (const app of visible) {
                rowBox.add_child(rowFor(app));
                shown++;
            }
        }

        noMatchesLabel.visible = shown === 0;
        if (noMatchesLabel.visible)
            rowBox.add_child(noMatchesLabel);

        // A selection the filter has hidden cannot be confirmed, and its row has to lose the
        // selected background too or it still paints it the next time the row is shown.
        if (selected && !rowBox.get_children().includes(rows.get(selected).row)) {
            const hidden = rows.get(selected);
            selected = null;
            setOpenEnabled(false);
            hidden.restyle(hidden.row.hover);
        }
    };

    searchEntry.clutter_text.connect('text-changed', render);
    render();

    // ModalDialog routes a key only through a button registered with it, so Escape needs one
    // of its own. It stays invisible because the real buttons sit in the header.
    const escapeButton = dialog.addButton({
        label: '',
        action: () => dialog.close(),
        key: Clutter.KEY_Escape,
    });
    escapeButton.visible = false;
    // addButton gives the hidden button the initial focus, which would leave the search box
    // unable to take a keystroke.
    dialog.setInitialKeyFocus(searchEntry);

    dialog.connect('closed', () => settle(null));
    dialog.open(Clutter.get_current_event_time());
    return true;
}