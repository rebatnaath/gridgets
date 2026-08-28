import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DEFAULT_PANEL_HEIGHT_PX } from './constants.js';

export function getWidgetsForMonitor(widgets, effectiveMonitorIndex, isEachMode = false) {
    if (effectiveMonitorIndex === null || effectiveMonitorIndex === undefined) return widgets;

    const monitors = Main.layoutManager.monitors;
    const primaryMon = Main.layoutManager.primaryMonitor;
    const primaryIndex = monitors.length ? Math.max(0, monitors.indexOf(primaryMon)) : 0;
    const isTargetingPrimaryMonitor = (effectiveMonitorIndex === primaryIndex);

    return widgets.filter(widget => {
        if (!widget.monitor || widget.monitor === 'global') {
            return isEachMode ? isTargetingPrimaryMonitor : true;
        }
        if (widget.monitor === 'primary') {
            return isTargetingPrimaryMonitor;
        }
        const monitorIndex = parseInt(widget.monitor, 10);
        if (!isNaN(monitorIndex)) {
            return monitorIndex === effectiveMonitorIndex;
        }
        return true;
    });
}

export function getPanelHeight() {
    if (Main.panel.height > 0)
        return Main.panel.height;
    if (Main.layoutManager.panelBox.height > 0)
        return Main.layoutManager.panelBox.height;
    return DEFAULT_PANEL_HEIGHT_PX;
}

function resolveMonitorIndex(targetMonitorIndex, settings) {
    if (targetMonitorIndex !== null && typeof targetMonitorIndex === 'number') {
        const nMonitors = global.display.get_n_monitors();
        if (targetMonitorIndex >= 0 && targetMonitorIndex < nMonitors) {
            return targetMonitorIndex;
        }
    }

    const monitorSetting = settings.get_string('global-monitor') || 'primary';
    const nMonitors = global.display.get_n_monitors();

    if (monitorSetting === 'all') return null;

    if (monitorSetting === 'primary') {
        return global.display.get_primary_monitor();
    }

    const monitorIndex = parseInt(monitorSetting, 10);
    if (!isNaN(monitorIndex) && monitorIndex >= 0 && monitorIndex < nMonitors) {
        return monitorIndex;
    }

    return global.display.get_primary_monitor();
}

export function getTargetMonitor(targetMonitorIndex, settings) {
    const nMonitors = global.display.get_n_monitors();
    if (nMonitors === 0) return null;

    const index = resolveMonitorIndex(targetMonitorIndex, settings);
    if (index === null) return null;

    return { geom: global.display.get_monitor_geometry(index), index };
}

export function getEffectiveMonitorIndex(targetMonitorIndex, settings) {
    return resolveMonitorIndex(targetMonitorIndex, settings);
}
