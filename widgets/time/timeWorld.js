import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { resolveExplicitFontFamily, resolveUse24h, resolveWidgetSurfaces } from '../../utils/widgetUtils.js';
import { resolveCityList, dayRelationLabel, formatOffsetLabel, isDaytimeHour, offsetFrom, zoneFor } from '../../utils/worldClock.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { setWeatherIcon } from '../../utils/weatherIcons.js';
import { connectShortClick, launchApplication } from '../../utils/widgetInteractions.js';

// The face is square at every preset, so the scale reference is square too.
const BASE_CONTAINER_SIZE = 240;

// A row is one line wide, so the width sets these and not the height. In the widget's
// own font at 113px with tabular figures, "New York" at 10px is 41px and "12:41" at 14px
// is 39px, which is most of the 99px the cell has left after padding. The time is what
// gives way; the city is the elastic part of the row and ellipsizes on a wider font.
const TIME_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.displayMD;
// The floor the dense case steps down to. A small cell lands on 14px from the scale
// maths, so this only bites when the rows are crowded.
const TIME_MIN_FONT_SIZE = 11;
const CITY_BASE_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;
// The one label below MIN_FONT_SIZE.metadata: two letters naming the half-day, and
// 24-hour mode hides it entirely.
const MER_MIN_FONT_SIZE = 8;
const MER_TIME_RATIO = 0.3;
// The second line under the city: the day, and how far the zone sits from the local one.
const META_TIME_RATIO = 0.62;
const BADGE_TIME_RATIO = 1.45;
const ROW_PADDING_RATIO = 0.42;
const PADDING_RATIO = 0.5;
const ROW_GAP_RATIO = 0.22;
const MER_GAP_RATIO = 0.06;
const COLUMN_GAP_RATIO = 0.55;
const MIN_PADDING_PX = 4;
const MIN_ROW_GAP_PX = 2;
const CORNER_RADIUS_PX = 12;
const DAY_ICON = 'weather-clear';
const NIGHT_ICON = 'weather-clear-night';
/** Applied to the type sizes, and so to everything derived from them. */
const ROW_SIZE_RATIO = 0.86;
const ROW_SHRINK_MIN_RATIO = 0.7;
/** Left over so rounding the row heights up cannot tip the total over the face. */
const ROW_HEIGHT_SLACK_PX = 8;

const CITY_LABEL = { weight: TYPOGRAPHY_WEIGHT.semibold };
const META_LABEL = { weight: TYPOGRAPHY_WEIGHT.regular, opacity: TEXT_OPACITY.secondary };
const TIME_LABEL = { weight: TYPOGRAPHY_WEIGHT.bold };
// The colon is dimmed and slightly smaller so the digits carry the eye. It is a label of its
// own rather than markup inside one: clutter_text has no set_markup to reach for.
const COLON_LABEL = { weight: TYPOGRAPHY_WEIGHT.regular, opacity: TEXT_OPACITY.secondary };
const AMPM_LABEL = { weight: TYPOGRAPHY_WEIGHT.bold, opacity: TEXT_OPACITY.secondary };

// The badge tints, warm by day and cool by night, kept faint so the glyph reads as the
// subject rather than the disc behind it.
const DAY_BADGE_COLOR = 'rgba(245, 197, 66, 0.22)';
const NIGHT_BADGE_COLOR = 'rgba(129, 140, 248, 0.22)';

/** Everything one row is measured from, at a given type reduction. */
function measureRows(scale, reduction) {
    const typeScale = ROW_SIZE_RATIO * reduction;
    const time = Math.max(TIME_MIN_FONT_SIZE,
        Math.round(scaleFontSize(TIME_BASE_FONT_SIZE, scale, TIME_MIN_FONT_SIZE) * typeScale));
    const city = Math.max(MIN_FONT_SIZE.metadata,
        Math.round(scaleFontSize(CITY_BASE_FONT_SIZE, scale, MIN_FONT_SIZE.metadata) * typeScale));

    const padding = Math.max(MIN_PADDING_PX, Math.round(time * PADDING_RATIO));
    const rowPadding = Math.max(MIN_PADDING_PX, Math.round(time * ROW_PADDING_RATIO));
    const rowGap = Math.max(MIN_ROW_GAP_PX, Math.round(time * ROW_GAP_RATIO));
    const merGap = Math.max(1, Math.round(time * MER_GAP_RATIO));
    const badge = Math.max(TYPOGRAPHY_SIZE.iconSm, Math.round(time * BADGE_TIME_RATIO));
    const meta = Math.max(MER_MIN_FONT_SIZE, Math.round(city * META_TIME_RATIO));
    const mer = Math.max(MER_MIN_FONT_SIZE, Math.round(time * MER_TIME_RATIO));

    // What one row needs for its own contents: the taller of the badge and the two lines.
    const content = Math.max(badge, city + merGap + meta);
    return {
        time,
        city,
        meta,
        mer,
        badge,
        padding,
        rowPadding,
        rowGap,
        merGap,
        columnGap: Math.max(2, Math.round(time * COLUMN_GAP_RATIO)),
        natural: content + rowPadding * 2,
    };
}

