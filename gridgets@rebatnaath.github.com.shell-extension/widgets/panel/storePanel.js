import St from 'gi://St';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { addWidget } from '../../utils/widgetUtils.js';

const WIDGET_ENTRIES = [
    {
        category: 'Weather',
        items: [
            { label: 'Weather Standard', addFn: (s) => addWidget(s, { id: 'widget-weather-' + Date.now(), type: 'weather', location: 'London', layout: 'standard' }, 3, 3) },
            { label: 'Weather Minimal', addFn: (s) => addWidget(s, { id: 'widget-weather-' + Date.now(), type: 'weather', location: 'London', layout: 'simple' }, 3, 3) },
            { label: 'Weather Forecast', addFn: (s) => addWidget(s, { id: 'widget-weather-' + Date.now(), type: 'weather', location: 'London', layout: 'forecast' }, 6, 4) },
        ],
    },
    {
        category: 'Music',
        items: [
            { label: 'Music Player', addFn: (s) => addWidget(s, { id: 'widget-music-' + Date.now(), type: 'music' }, 4, 4) },
            { label: 'Music Player (Wide)', addFn: (s) => addWidget(s, { id: 'widget-music-' + Date.now(), type: 'music', isLargeLayout: true }, 8, 4) },
        ],
    },
    {
        category: 'Time & Clock',
        items: [
            { label: 'Time & Date', addFn: (s) => addWidget(s, { id: 'widget-time-' + Date.now(), type: 'time', layout: 'digital' }, 3, 2) },
            { label: 'Calendar', addFn: (s) => addWidget(s, { id: 'widget-calendar-' + Date.now(), type: 'calendar' }, 4, 3) },
        ],
    },
    {
        category: 'Media',
        items: [
            { label: 'Quotes', addFn: (s) => addWidget(s, { id: 'widget-quotes-' + Date.now(), type: 'quotes' }, 3, 3) },
        ],
    },
    {
        category: 'System & Utilities',
        items: [
            { label: 'System Dashboard', addFn: (s) => addWidget(s, { id: 'widget-system-dashboard-' + Date.now(), type: 'system-dashboard' }, 4, 4) },
            { label: 'Pomodoro Timer', addFn: (s) => addWidget(s, { id: 'widget-pomodoro-' + Date.now(), type: 'pomodoro' }, 4, 4) },
            { label: 'CPU & RAM', addFn: (s) => addWidget(s, { id: 'widget-cpu-ram-' + Date.now(), type: 'cpu-ram' }, 4, 2) },
            { label: 'Network Speed', addFn: (s) => addWidget(s, { id: 'widget-network-speed-' + Date.now(), type: 'network-speed' }, 3, 2) },
            { label: 'Quick Notes', addFn: (s) => addWidget(s, { id: 'widget-notes-' + Date.now(), type: 'notes' }, 4, 4) },
            { label: 'Clipboard History', addFn: (s) => addWidget(s, { id: 'widget-clipboard-' + Date.now(), type: 'clipboard' }, 4, 4) },
        ],
    },
];

export const StorePanelButton = GObject.registerClass(
class StorePanelButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Gridgets Store', false);

        this._settings = settings;

        const icon = new St.Icon({
            icon_name: 'software-update-available-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildMenu();
    }

    _buildMenu() {
        for (const category of WIDGET_ENTRIES) {
            const categoryItem = new PopupMenu.PopupSubMenuMenuItem(category.category);

            for (const widget of category.items) {
                const item = new PopupMenu.PopupMenuItem(widget.label);
                item.connect('activate', () => {
                    widget.addFn(this._settings);
                    categoryItem.menu.close();
                    this.menu.close();
                });
                categoryItem.menu.addMenuItem(item);
            }

            this.menu.addMenuItem(categoryItem);
        }
    }
});
