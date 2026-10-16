import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { desktopDirectoryPath } from './desktopIcons.js';

const FILE_MANAGER = 'nautilus';

// Terminals, GNOME's first, since this is a GNOME extension. Each one names its
// "start in this folder" argument differently, so the form is carried with the program
// rather than assumed.
//
// `tabbed` marks the ones that run as a single instance: for those, asking for a working
// directory without asking for a tab is ignored, because the request only reaches the
// process that is already running and it just raises the window it already had. Verified
// against GNOME Console, which runs as a GApplication service and does have --tab.
const TERMINAL_CANDIDATES = [
    { program: 'gnome-terminal', tabbed: true, build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'kgx', tabbed: true, build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'ptyxis', build: dir => [`--directory=${GLib.shell_quote(dir)}`] },
    { program: 'xfce4-terminal', build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'tilix', build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'foot', build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'alacritty', build: dir => [`--working-directory=${GLib.shell_quote(dir)}`] },
    { program: 'kitty', build: dir => [`--directory=${GLib.shell_quote(dir)}`] },
    { program: 'wezterm', build: dir => ['start', `--cwd=${GLib.shell_quote(dir)}`] },
];

// Every candidate up to here is tried, which is a directory listing per keystroke.
const COLLISION_SUFFIX_LIMIT = 50;

// Queried when the menu is built, not when the entry was listed: a folder can be
// replaced by a file of the same name between the two.

export function isDirectoryEntry(file) {
    try {
        const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_file_type() === Gio.FileType.DIRECTORY;
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be read:`, error);
        return false;
    }
}

// query_default_handler raises rather than returning null for a type nothing is
// registered for, which is normal for an exotic file.

export function defaultHandlerFor(file) {
    try {
        return file.query_default_handler(null);
    } catch {
        return null;
    }
}

/** Whether an application claims a content type, by pattern or by wildcard. */
function appHandlesContentType(app, contentType) {
    // Null for a desktop file that declares no supported types, which is not an error and
    // does not mean the app can open this file.
    const supportedTypes = app.get_supported_types();
    if (!supportedTypes)
        return false;
    return supportedTypes.some(pattern => {
        if (pattern === '*/*' || pattern === contentType)
            return true;
        return pattern.endsWith('/*') && contentType.startsWith(pattern.slice(0, -1));
    });
}

export function contentTypeOf(file) {
    try {
        return file.query_info('standard::content-type', Gio.FileQueryInfoFlags.NONE, null).get_content_type();
    } catch (error) {
        console.error(`Gridgets: the type of ${file.get_uri()} could not be read:`, error);
        return null;
    }
}

// The default handler leads whichever group it is in, since it is the one that would
// run without asking.

export function groupAppsForFile(file) {
    const preferred = defaultHandlerFor(file);
    const contentType = contentTypeOf(file);

    const recommended = [];
    const other = [];
    const seenExecutables = new Set();

    for (const app of Gio.AppInfo.get_all()) {
        const executable = app.get_executable();
        // Several desktop entries share one program; one row each would be noise.
        if (!executable || seenExecutables.has(executable))
            continue;
        seenExecutables.add(executable);

        if (contentType && appHandlesContentType(app, contentType))
            recommended.push(app);
        else
            other.push(app);
    }

    const byName = (a, b) => a.get_display_name().localeCompare(b.get_display_name());
    recommended.sort(byName);
    other.sort(byName);

    // Compared by executable, not by object: query_default_handler hands back its own
    // wrapper for an application that get_all has already listed, so the same program is
    // two distinct JS objects here. Testing identity finds neither match, and the default
    // ends up in both groups at once.
    const preferredExecutable = preferred ? preferred.get_executable() : null;
    if (preferredExecutable) {
        const holdsPreferred = recommended.some(app => app.get_executable() === preferredExecutable);
        const list = holdsPreferred ? recommended : other;
        const index = list.findIndex(app => app.get_executable() === preferredExecutable);
        if (index >= 0)
            list.splice(index, 1);
        list.unshift(preferred);
    }

    return { preferred, recommended, other };
}

// An empty or whitespace-only needle matches everything, so the list starts unfiltered.

export function appMatchesFilter(app, needle) {
    const trimmed = needle.trim().toLowerCase();
    if (trimmed === '')
        return true;
    return app.get_display_name().toLowerCase().includes(trimmed);
}

/** Opens a file with one chosen application, passing it the file to act on. */
export function openEntryWith(file, appInfo) {
    try {
        // launch_uris rather than launch: it fills the Exec line's %u/%U/%f/%F slot
        // itself, where a hand-built argument list reaches the application as a bare
        // string and is not what any of them expect.
        appInfo.launch_uris([file.get_uri()], global.create_app_launch_context(0, -1));
        return true;
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be opened:`, error);
        return false;
    }
}

