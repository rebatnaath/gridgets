import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { ModalDialog } from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { TEXT_OPACITY, TYPOGRAPHY_WEIGHT } from '../utils/typography.js';

const TITLE_SIZE_PX = 18;
const SUBTITLE_SIZE_PX = 13;
const ENTRY_WIDTH_PX = 360;
const ENTRY_PADDING_PX = 10;
const ENTRY_RADIUS_PX = 8;
const CONTENT_SPACING_PX = 14;

// The shell's own theme variables, so the prompt matches what is around it.
const ENTRY_STYLE = [
    `background-color: -st-accent-bg-color;`,
    `color: -st-foreground-color;`,
    `border: 1px solid -st-accent-color;`,
    `border-radius: ${ENTRY_RADIUS_PX}px;`,
    `padding: ${ENTRY_PADDING_PX}px;`,
    `width: ${ENTRY_WIDTH_PX}px;`,
].join(' ');

/**
 * Asks for a single line of text. `callback` receives the entered text, or null when the
 * dialog was dismissed, so callers treat null as "leave everything as it was".
 *
 * `validate` lets a caller refuse an answer without the dialog going away: return
 * `{ok: false, message}` and the message replaces the subtitle, the text stays put and
 * selected, and the dialog is still there to be corrected. Only an accepted answer, or a
 * dismissal, settles it.
 *
 * Return is handled here rather than left to the dialog's default button, because a
 * default button only fires on Return when nothing in the dialog claims the key first,
 * and an St.Entry is inside it. Escape settles as null, as does a click outside, so a
 * caller waiting on the result is never left hanging.
 */
export function promptForText({ title, subtitle = '', initialText = '', confirmLabel = 'Confirm', validate = null }, callback) {
    // More than one route out can fire for one dismissal; the first wins.
    let settled = false;
    const settle = value => {
        if (settled)
            return;
        settled = true;
        callback(value);
    };

    // No styleClass: an unrecognised one strips the background, padding and button row
    // the shell's default gives it.
    const dialog = new ModalDialog({});

    const heading = new St.Label({
        text: title,
        style: `font-size: ${TITLE_SIZE_PX}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`,
    });
    dialog.contentLayout.add_child(heading);

    // Always present and hidden when unused, so a refusal needs no rebuild.
    const description = new St.Label({
        text: subtitle,
        visible: subtitle !== '',
        style: `font-size: ${SUBTITLE_SIZE_PX}px; opacity: ${TEXT_OPACITY.secondary};`,
    });
    dialog.contentLayout.add_child(description);
    dialog.contentLayout.set_style(`spacing: ${CONTENT_SPACING_PX}px;`);

    const entry = new St.Entry({
        text: initialText,
        can_focus: true,
        style: ENTRY_STYLE,
    });
    dialog.contentLayout.add_child(entry);

    const selectEntryText = () => {
        entry.grab_key_focus();
        // Clutter.Text has no select_all in this version; the selection is set as a range.
        entry.clutter_text.set_selection(0, entry.get_text().length);
    };

    const accept = () => {
        const enteredText = entry.get_text();
        if (validate) {
            const verdict = validate(enteredText);
            if (verdict && !verdict.ok) {
                description.text = verdict.message;
                description.visible = true;
                selectEntryText();
                return;
            }
        }
        dialog.close();
        settle(enteredText);
    };
    const cancel = () => {
        dialog.close();
        settle(null);
    };

    entry.clutter_text.connect('key-press-event', (_text, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            accept();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) {
            cancel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    dialog.setButtons([
        { label: 'Cancel', action: cancel },
        { label: confirmLabel, action: accept, key: Clutter.KEY_Return },
    ]);

    dialog.connect('closed', () => settle(null));
    dialog.open(Clutter.get_current_event_time());

    // A rename should not need the old name deleted first, and a new folder has none.
    selectEntryText();
}