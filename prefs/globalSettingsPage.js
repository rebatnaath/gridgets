import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { createSwitchRow } from './aestheticControls.js';
import { getConnectedMonitorsCount, buildMonitorEntries } from './displayUtils.js';
import { restoreDismissedDesktopIcons } from '../desktopIcons/desktopIcons.js';
import { offerToCreateDesktopFolder } from './desktopFolderPrompt.js';
import { openAppLauncherChooser } from './appLauncherChooser.js';

function buildMonitorGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Monitors',
        description: 'Choose where widgets are displayed by default.',
    });
    const monitorCount = getConnectedMonitorsCount();

    if (monitorCount <= 1) {
        group.add(new Adw.ActionRow({
            title: 'Target Monitor',
            subtitle: 'Only one monitor is currently connected.',
        }));
        return group;
    }

    const labels = [
        'Primary Monitor',
        'All Monitors (Span Canvas)',
        'All Monitors (Independent Grids)',
    ];
    const values = ['primary', 'all', 'each'];
    buildMonitorEntries(monitorCount).forEach(entry => {
        labels.push(entry.label);
        values.push(entry.key);
    });

    const monitorRow = new Adw.ComboRow({
        title: 'Target Monitor',
        subtitle: 'Select the default monitor or layout.',
        model: new Gtk.StringList({ strings: labels }),
    });
    const currentValue = settings.get_string('global-monitor') || 'primary';
    const currentIndex = values.indexOf(currentValue);
    monitorRow.set_selected(currentIndex >= 0 ? currentIndex : 0);
    monitorRow.connect('notify::selected', () => {
        const selectedValue = values[monitorRow.get_selected()];
        if (selectedValue)
            settings.set_string('global-monitor', selectedValue);
    });
    group.add(monitorRow);
    return group;
}

function buildDesktopGridGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop Grid',
        description: 'Configure how widgets are aligned on the desktop.',
    });
    group.add(createSwitchRow(
        'Show Grid Overlay',
        'Display alignment guides while editing the desktop.',
        settings,
        'show-grid'
    ).row);
    return group;
}

function buildDesktopGroup(settings, page) {
    const group = new Adw.PreferencesGroup({
        title: 'Desktop',
        description: 'Draw the contents of your desktop folder on the widget grid.',
    });
    group.add(createSwitchRow(
        'Show Desktop Icons',
        'Entries follow the folder: a file added there appears, and one removed disappears.',
        settings,
        'show-desktop-icons'
    ).row);

    const launchersRow = createSwitchRow(
        'Show Application Launchers',
        'Add entries from your application menu to the grid, alongside the files in your desktop folder.',
        settings,
        'show-app-launchers'
    ).row;
    group.add(launchersRow);

    // Choosing is only meaningful with the toggle on, so the button follows the key rather
    // than being read once: the grid never changes this key, but the switch does.
    const chooseRow = new Adw.ActionRow({
        title: 'Choose Applications',
        subtitle: 'Pick which launchers appear. An entry stays on the grid until you remove it here.',
    });
    const chooseButton = new Gtk.Button({
        label: 'Choose…',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    chooseButton.connect('clicked', () => {
        // get_root is what yields the containing preferences window to be modal against.
        openAppLauncherChooser(settings, page.get_root());
    });
    chooseRow.add_suffix(chooseButton);
    group.add(chooseRow);

    // Launchers are drawn as desktop icons, so with the desktop folder switched off there is
    // nothing for this switch to switch on. Both rows go insensitive rather than left sitting
    // there saving a setting that does nothing.
    const refreshLauncherRows = () => {
        const desktopIconsOn = settings.get_boolean('show-desktop-icons');
        launchersRow.sensitive = desktopIconsOn;
        chooseButton.sensitive = desktopIconsOn && settings.get_boolean('show-app-launchers');
    };

    const showAppId = settings.connect('changed::show-app-launchers', refreshLauncherRows);
    // Asked when the switch is turned on rather than while the page is built, so it never
    // opens a dialog behind the user's back, and only when the folder is actually missing.
    const desktopIconsId = settings.connect('changed::show-desktop-icons', () => {
        refreshLauncherRows();
        if (settings.get_boolean('show-desktop-icons'))
            offerToCreateDesktopFolder(settings, page.get_root())?.present(page.get_root());
    });
    refreshLauncherRows();
    page.connect('destroy', () => {
        settings.disconnect(showAppId);
        settings.disconnect(desktopIconsId);
    });

    // The one action that cannot be done from the desktop itself, since an icon removed
    // from the grid has no menu left to be restored from.
    const restoreRow = new Adw.ActionRow({
        title: 'Restore Hidden Icons',
        subtitle: 'Bring back icons removed from the grid. The files themselves are never touched.',
    });
    const restoreButton = new Gtk.Button({
        label: 'Restore',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    const refreshRestoreButton = () => {
        restoreButton.sensitive = settings.get_strv('dismissed-desktop-icons').length > 0;
    };
    // The grid dismisses an icon from its own context menu, which this page never sees
    // happen, so the button follows the key instead of being read once at build time.
    const dismissedId = settings.connect('changed::dismissed-desktop-icons', refreshRestoreButton);
    restoreButton.connect('clicked', () => restoreDismissedDesktopIcons(settings));
    refreshRestoreButton();
    restoreRow.connect('destroy', () => settings.disconnect(dismissedId));
    restoreRow.add_suffix(restoreButton);
    group.add(restoreRow);

    return group;
}

export function buildGlobalSettingsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Desktop',
        icon_name: 'preferences-system-symbolic',
    });

    page.add(buildMonitorGroup(settings));
    page.add(buildDesktopGridGroup(settings));
    page.add(buildDesktopGroup(settings, page));
    return page;
}