export function trashEntry(file) {
    try {
        return file.trash(null);
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be moved to the trash:`, error);
        return false;
    }
}

/**
 * Whether a program of that name is installed.
 *
 * create_from_commandline only parses the string it is given: it answers with an AppInfo
 * for commands that do not exist, so it cannot answer whether anything is there.
 */
function isInstalled(program) {
    return GLib.find_program_in_path(program) !== null;
}

function runCommand(commandline, description) {
    const appInfo = Gio.AppInfo.create_from_commandline(
        commandline, description, Gio.AppInfoCreateFlags.NONE);
    try {
        appInfo.launch([], null);
        return true;
    } catch (error) {
        console.error(`Gridgets: ${commandline} could not be run:`, error);
        return false;
    }
}

export function showInFileManager(file) {
    if (!isInstalled(FILE_MANAGER)) {
        console.error(`Gridgets: ${FILE_MANAGER} is not installed, so ${file.get_uri()} cannot be shown in a folder`);
        return false;
    }
    // --select is how Files is told which entry to highlight. Without it the folder opens
    // with the file somewhere in it, and the point of the item was to point at the file.
    return runCommand(
        `${FILE_MANAGER} --select ${GLib.shell_quote(file.get_uri())}`,
        `Open ${file.get_basename()} in Files`);
}

/**
 * Where the extension starts, or -1 when there is none.
 *
 * A leading dot does not count: `.bashrc` is a name, not a name with an extension. Shared
 * with renaming, which selects up to this point so a typed name keeps its extension.
 */
export function extensionIndex(name) {
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? dotIndex : -1;
}

export function freeNameIn(directory, baseName) {
    const dotIndex = extensionIndex(baseName);
    const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
    const suffix = dotIndex > 0 ? baseName.slice(dotIndex) : '';

    for (let counter = 1; counter <= COLLISION_SUFFIX_LIMIT; counter++) {
        // The original is the first candidate and is unnumbered, so the first duplicate is
        // "name (1)" and there is never a gap at the bottom. The parenthesised number goes
        // before the extension, which is where Windows puts it and where it stays readable
        // next to the other desktop entries.
        const candidate = counter === 1 ? baseName : `${stem} (${counter - 1})${suffix}`;
        if (!directory.get_child(candidate).query_exists(null))
            return candidate;
    }
    return null;
}

/**
 * Copies one entry, descending into directories.
 *
 * Gio.File.copy given a directory creates the directory and nothing inside it, so a plain
 * call hands back an empty folder and reports success. Directories are walked instead.
 */
function copyEntryTree(source, target) {
    // A target inside the source is copied forever: the walk re-enters the same tree one
    // level down each time. Callers reject this before they get here; this is the backstop.
    if (target.has_prefix(source))
        throw new Error('a folder cannot be copied inside itself');

    if (!isDirectoryEntry(source)) {
        source.copy(target, Gio.FileCopyFlags.NONE, null, null);
        return;
    }

    target.make_directory_with_parents(null);

    // Hidden entries included: they are on the desktop like any other, and a copy that
    // quietly dropped them would lose files.
    const enumerator = source.enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    try {
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            copyEntryTree(source.get_child(info.get_name()), target.get_child(info.get_name()));
    } finally {
        enumerator.close(null);
    }
}

function transferEntry(file, destinationDirectory, shouldMove) {
    const parent = file.get_parent();
    if (parent && parent.equal(destinationDirectory))
        return { ok: false, message: 'It is already in that folder.' };

    const name = freeNameIn(destinationDirectory, file.get_basename());
    if (!name)
        return { ok: false, message: `That folder already has too many entries called “${file.get_basename()}”.` };

    const target = destinationDirectory.get_child(name);
    if (!shouldMove && target.has_prefix(file))
        return { ok: false, message: 'A folder cannot be copied into itself.' };

    try {
        // No OVERWRITE flag: the free name above is what keeps this from replacing
        // anything, and the filesystem enforces it too.
        if (shouldMove)
            file.move(target, Gio.FileCopyFlags.NONE, null, null);
        else
            copyEntryTree(file, target);
        return { ok: true, message: '' };
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be ${shouldMove ? 'moved' : 'copied'} to ${destinationDirectory.get_uri()}:`, error);
        return { ok: false, message: `“${name}” could not be ${shouldMove ? 'moved' : 'copied'}.` };
    }
}