function rowMetrics(scale, cityCount, faceHeight) {
    let m = measureRows(scale, 1);
    const usable = (Number.isFinite(faceHeight) ? faceHeight : 0) - ROW_HEIGHT_SLACK_PX;

    if (cityCount > 0 && usable > 0) {
        const chrome = m.padding * 2 + m.rowGap * (cityCount - 1);
        const available = usable - chrome;
        const needed = m.natural * cityCount;
        // Too tall for the face: step the type down until it fits, rather than letting the
        // list overflow into a scrollbar. The floor is what a very short face bottoms out
        // at, and only then does scrolling take over.
        if (available > 0 && needed > available)
            m = measureRows(scale, Math.max(ROW_SHRINK_MIN_RATIO, available / needed));
    }

    return m;
}

function getFormattedTime(now, timezoneId, is24h) {
    const tz = timezoneId
        ? (GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId))
        : null;
    return formatTimeParts(tz ? now.to_timezone(tz) : now.to_local(), is24h);
}

function buildWorldClockUI(layoutBox, fontCss, metrics, cities, surfaces) {
    const { card } = surfaces;
    // Labels inherit their colour and carry their own weight, so a resize restyles a
    // label through the same call that built it.
    const labelCss = (sizePx, { weight = null, opacity = null } = {}) => {
        let style = `${fontCss}font-size: ${sizePx}px; color: inherit;`;
        if (weight !== null) style += ` font-weight: ${weight};`;
        if (opacity !== null) style += ` opacity: ${opacity};`;
        return style;
    };

    const applyRowStyles = (entry, m) => {
        entry.cityLabel.style = labelCss(m.city, CITY_LABEL);
        entry.metaLabel.style = labelCss(m.meta, META_LABEL);
        entry.hourLabel.style = labelCss(m.time, TIME_LABEL);
        entry.minuteLabel.style = labelCss(m.time, TIME_LABEL);
        entry.colonLabel.style = labelCss(Math.round(m.time * 0.8), COLON_LABEL);
        entry.ampmLabel.style = labelCss(m.mer, AMPM_LABEL);
        entry.timeBox.style = `spacing: ${m.merGap}px;`;
        entry.rowBox.style = `spacing: ${m.columnGap}px; padding: ${m.rowPadding}px ${m.rowPadding}px;`;
        entry.rowPanel.style = `border-radius: ${CORNER_RADIUS_PX}px; background-color: ${card};`;
        // The tint belongs to the entry, not to this pass: restyling on a resize must not
        // put a night badge back to its day colour until the next tick.
        entry.badgeSize = m.badge;
        entry.badge.style = `width: ${m.badge}px; height: ${m.badge}px; border-radius: 999px;`
            + ` background-color: ${entry.badgeTint};`;
        // icon_size, not a font size: the colour icons are loaded from disk as a gicon and
        // a font size would leave them at their default 16px whatever the badge is doing.
        entry.icon.icon_size = Math.round(m.badge * 0.72);
    };

    const mainContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${metrics.padding}px; spacing: ${metrics.rowGap}px;`,
    });

    const rows = [];
    for (const city of cities) {
        const cityLabel = new St.Label({
            text: city.name || '',
            x_align: Clutter.ActorAlign.START,
        });
        // A long name gives way rather than pushing the time off the row.
        cityLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        // The day, and how far this zone sits from the local one, on one muted line.
        const metaLabel = new St.Label({
            text: '',
            x_align: Clutter.ActorAlign.START,
        });

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${metrics.merGap}px;`,
        });
        textBox.add_child(cityLabel);
        textBox.add_child(metaLabel);

        const icon = new St.Icon({
            icon_name: DAY_ICON,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const badge = new St.Widget({
            style: `background-color: ${DAY_BADGE_COLOR}; border-radius: 999px;`,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        badge.add_child(icon);

        const hourLabel = new St.Label({ text: '00' });
        const colonLabel = new St.Label({ text: ':' });
        const minuteLabel = new St.Label({ text: '00' });
        const ampmLabel = new St.Label({ text: '' });
        const timeBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        timeBox.add_child(hourLabel);
        timeBox.add_child(colonLabel);
        timeBox.add_child(minuteLabel);
        timeBox.add_child(ampmLabel);

        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        rowBox.add_child(badge);
        rowBox.add_child(textBox);
        rowBox.add_child(timeBox);

        // The panel is the row's background, separate from the box inside it, because the
        // fill has to reach the edges of the rounded rectangle while the padding holds the
        // contents off them.
        // The rows share whatever height the container has between them, so the face is
        // filled rather than the rows packing against the top of it and leaving the rest
        // empty. The contents are centred inside each row, so a taller row reads as a
        // taller panel and not as text adrift in it.
        const rowPanel = new St.Widget({
            x_expand: true,
            y_expand: true,
            style: `border-radius: ${CORNER_RADIUS_PX}px; background-color: ${card};`,
            layout_manager: new Clutter.BinLayout(),
        });
        rowPanel.add_child(rowBox);

        const entry = {
            rowPanel, rowBox, badge, icon, textBox, cityLabel, metaLabel,
            timeBox, hourLabel, colonLabel, minuteLabel, ampmLabel,
            badgeTint: DAY_BADGE_COLOR,
            isDay: null,
            badgeSize: metrics.badge,
        };
        applyRowStyles(entry, metrics);
        rows.push(entry);
        mainContainer.add_child(rowPanel);
    }

    // Any face can now be given to the widget, including one too short for its cities, so
    // the list scrolls. The bar is external so it only appears when there is something
    // below the fold.
    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    scrollView.set_child(mainContainer);
    layoutBox.add_child(scrollView);

    return {
        rows,
        cities,
        zones: cities.map(city => zoneFor(city.timezone)),
        applyScale: nextMetrics => {
            mainContainer.style = `padding: ${nextMetrics.padding}px;`
                + ` spacing: ${nextMetrics.rowGap}px;`;
            for (const entry of rows)
                applyRowStyles(entry, nextMetrics);
        },
    };
}

function updateWorldTimes(ui, is24h) {
    // One reading for every row: a read per city could straddle a minute boundary and
    // leave one row on the previous minute.
    const now = GLib.DateTime.new_now_utc();
    const localZone = GLib.TimeZone.new_local();
    const localNow = now.to_timezone(localZone);

    for (let i = 0; i < ui.rows.length; i++) {
        const row = ui.rows[i];
        const zone = ui.zones[i];
        const cityNow = now.to_timezone(zone);
        const parts = formatTimeParts(cityNow, is24h);

        // formatTimeParts hands back "HH:MM" as one string, so it is split back apart to
        // drive the dimmed colon as a label of its own.
        const [hours, minutes] = parts.time.split(':');
        row.hourLabel.set_text(hours);
        row.colonLabel.set_text(':');
        row.minuteLabel.set_text(minutes);
        row.ampmLabel.set_text(parts.ampm);
        row.ampmLabel.visible = !is24h && parts.ampm !== '';

        const dayLabel = dayRelationLabel(cityNow, localNow);
        const offset = formatOffsetLabel(offsetFrom(zone, localZone, now));
        row.metaLabel.set_text(offset === 'Local time' ? dayLabel : `${dayLabel} · ${offset}`);

        const isDay = isDaytimeHour(cityNow.get_hour());
        if (row.isDay !== isDay) {
            row.isDay = isDay;
            setWeatherIcon(row.icon, isDay ? DAY_ICON : NIGHT_ICON);
        }
        const tint = isDay ? DAY_BADGE_COLOR : NIGHT_BADGE_COLOR;
        if (row.badgeTint !== tint) {
            row.badgeTint = tint;
            row.badge.style = `background-color: ${tint}; border-radius: 999px;`
                + ` width: ${row.badgeSize}px; height: ${row.badgeSize}px;`;
        }
    }
}

export function createWorldTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);
    connectShortClick(widgetNode, () => launchApplication('gnome-clocks'));

    const cities = resolveCityList(widgetData.cities);
    // Sized before the first paint, so the initial frame is not drawn at the base size
    // and then restyled by the scaler's first idle pass.
    const initialScale = clampWidgetScale(Math.min(width / BASE_CONTAINER_SIZE, height / BASE_CONTAINER_SIZE));
    const ui = buildWorldClockUI(widgetNode, fontCss,
        rowMetrics(initialScale, cities.length, height), cities,
        resolveWidgetSurfaces(widgetData));

    const state = {
        timerId: null,
    };

    // Read once, not per tick: widgetData is fixed for the node's lifetime, and a global
    // 12/24h change reaches this widget by rebuilding the grid rather than by re-reading.
    const is24h = resolveUse24h(widgetData);
    const updateDisplay = () => updateWorldTimes(ui, is24h);

    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    // The scaler reports the face it settled on, which is what separates a crowded short
    // cell from a roomy one at the same clamped scale.
    attachResponsiveScaler(widgetNode, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (scale, currentWidth, currentHeight) => {
        if (isActorDestroyed(widgetNode))
            return;
        ui.applyScale(rowMetrics(scale, cities.length, currentHeight));
    });

    return widgetNode;
}
