import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

/** Where a caption's text comes from. */
export const CAPTION_SOURCES = Object.freeze({
    FILE_NAME: 'file-name',
    FOLDER_NAME: 'folder-name',
    DATE: 'date',
    CUSTOM: 'custom',
});

/**
 * Reads the stored source, falling back to what widgets written before captions had a
 * source meant: useDateCaption on is a date caption, anything else is custom text.
 */
export function resolveCaptionSource(widget) {
    if (widget.captionSource) {
        // A folder name is meaningless for a single picture, which has no folder to name.
        if (widget.captionSource === CAPTION_SOURCES.FOLDER_NAME && widget.type !== 'slideshow')
            return CAPTION_SOURCES.FILE_NAME;
        return widget.captionSource;
    }
    return widget.useDateCaption === true ? CAPTION_SOURCES.DATE : CAPTION_SOURCES.CUSTOM;
}

/** The available sources, without Folder name for a widget that has no folder. */
export function captionSourceOptions(widgetType) {
    const options = [];
    if (widgetType === 'slideshow')
        options.push({ value: CAPTION_SOURCES.FOLDER_NAME, label: 'Folder name' });
    options.push(
        { value: CAPTION_SOURCES.FILE_NAME, label: 'File name' },
        { value: CAPTION_SOURCES.DATE, label: 'Image date' },
        { value: CAPTION_SOURCES.CUSTOM, label: 'Custom text' },
    );
    return options;
}

/**
 * The source dropdown and the custom entry it governs.
 *
 * `isEnabled` comes from the caller, because what greys the source out depends on whether
 * the caption itself is switched on.
 */
export function buildCaptionSourceControls({ options, selected, customEntry, isEnabled = () => true }) {
    const store = new Gtk.StringList();
    for (const option of options)
        store.append(option.label);

    const dropdown = new Gtk.DropDown({ model: store, hexpand: true, valign: Gtk.Align.CENTER });
    const selectedIndex = options.findIndex(option => option.value === selected);
    dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : options.length - 1);

    const sync = () => {
        const enabled = isEnabled();
        dropdown.set_sensitive(enabled);
        // Greyed rather than hidden, so the layout does not jump and the custom text
        // survives a trip through another source.
        customEntry.set_sensitive(enabled && getSelected() === CAPTION_SOURCES.CUSTOM);
    };
    dropdown.connect('notify::selected', sync);
    sync();

    function getSelected() {
        return options[dropdown.selected].value;
    }

    return { dropdown, getSelected, sync };
}

/** Add-dialog rows: Show Caption, the custom entry, then the source. */
export function buildCaptionRows(grid, startRow, placeholderText, widgetType = 'image') {
    let rowIdx = startRow;

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({ active: true, halign: Gtk.Align.START, valign: Gtk.Align.CENTER });
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({
        placeholder_text: placeholderText || 'Enter caption...',
        hexpand: true,
    });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const sourceLabel = new Gtk.Label({ label: 'Caption From:', xalign: 0, hexpand: true });
    const source = buildCaptionSourceControls({
        options: captionSourceOptions(widgetType),
        selected: CAPTION_SOURCES.CUSTOM,
        customEntry: captionEntry,
        isEnabled: () => showCaptionSwitch.get_active(),
    });
    grid.attach(sourceLabel, 0, rowIdx, 1, 1);
    grid.attach(source.dropdown, 1, rowIdx, 1, 1);
    rowIdx++;

    const syncEnabled = () => {
        sourceLabel.set_sensitive(showCaptionSwitch.get_active());
        source.sync();
    };
    showCaptionSwitch.connect('notify::active', syncEnabled);
    syncEnabled();

    return { captionEntry, showCaptionSwitch, captionSource: source, rowIdx };
}

export function buildCaptionControls(grid, rowIdx, widget, settings, defaultCaption) {
    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({
        text: widget.caption || defaultCaption || '',
        hexpand: true,
        placeholder_text: defaultCaption,
    });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const sourceLabel = new Gtk.Label({ label: 'Caption From:', xalign: 0, hexpand: true });
    const source = buildCaptionSourceControls({
        options: captionSourceOptions(widget.type),
        selected: resolveCaptionSource(widget),
        customEntry: captionEntry,
    });
    grid.attach(sourceLabel, 0, rowIdx, 1, 1);
    grid.attach(source.dropdown, 1, rowIdx, 1, 1);
    rowIdx++;

    const followGlobalLabel = new Gtk.Label({ label: 'Use Global Setting:', xalign: 0, hexpand: true });
    const followGlobalSwitch = new Gtk.Switch({ halign: Gtk.Align.END, valign: Gtk.Align.CENTER });
    followGlobalSwitch.set_active(widget.captionFollowGlobal === true);
    grid.attach(followGlobalLabel, 0, rowIdx, 1, 1);
    grid.attach(followGlobalSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({ halign: Gtk.Align.END, valign: Gtk.Align.CENTER });
    const globalCaptionKey = widget.type === 'slideshow' ? 'slideshow-show-caption' : 'image-show-caption';
    showCaptionSwitch.set_active(widget.showCaption !== undefined ? widget.showCaption : settings.get_boolean(globalCaptionKey));
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    // The per-widget switch overrides the global one, so what it governs greys out with
    // it rather than leaving half the panel live.
    const isCaptionSourceEnabled = () => !followGlobalSwitch.get_active() && showCaptionSwitch.get_active();
    const syncSensitivity = () => {
        const overriding = !followGlobalSwitch.get_active();
        showCaptionSwitch.set_sensitive(overriding);
        // The colour is saved as absent while following global, so the swatch shows the
        // global value rather than a stale per-widget one.
        fgColorLabel.set_sensitive(overriding);
        fgColorBtn.set_sensitive(overriding);
        const enabled = isCaptionSourceEnabled();
        sourceLabel.set_sensitive(enabled);
        source.sync();
    };
    source.dropdown.connect('notify::selected', syncSensitivity);
    followGlobalSwitch.connect('notify::active', syncSensitivity);
    showCaptionSwitch.connect('notify::active', syncSensitivity);

    const fgColorLabel = new Gtk.Label({ label: 'Caption Text Color:', xalign: 0, hexpand: true });
    const fgColorBtn = new Gtk.ColorButton({ halign: Gtk.Align.END, valign: Gtk.Align.CENTER });
    const fgRgba = new Gdk.RGBA();
    fgRgba.parse(widget.captionColor || settings.get_string('global-caption-color') || '#ffffff');
    fgColorBtn.set_rgba(fgRgba);
    grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    // Declared after the rows above it but needed by syncSensitivity, so the first pass
    // happens here.
    syncSensitivity();

    return { captionEntry, showCaptionSwitch, followGlobalSwitch, fgColorBtn, captionSource: source, rowIdx };
}