// Anything already in the destination is skipped rather than pasted under a counted name.
export function pasteUrisIntoDirectory(uris, shouldMove, directory) {
    let pasted = 0;
    let lastFailure = '';
    let alreadyThere = 0;

    for (const uri of uris) {
        const source = Gio.File.new_for_uri(uri);
        // An entry that is not a usable file URI has no basename, and asking for one throws.
        if (!source.get_basename()) {
            lastFailure = 'the clipboard held something that is not a file';
            continue;
        }

        const parent = source.get_parent();
        if (parent && parent.equal(directory)) {
            alreadyThere++;
            continue;
        }

        const name = freeNameIn(directory, source.get_basename());
        if (!name) {
            lastFailure = `there were already too many files called “${source.get_basename()}”`;
            continue;
        }

        const target = directory.get_child(name);
        if (!shouldMove && target.has_prefix(source)) {
            lastFailure = `“${source.get_basename()}” cannot be copied into itself`;
            continue;
        }

        try {
            if (shouldMove)
                source.move(target, Gio.FileCopyFlags.NONE, null, null);
            else
                copyEntryTree(source, target);
            pasted++;
        } catch (error) {
            console.error(`Gridgets: ${uri} could not be pasted:`, error);
            lastFailure = `“${source.get_basename()}” could not be pasted`;
        }
    }

    // Saying nothing when the whole paste was skipped left the user with a dialog that
    // explained no reason, which is indistinguishable from the paste being broken.
    if (pasted === 0 && lastFailure === '' && alreadyThere > 0) {
        lastFailure = alreadyThere === 1
            ? 'that file is already in this folder'
            : `those ${alreadyThere} files are already in this folder`;
    }

    return { pasted, failure: lastFailure };
}

export function moveEntryTo(file, destinationDirectory) {
    return transferEntry(file, destinationDirectory, true);
}

export function copyEntryTo(file, destinationDirectory) {
    return transferEntry(file, destinationDirectory, false);
}

// A folder is somewhere to be, so its console opens in it; a file's opens where it is.
export function consoleDirectoryFor(file) {
    if (isDirectoryEntry(file))
        return file;
    return file.get_parent() || file;
}

// There is no freedesktop way to ask for "a terminal", so the installed ones are tried in
// turn. An installed program that refuses to start is not treated as failure to find one.
export function launchTerminalFor(file) {
    const directoryPath = consoleDirectoryFor(file).get_path();

    for (const candidate of TERMINAL_CANDIDATES) {
        if (!isInstalled(candidate.program))
            continue;
        const tabArgument = candidate.tabbed ? ['--tab'] : [];
        const commandline = [candidate.program, ...tabArgument, ...candidate.build(directoryPath)].join(' ');
        if (runCommand(commandline, 'Console'))
            return true;
    }

    console.error(`Gridgets: no terminal is installed, so no console could be opened for ${file.get_uri()}`);
    return false;
}

/** Explains why a name cannot be used, or returns an empty string when it can. */
// One list of rules, read in two shapes: the dialog can afford a sentence, and a 3x3 cell
// cannot, so the inline reason is the same rule with fewer words in it.
const UNUSABLE_NAME_RULES = [
    {
        unusable: name => !name || !name.trim(),
        message: 'The name cannot be empty.',
        short: 'Cannot be empty',
    },
    {
        unusable: name => name !== name.trim(),
        message: 'A name cannot start or end with a space.',
        short: 'No spaces at the ends',
    },
    {
        unusable: name => name.includes('/'),
        message: 'A name cannot contain a slash.',
        short: 'No slash',
    },
    {
        unusable: name => name === '.' || name === '..',
        message: 'That name is not usable for a folder.',
        short: 'Not usable',
    },
];

export function describeUnusableName(name, { short = false } = {}) {
    const rule = UNUSABLE_NAME_RULES.find(candidate => candidate.unusable(name));
    if (!rule)
        return '';
    return short ? rule.short : rule.message;
}

// A name already in use is counted up rather than refused, so nothing is overwritten.
export function renameEntry(file, newName) {
    const problem = describeUnusableName(newName);
    if (problem)
        return { ok: false, message: problem };

    const directory = file.get_parent();
    if (directory.get_child(newName).equal(file))
        return { ok: true, name: newName, message: '' };

    // A name that is taken is counted rather than refused, the way a file manager does it.
    // The caller has to use the returned name: it is not necessarily the one that was asked
    // for, and repointing the icon at the requested one would leave it on a file that does
    // not exist.
    const name = freeNameIn(directory, newName);
    if (!name) {
        return {
            ok: false,
            message: `there are already too many entries called “${newName}”.`,
        };
    }

    const target = directory.get_child(name);
    try {
        // No OVERWRITE flag, so the free name above is enforced by the filesystem too.
        file.move(target, Gio.FileCopyFlags.NONE, null, null);
        return { ok: true, name, message: '' };
    } catch (error) {
        console.error(`Gridgets: ${file.get_uri()} could not be renamed:`, error);
        return { ok: false, message: `“${newName}” could not be used.` };
    }
}

export function createDesktopFolder(name) {
    const problem = describeUnusableName(name);
    if (problem)
        return { ok: false, message: problem };

    const directory = Gio.File.new_for_path(desktopDirectoryPath());
    const folder = directory.get_child(name);
    if (folder.query_exists(null))
        return { ok: false, message: `“${name}” is already on the desktop.` };

    try {
        folder.make_directory(null);
        return { ok: true, message: '' };
    } catch (error) {
        console.error(`Gridgets: a folder called ${name} could not be created:`, error);
        return { ok: false, message: `“${name}” could not be created.` };
    }
}
