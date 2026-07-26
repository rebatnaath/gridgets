/**
 * ============================================================================
 * PREFERENCES: APPEARANCE PAGE
 * 
 * Defines global appearance defaults (aesthetics) and desktop grid layout
 * configuration.
 * ============================================================================
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { buildGlobalAestheticsGroup, createSwitchRow } from './aestheticControls.js';
import { getWidgets, getMinRequiredCols } from '../utils/widgetUtils.js';

export function buildAppearancePage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Appearance',
        icon_name: 'preferences-desktop-appearance-symbolic',
    });

    page.add(buildGlobalAestheticsGroup(settings));

    const gridGroup = new Adw.PreferencesGroup({
        title: 'Desktop Grid Layout',
        description: 'Configure grid columns and layout visibility.',
    });

    gridGroup.add(createSwitchRow('Visualize Grid Overlay', 'Show grid lines on the desktop for easier widget alignment.', settings, 'show-grid').row);

    const customSizeItem = createSwitchRow('Custom Grid Size', 'Manually specify the number of grid columns.', settings, 'grid-custom-size');
    gridGroup.add(customSizeItem.row);

    const fetchMinCols = () => getMinRequiredCols(getWidgets(settings));

    const minRequiredCols = fetchMinCols();
    const columnsRow = new Adw.ActionRow({
        title: 'Grid Columns',
        subtitle: minRequiredCols > 6
            ? `Number of columns across screen (minimum ${minRequiredCols} required to fit current widgets without overlap).`
            : 'Number of columns across the screen (default 28).',
    });

    const columnsSpin = Gtk.SpinButton.new_with_range(minRequiredCols, 60, 1);
    columnsSpin.set_valign(Gtk.Align.CENTER);
    settings.bind('grid-columns', columnsSpin.get_adjustment(), 'value', 0);

    const updateMinBounds = () => {
        const minCols = fetchMinCols();
        columnsSpin.get_adjustment().set_lower(minCols);
        if (columnsSpin.get_value() < minCols) {
            columnsSpin.set_value(minCols);
        }
        columnsRow.set_subtitle(
            minCols > 6
                ? `Number of columns across screen (minimum ${minCols} required to fit current widgets without overlap).`
                : 'Number of columns across the screen (default 28).'
        );
    };

    const widgetsSignalId = settings.connect('changed::widgets', updateMinBounds);
    page.connect('unrealize', () => {
        if (widgetsSignalId) settings.disconnect(widgetsSignalId);
    });

    columnsRow.add_suffix(columnsSpin);
    gridGroup.add(columnsRow);

    columnsRow.set_sensitive(customSizeItem.switch.get_active());
    customSizeItem.switch.connect('notify::active', () => {
        columnsRow.set_sensitive(customSizeItem.switch.get_active());
    });

    page.add(gridGroup);
    return page;
}
