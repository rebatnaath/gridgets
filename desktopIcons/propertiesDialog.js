import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ModalDialog } from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { TEXT_OPACITY, TYPOGRAPHY_WEIGHT } from '../utils/typography.js';
import { showInFileManager } from './fileOperations.js';

const HEADER_ICON_SIZE_PX = 56;
const TITLE_SIZE_PX = 18;
const SUBTITLE_SIZE_PX = 13;
const LABEL_SIZE_PX = 12;
const ROW_SPACING_PX = 10;
const LABEL_WIDTH_PX = 110;
const TOGGLE_WIDTH_PX = 74;
const SEPARATOR_THICKNESS_PX = 1;

// Written out rather than shifted so the numbers read against `ls -l`.
const PERMISSION_MATRIX = Object.freeze({
    owner: Object.freeze({ read: 0o400, write: 0o200, execute: 0o100 }),
    group: Object.freeze({ read: 0o040, write: 0o020, execute: 0o010 }),
    others: Object.freeze({ read: 0o004, write: 0o002, execute: 0o001 }),
});
const PERMISSION_CLASSES = Object.keys(PERMISSION_MATRIX);
const PERMISSION_NAMES = ['read', 'write', 'execute'];

// Below the type bits: what unix::mode carries besides the permissions.
const PERMISSION_MASK = 0o7777;

const FILESYSTEM_FREE_ATTRIBUTE = 'filesystem::free';
const QUERY_ATTRIBUTES = [
    'standard::type',
    'standard::display-name',
    'standard::size',
    'standard::content-type',
    'time::modified',
    'time::creation',
    'unix::mode',
].join(',');

function formatTimestamp(seconds) {
    // A filesystem that does not record creation reports zero, which is not a date.
    if (!seconds)
        return null;
    return GLib.DateTime.new_from_unix_local(seconds).format('%x, %X');
}

function formatBytes(bytes) {
    return GLib.format_size(bytes);
}

function freeSpaceFor(file) {
    try {
        const info = file.query_filesystem_info(FILESYSTEM_FREE_ATTRIBUTE, null);
        const freeBytes = info.get_attribute_uint64(FILESYSTEM_FREE_ATTRIBUTE);
        return freeBytes > 0 ? formatBytes(freeBytes) : null;
    } catch (error) {
        // Not every filesystem reports it, and a missing figure is not worth a message.
        return null;
    }
}

function countChildren(directory) {
    try {
        const enumerator = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let count = 0;
        while (enumerator.next_file(null) !== null)
            count++;
        enumerator.close(null);
        return count;
    } catch (error) {
        console.error(`Gridgets: ${directory.get_uri()} could not be counted:`, error);
        return 0;
    }
}

/** The line under the name: what it is, and how many things it holds or how big it is. */
function describeEntry(file, fileInfo) {
    if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
        const count = countChildren(file);
        return count === 1 ? '1 item' : `${count} items`;
    }
    const description = Gio.content_type_get_description(fileInfo.get_content_type());
    return `${formatBytes(fileInfo.get_size())} · ${description}`;
}

function createSeparator() {
    return new St.Widget({
        height: SEPARATOR_THICKNESS_PX,
        style: `height: ${SEPARATOR_THICKNESS_PX}px; background-color: -st-border-color;`,
    });
}

function createDetailRow(label, value) {
    const row = new St.BoxLayout({
        style: `spacing: ${ROW_SPACING_PX}px;`,
    });

    const name = new St.Label({
        text: label,
        style: `font-size: ${LABEL_SIZE_PX}px; opacity: ${TEXT_OPACITY.secondary}; width: ${LABEL_WIDTH_PX}px;`,
        x_align: Clutter.ActorAlign.END,
    });
    row.add_child(name);

    const content = new St.BoxLayout({ x_expand: true });
    const text = new St.Label({ text: value, style: `font-size: ${LABEL_SIZE_PX}px;` });
    content.add_child(text);
    row.add_child(content);

    row.detailText = text;
    return row;
}

/**
 * Owner, group and others, each with three toggles. Every change writes the whole mode, and
 * a write the filesystem refuses puts the toggles back to what the mode still says.
 */
