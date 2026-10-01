import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { resolveExplicitFontFamily, resolveUse24h } from '../../utils/widgetUtils.js';
import { MAX_CITY_COUNT, resolveCityList } from '../../utils/worldClockCities.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, clampWidgetScale, scaleFontSize } from '../../utils/typography.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
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
const ROW_GAP_RATIO = 0.12;
const MER_GAP_RATIO = 0.06;
const PADDING_RATIO = 0.5;
const MIN_PADDING_PX = 4;
const MIN_ROW_GAP_PX = 2;

// Four cities on the small cell is the one crowded case. The reduction is tied to the
// short side rather than the city count alone, because a 4x3 and a 4x4 face both clamp
// to the same scale and only the first is short.
const DENSE_TYPE_RATIO = 0.8;
const DENSE_FACE_MAX_PX = 100;

const CITY_LABEL = { weight: TYPOGRAPHY_WEIGHT.medium, opacity: TEXT_OPACITY.secondary };
const TIME_LABEL = { weight: TYPOGRAPHY_WEIGHT.extrabold };
const AMPM_LABEL = { weight: TYPOGRAPHY_WEIGHT.bold, opacity: TEXT_OPACITY.secondary };

function isDenseFace(cityCount, faceWidth, faceHeight) {
    if (cityCount < MAX_CITY_COUNT)
        return false;
    const shortSide = Math.min(faceWidth, faceHeight);
    return Number.isFinite(shortSide) && shortSide > 0 && shortSide < DENSE_FACE_MAX_PX;
}

// One pass feeds both the first paint and every later resize, so a row cannot be sized
// one way at build and another after a drag. The time leads and the rest follow it.
function rowMetrics(scale, cityCount, faceWidth, faceHeight) {
    const ratio = isDenseFace(cityCount, faceWidth, faceHeight) ? DENSE_TYPE_RATIO : 1;
    const time = Math.max(TIME_MIN_FONT_SIZE, Math.round(scaleFontSize(TIME_BASE_FONT_SIZE, scale, TIME_MIN_FONT_SIZE) * ratio));
    // The city holds its floor, so the time absorbs the whole reduction.
    const city = Math.max(MIN_FONT_SIZE.metadata, Math.round(scaleFontSize(CITY_BASE_FONT_SIZE, scale, MIN_FONT_SIZE.metadata) * ratio));
    return {
        time,
        city,
        mer: Math.max(MER_MIN_FONT_SIZE, Math.round(time * MER_TIME_RATIO)),
        padding: Math.max(MIN_PADDING_PX, Math.round(time * PADDING_RATIO)),
        rowGap: Math.max(MIN_ROW_GAP_PX, Math.round(time * ROW_GAP_RATIO)),
        merGap: Math.max(1, Math.round(time * MER_GAP_RATIO)),
    };
}

function getFormattedTime(now, timezoneId, is24h) {
    const tz = timezoneId
        ? (GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId))
        : null;
    return formatTimeParts(tz ? now.to_timezone(tz) : now.to_local(), is24h);
}

function buildWorldClockUI(layoutBox, fontCss, metrics, cities) {
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
        entry.timeLabel.style = labelCss(m.time, TIME_LABEL);
        entry.ampmLabel.style = labelCss(m.mer, AMPM_LABEL);
        entry.row.style = `spacing: ${m.rowGap}px;`;
        entry.timeBox.style = `spacing: ${m.merGap}px;`;
    };

    const mainContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${metrics.padding}px;`,
    });

    const rows = [];
    for (const city of cities) {
        const cityLabel = new St.Label({
            text: city.name || '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // A long name gives way rather than pushing the time off the row.
        cityLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        const timeLabel = new St.Label({
            text: '00:00',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const ampmLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.END,
        });

        const timeBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.END,
        });
        timeBox.add_child(timeLabel);
        timeBox.add_child(ampmLabel);

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        row.add_child(cityLabel);
        row.add_child(timeBox);

        const entry = { row, timeBox, cityLabel, timeLabel, ampmLabel };
        applyRowStyles(entry, metrics);
        rows.push(entry);

        // A spacer above the first row and below the last, not only between rows, so the
        // gaps match the margins and the rows do not drift to the edges.
        mainContainer.add_child(new St.Widget({ y_expand: true }));
        mainContainer.add_child(row);
    }
    mainContainer.add_child(new St.Widget({ y_expand: true }));

    layoutBox.add_child(mainContainer);

    return {
        rows,
        cities,
        applyScale: (metrics) => {
            mainContainer.style = `padding: ${metrics.padding}px;`;
            for (const entry of rows)
                applyRowStyles(entry, metrics);
        },
    };
}

function updateWorldTimes(ui, is24h) {
    // One reading for every row: a read per city could straddle a minute boundary and
    // leave one row on the previous minute.
    const now = GLib.DateTime.new_now_utc();
    for (let i = 0; i < ui.rows.length; i++) {
        const row = ui.rows[i];
        const data = getFormattedTime(now, ui.cities[i].timezone, is24h);
        row.timeLabel.set_text(data.time);
        row.ampmLabel.set_text(data.ampm);
        row.ampmLabel.visible = !is24h && data.ampm !== '';
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
    const ui = buildWorldClockUI(widgetNode, fontCss, rowMetrics(initialScale, cities.length, width, height), cities);

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
        ui.applyScale(rowMetrics(scale, cities.length, currentWidth, currentHeight));
    });

    return widgetNode;
}
