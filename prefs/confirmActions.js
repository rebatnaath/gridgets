import Adw from 'gi://Adw';

export const CONFIRM_WIDGET_DELETE_KEY = 'confirm-widget-delete';

/**
 * Runs a destructive action, asking first unless the user has turned the prompt off.
 *
 * Removing a widget also deletes its saved data and there is no undo, so the default is to
 * ask. `confirm-widget-delete` exists for people deleting several widgets in a row, where
 * the prompt stops being information and becomes something to click past.
 */
export function confirmDestructive(window, settings, { heading, body, confirmLabel = 'Remove' }, onConfirm) {
    if (!settings.get_boolean(CONFIRM_WIDGET_DELETE_KEY)) {
        onConfirm();
        return;
    }

    const dialog = new Adw.AlertDialog({ heading, body });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance('confirm', Adw.ResponseAppearance.DESTRUCTIVE);
    // Cancel is the default and closes on Escape, so a stray Return cannot remove anything.
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_dialog, responseId) => {
        if (responseId === 'confirm')
            onConfirm();
    });
    dialog.present(window);
}