function createPermissionsSection(file, fileInfo) {
    const mode = fileInfo.get_attribute_uint32('unix::mode');

    const section = new St.BoxLayout({
        vertical: true,
        style: `spacing: ${ROW_SPACING_PX}px;`,
    });

    const toggles = {};
    const typeBits = mode & ~PERMISSION_MASK;

    for (const permissionClass of PERMISSION_CLASSES) {
        const row = new St.BoxLayout({ style: `spacing: ${ROW_SPACING_PX}px;` });

        const name = new St.Label({
            text: permissionClass === 'others' ? 'Others' : `${permissionClass[0].toUpperCase()}${permissionClass.slice(1)}`,
            style: `font-size: ${LABEL_SIZE_PX}px; opacity: ${TEXT_OPACITY.secondary}; width: ${LABEL_WIDTH_PX}px;`,
            x_align: Clutter.ActorAlign.END,
        });
        row.add_child(name);

        toggles[permissionClass] = {};
        for (const permissionName of PERMISSION_NAMES) {
            const bit = PERMISSION_MATRIX[permissionClass][permissionName];
            const toggle = new St.Button({
                label: `${permissionName[0].toUpperCase()}${permissionName.slice(1)}`,
                toggle_mode: true,
                checked: (mode & bit) !== 0,
                style: `width: ${TOGGLE_WIDTH_PX}px;`,
            });
            row.add_child(toggle);
            toggles[permissionClass][permissionName] = toggle;
        }
        section.add_child(row);
    }

    // Putting the toggles back re-enters the handler below, so the revert runs behind the
    // guard rather than writing again. knownPermissions is the mode last confirmed on disk:
    // it is what a refused write has to fall back to, not the value it tried to write.
    let knownPermissions = mode & PERMISSION_MASK;
    let applying = false;

    const applyPermissions = () => {
        if (applying)
            return;

        let permissions = 0;
        for (const permissionClass of PERMISSION_CLASSES) {
            for (const permissionName of PERMISSION_NAMES) {
                if (toggles[permissionClass][permissionName].checked)
                    permissions |= PERMISSION_MATRIX[permissionClass][permissionName];
            }
        }

        // The type bits go back in unchanged: setting the mode to the permissions alone
        // would leave the filesystem entry with no type at all.
        try {
            file.set_attribute_uint32('unix::mode', typeBits | permissions, Gio.FileQueryInfoFlags.NONE, null);
            knownPermissions = permissions;
        } catch (error) {
            console.error(`Gridgets: the permissions of ${file.get_uri()} could not be changed:`, error);
            applying = true;
            restoreFromMode(knownPermissions);
            applying = false;
        }
    };

    const restoreFromMode = known => {
        for (const permissionClass of PERMISSION_CLASSES) {
            for (const permissionName of PERMISSION_NAMES) {
                const bit = PERMISSION_MATRIX[permissionClass][permissionName];
                toggles[permissionClass][permissionName].checked = (known & bit) !== 0;
            }
        }
    };

    // notify::checked rather than 'clicked': a toggle that refuses the write is put back,
    // and that has to come through the same path the user set it with.
    for (const permissionClass of PERMISSION_CLASSES) {
        for (const permissionName of PERMISSION_NAMES) {
            toggles[permissionClass][permissionName].connect('notify::checked', applyPermissions);
        }
    }

    return section;
}

/** Shows the properties of a desktop entry. */
export function showPropertiesDialog(file) {
    let fileInfo;
    try {
        fileInfo = file.query_info(QUERY_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be read:`, error);
        return false;
    }

    const dialog = new ModalDialog({});
    const content = dialog.contentLayout;
    content.set_style(`spacing: ${ROW_SPACING_PX}px;`);

    const name = fileInfo.get_display_name() || file.get_basename();

    const header = new St.BoxLayout({
        style: `spacing: ${ROW_SPACING_PX * 1.5}px;`,
    });
    const headerIcon = new St.Icon({
        gicon: new Gio.FileIcon({ file }),
        icon_size: HEADER_ICON_SIZE_PX,
        x_align: Clutter.ActorAlign.START,
    });
    const headerText = new St.BoxLayout({
        vertical: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: `spacing: ${ROW_SPACING_PX * 0.5}px;`,
    });
    headerText.add_child(new St.Label({
        text: name,
        style: `font-size: ${TITLE_SIZE_PX}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`,
    }));
    headerText.add_child(new St.Label({
        text: describeEntry(file, fileInfo),
        style: `font-size: ${SUBTITLE_SIZE_PX}px; opacity: ${TEXT_OPACITY.secondary};`,
    }));
    const freeSpace = freeSpaceFor(file);
    if (freeSpace) {
        headerText.add_child(new St.Label({
            text: `${freeSpace} free`,
            style: `font-size: ${LABEL_SIZE_PX}px; opacity: ${TEXT_OPACITY.metadata};`,
        }));
    }
    header.add_child(headerIcon);
    header.add_child(headerText);
    content.add_child(header);

    content.add_child(createSeparator());

    const parent = file.get_parent();
    if (parent) {
        const parentRow = createDetailRow('Location', `${parent.get_basename()}/`);
        const revealButton = new St.Button({
            label: 'Open Folder',
            style: `width: ${TOGGLE_WIDTH_PX * 1.6}px;`,
        });
        revealButton.connect('clicked', () => showInFileManager(file));
        parentRow.detailText.get_parent().add_child(revealButton);
        content.add_child(parentRow);
    }

    const modified = formatTimestamp(fileInfo.get_attribute_uint64('time::modified'));
    if (modified)
        content.add_child(createDetailRow('Modified', modified));

    const created = formatTimestamp(fileInfo.get_attribute_uint64('time::creation'));
    if (created)
        content.add_child(createDetailRow('Created', created));

    if (fileInfo.get_file_type() !== Gio.FileType.DIRECTORY)
        content.add_child(createDetailRow('Size', formatBytes(fileInfo.get_size())));

    content.add_child(createSeparator());

    content.add_child(new St.Label({
        text: 'Permissions',
        style: `font-size: ${LABEL_SIZE_PX}px; opacity: ${TEXT_OPACITY.secondary};`,
    }));
    content.add_child(createPermissionsSection(file, fileInfo));

    dialog.setButtons([{ label: 'Close', action: () => dialog.close(), key: Clutter.KEY_Escape }]);
    dialog.open(Clutter.get_current_event_time());
    return true;
}