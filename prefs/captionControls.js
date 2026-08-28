import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import Gdk from 'gi://Gdk';

export function buildCaptionRows(grid, startRow, placeholderText) {
    let rowIdx = startRow;

    const captionLabel = new Gtk.Label({ label: 'Caption:', xalign: 0, hexpand: true });
    const captionEntry = new Gtk.Entry({
        placeholder_text: placeholderText || 'Enter caption...',
        hexpand: true,
    });
    grid.attach(captionLabel, 0, rowIdx, 1, 1);
    grid.attach(captionEntry, 1, rowIdx, 1, 1);
    rowIdx++;

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({ active: true, halign: Gtk.Align.START, valign: Gtk.Align.CENTER });
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    return { captionEntry, showCaptionSwitch, rowIdx };
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

    const showCaptionLabel = new Gtk.Label({ label: 'Show Caption:', xalign: 0, hexpand: true });
    const showCaptionSwitch = new Gtk.Switch({
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
    });
    const globalCaptionKey = widget.type === 'slideshow' ? 'slideshow-show-caption' : 'image-show-caption';
    showCaptionSwitch.set_active(widget.showCaption !== undefined ? widget.showCaption : settings.get_boolean(globalCaptionKey));
    grid.attach(showCaptionLabel, 0, rowIdx, 1, 1);
    grid.attach(showCaptionSwitch, 1, rowIdx, 1, 1);
    rowIdx++;

    const fgColorLabel = new Gtk.Label({ label: 'Caption Text Color:', xalign: 0, hexpand: true });
    const fgColorBtn = new Gtk.ColorButton({ halign: Gtk.Align.END, valign: Gtk.Align.CENTER });
    const fgRgba = new Gdk.RGBA();
    fgRgba.parse(widget.fgColor || settings.get_string('global-foreground-color') || '#ffffff');
    fgColorBtn.set_rgba(fgRgba);
    grid.attach(fgColorLabel, 0, rowIdx, 1, 1);
    grid.attach(fgColorBtn, 1, rowIdx, 1, 1);
    rowIdx++;

    return { captionEntry, showCaptionSwitch, fgColorBtn, rowIdx };
}
