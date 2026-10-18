import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

// Installed per page rather than at import time, and removed with the page so the provider
// is not left attached to the display.
export function addPageStylesheet(page, cssData) {
    const provider = new Gtk.CssProvider();
    provider.load_from_data(cssData, cssData.length);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    page.connect('destroy', () => {
        Gtk.StyleContext.remove_provider_for_display(Gdk.Display.get_default(), provider);
    });
}

export function clearBox(box) {
    let child = box.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
    }
}

// Returns 1 when no display is available (headless or early init).
export function getConnectedMonitorsCount() {
    const display = Gdk.Display.get_default();
    if (!display) {
        return 1;
    }
    return display.get_monitors().get_n_items();
}

export function buildMonitorEntries(monitorCount) {
    const entries = [];
    for (let i = 0; i < monitorCount; i++) {
        entries.push({ label: `Monitor ${i + 1}`, key: String(i) });
    }
    return entries;
}
