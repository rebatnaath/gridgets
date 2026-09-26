import Gio from 'gi://Gio';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, connectTimerCleanup, registerWidgetCleanup, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { watchCalendarSettings, watchCalendarEvents, eventDatesInMonth, watchDayRollover } from './calendarCommon.js';
import { createMonthGrid, COMPACT_TYPE_SCALE } from './monthGridPanel.js';
import { clampWidgetScale } from '../../utils/typography.js';

const REF_SIZE_PX = 170;

const DATE_POLL_INTERVAL_MS = 60000;

export function createCalendarGridNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    connectShortClick(container, () => launchApplication('gnome-calendar'));

    const state = {
        eventCancellable: new Gio.Cancellable(),
        timerId: null,
    };

    // Assigned below; the settings callback cannot fire before that.
    let monthGrid;
    const settingsWatcher = watchCalendarSettings(config.settings, () => {
        monthGrid.fillDays();
    });

    monthGrid = createMonthGrid({
        container,
        config,
        calendarState: settingsWatcher.state,
        textColor,
        fontCss,
        typeScale: COMPACT_TYPE_SCALE,
        onMonthChanged: () => {},
    });

    const eventWatcher = watchCalendarEvents({
        onEvents: (events) => {
            monthGrid.setEventDates(eventDatesInMonth(events, monthGrid.displayDate));
        },
        isStale: () => isActorDestroyed(container),
        cancellable: state.eventCancellable,
    });

    registerWidgetCleanup(container, () => {
        settingsWatcher.dispose();
        eventWatcher.dispose();
        state.eventCancellable.cancel();
    });

    // Clamped like every other widget, so the type cannot grow past twice its
    // intended size on a large grid.
    monthGrid.applyLayout(width, clampWidgetScale(Math.min(width / REF_SIZE_PX, height / REF_SIZE_PX)));
    attachResponsiveScaler(container, REF_SIZE_PX, REF_SIZE_PX, (_ratio, currentWidth, currentHeight) => {
        const currentScale = clampWidgetScale(
            Math.min(currentWidth / REF_SIZE_PX, currentHeight / REF_SIZE_PX));
        monthGrid.applyLayout(currentWidth, currentScale);
    });
    startPollingTimer(watchDayRollover(monthGrid), DATE_POLL_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    return container;
}
