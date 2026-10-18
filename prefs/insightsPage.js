import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { DESKTOP_APP_KEY, getGridgetsDataDir, todayDateString, MOOD_LEVELS, MONTH_NAMES_ABBREVIATED } from '../utils/widgetUtils.js';
import { listMoodDatesSync, getMood, loadDatesSync, clearMoodStoreCache } from '../utils/moodStore.js';
import { clearBox, addPageStylesheet } from './displayUtils.js';

// Bar, dot and breakdown fills are coloured from the same level colours the mood widgets
// use, so a mood reads as the same colour everywhere it appears.
const MOOD_COLOR_RULES = MOOD_LEVELS
    .map(mood => `    .mood-fill-${mood.level} { background-color: ${mood.color}; }`)
    .join('\n');

const STAT_CARD_PADDING = '12px 14px';
const STAT_VALUE_FONT_SIZE = '1.5rem';
const MOOD_DOT_SIZE_PX = 10;
const PILL_RADIUS_PX = 9999;
const BAR_RADIUS_PX = 3;
const TROUGH_MIN_HEIGHT_PX = 6;

const CSS_DATA = `
    .mood-level-1 { color: var(--destructive-color); }
    .mood-level-2 { color: var(--warning-color); }
    .mood-level-3 { color: var(--accent-color); }
    .mood-level-4 { color: var(--success-color); }
    .mood-level-5 { color: var(--blue-2); }
    .mood-none { color: color-mix(in srgb, currentColor 55%, transparent); }
    .insights-empty-title { font-weight: bold; }
    .insights-empty-desc { color: color-mix(in srgb, currentColor 55%, transparent); }
    .stat-card { padding: ${STAT_CARD_PADDING}; }
    .stat-card .stat-value { font-size: ${STAT_VALUE_FONT_SIZE}; font-weight: bold; }
    .mood-dot { min-width: ${MOOD_DOT_SIZE_PX}px; min-height: ${MOOD_DOT_SIZE_PX}px; border-radius: ${PILL_RADIUS_PX}px; }
    .mood-fill-none { background-color: color-mix(in srgb, currentColor 18%, transparent); }
    .mood-bar { border-radius: ${BAR_RADIUS_PX}px; }
    .mood-trough {
        background-color: color-mix(in srgb, currentColor 15%, transparent);
        border-radius: ${BAR_RADIUS_PX}px;
        min-height: ${TROUGH_MIN_HEIGHT_PX}px;
    }
    .st-bar { border-radius: ${BAR_RADIUS_PX}px; background-color: var(--accent-color); }
    .st-bar-none { border-radius: ${BAR_RADIUS_PX}px; background-color: color-mix(in srgb, currentColor 18%, transparent); }
${MOOD_COLOR_RULES}
`;

const HOURS_PER_DAY = 24;
const RANGE_REFRESH_DEBOUNCE_MS = 120;

// The day's app breakdown shows this many rows before the rest collapse behind a
// "Show all" expander, so a heavy day does not push the page into a long scroll.
const APPS_PREVIEW_COUNT = 5;

// Upper bound on bars in the Daily Mood chart, keeping each one wide enough to read.
const MAX_CHART_DAYS = 180;

const RANGE_PRESETS = [
    { label: 'Last 7 Days', shortLabel: '7 days', days: 7 },
    { label: 'Last 14 Days', shortLabel: '14 days', days: 14 },
    { label: 'Last 30 Days', shortLabel: '30 days', days: 30 },
    { label: 'All Time', shortLabel: 'All time', days: 0 },
];

function formatCompactDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0)
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    return `${minutes}m`;
}

function formatDateString(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    return `${d} ${MONTH_NAMES_ABBREVIATED[m - 1]} ${y}`;
}

// The hour the summary names, in whichever clock the rest of the desktop uses.
function formatHourOfDay(hour, use24Hour) {
    if (use24Hour)
        return `${hour.toString().padStart(2, '0')}:00`;
    const suffix = hour < 12 ? 'AM' : 'PM';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12} ${suffix}`;
}

function daysAgoDate(days) {
    const dt = GLib.DateTime.new_now_local().add_days(-days);
    const y = dt.get_year();
    const m = dt.get_month().toString().padStart(2, '0');
    const d = dt.get_day_of_month().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Reading GDesktopAppInfo needs the GioUnix platform library, which stays out of the
// preferences process. The same name and icon are available from the plain Gio app
// list, so the details are resolved from there instead.
let appDetailsById = null;

function getAppDetailsById() {
    if (appDetailsById !== null)
        return appDetailsById;
    appDetailsById = new Map();
    for (const appInfo of Gio.AppInfo.get_all()) {
        const id = appInfo.get_id();
        if (!id || appDetailsById.has(id))
            continue;
        appDetailsById.set(id, {
            displayName: appInfo.get_display_name(),
            icon: appInfo.get_icon(),
        });
    }
    return appDetailsById;
}

function getAppDetails(appId) {
    const detailsById = getAppDetailsById();
    return detailsById.get(appId) || detailsById.get(`${appId}.desktop`) || null;
}

function resolveAppName(appId) {
    if (appId === DESKTOP_APP_KEY) return 'Desktop';
    const details = getAppDetails(appId);
    if (details && details.displayName && details.displayName.trim() !== '')
        return details.displayName;
    const base = appId.replace(/\.desktop$/i, '');
    return base.split('.').pop() || appId;
}

function listDayFiles() {
    const dir = getGridgetsDataDir('screen-time');
    const files = [];
    try {
        const dirFile = Gio.File.new_for_path(dir);
        const enumerator = dirFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (name.endsWith('.json'))
                files.push(name.replace('.json', ''));
        }
    } catch (error) {
        // getGridgetsDataDir creates the directory, so a failure here is a real
        // read error rather than a missing folder.
        console.error('Gridgets: could not read screen-time data:', error.message);
    }
    files.sort().reverse();
    return files;
}

// Parsing a day means opening the file and running JSON.parse over it, and a year
// of history means doing that a few hundred times. The summary is therefore kept
// per day and revalidated against the file's mtime, so changing the range filter
// costs a stat per day instead of a full re-read, while an external change to the
// data is still picked up.
const daySummaryCache = new Map();

function loadDaySummary(dateString) {
    const filePath = GLib.build_filenamev([getGridgetsDataDir('screen-time'), `${dateString}.json`]);
    const file = Gio.File.new_for_path(filePath);

    let mtimeSeconds = -1;
    try {
        mtimeSeconds = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
            .get_modified_time();
    } catch (_e) {
        mtimeSeconds = -1;
    }
    const cached = daySummaryCache.get(dateString);
    if (cached && cached.mtimeSeconds === mtimeSeconds)
        return cached.summary;

    const summary = parseDaySummary(file, dateString);
    daySummaryCache.set(dateString, { mtimeSeconds, summary });
    return summary;
}

function parseDaySummary(file, dateString) {
    try {
        const [ok, bytes] = file.load_contents(null);
        if (!ok) return null;
        const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (!data || typeof data.apps !== 'object') return null;
        let totalSeconds = 0;
        const appTotals = [];
        const hourTotals = new Array(HOURS_PER_DAY).fill(0);
        for (const [key, hours] of Object.entries(data.apps)) {
            if (!Array.isArray(hours)) continue;
            let appTotal = 0;
            for (let h = 0; h < Math.min(hours.length, HOURS_PER_DAY); h++) {
                appTotal += hours[h];
                hourTotals[h] += hours[h];
            }
            if (appTotal > 0)
                appTotals.push({ key, seconds: appTotal });
            totalSeconds += appTotal;
        }
        appTotals.sort((a, b) => b.seconds - a.seconds);
        return { date: dateString, totalSeconds, apps: appTotals, hourTotals };
    } catch (error) {
        // A day file that will not read is expected to be skippable, but an
        // exception thrown by this function is a bug, and returning null for
        // both makes the page read as "no screen time" rather than "broken".
        console.error(`Gridgets: could not parse screen-time day ${dateString}:`, error.message);
        return null;
    }
}

function filterByRange(dates, rangeIndex) {
    const preset = RANGE_PRESETS[rangeIndex];
    if (preset.days === 0)
        return dates;
    // "Last N days" spans today plus the N-1 days before it, matching the chart's window;
    // offsetting by the full N would add an extra day the label and chart do not show.
    const cutoff = daysAgoDate(preset.days - 1);
    return dates.filter(d => d >= cutoff);
}

function buildEmptyState(iconName, title, description) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_top: 16,
        margin_bottom: 16,
    });
    const icon = new Gtk.Image({
        icon_name: iconName,
        pixel_size: 48,
        opacity: 0.4,
    });
    const titleLabel = new Gtk.Label({
        label: title,
        css_classes: ['insights-empty-title'],
        halign: Gtk.Align.CENTER,
    });
    const descLabel = new Gtk.Label({
        label: description,
        css_classes: ['insights-empty-desc'],
        halign: Gtk.Align.CENTER,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        max_width_chars: 40,
    });
    box.append(icon);
    box.append(titleLabel);
    box.append(descLabel);
    return box;
}

function buildDayNavRow(title) {
    const row = new Adw.ActionRow({ title });
    const prevBtn = new Gtk.Button({
        icon_name: 'go-previous-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Previous date',
    });
    const nextBtn = new Gtk.Button({
        icon_name: 'go-next-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Next date',
    });
    row.add_suffix(prevBtn);
    row.add_suffix(nextBtn);
    return { row, prevBtn, nextBtn };
}

// One of the three headline figures at the top of the Screen Time section. The caption
// is fixed at build time; only the value changes as the range or the data does.
function buildStatCard(caption) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        css_classes: ['card', 'stat-card'],
    });
    const valueLabel = new Gtk.Label({
        label: '—',
        halign: Gtk.Align.START,
        css_classes: ['stat-value'],
    });
    const captionLabel = new Gtk.Label({
        label: caption,
        halign: Gtk.Align.START,
        css_classes: ['dim-label'],
    });
    box.append(valueLabel);
    box.append(captionLabel);
    return {
        box,
        setValue(text) {
            valueLabel.set_text(text);
        },
        setCaption(text) {
            captionLabel.set_text(text);
        },
    };
}

// A single application's usage for the selected day: icon, name and duration, then the
// share of the day as a bar and a percentage.
function buildAppRow(app, dayTotal) {
    const appDetails = getAppDetails(app.key);
    const gicon = appDetails ? appDetails.icon : null;
    const percentage = dayTotal > 0 ? Math.round((app.seconds / dayTotal) * 100) : 0;

    const row = new Adw.ActionRow({
        title: resolveAppName(app.key),
        subtitle: formatCompactDuration(app.seconds),
    });
    const icon = new Gtk.Image({
        icon_name: gicon ? null : 'application-x-generic-symbolic',
        pixel_size: 32,
        valign: Gtk.Align.CENTER,
    });
    if (gicon)
        icon.gicon = gicon;
    const progress = new Gtk.ProgressBar({
        fraction: dayTotal > 0 ? app.seconds / dayTotal : 0,
        show_text: false,
        valign: Gtk.Align.CENTER,
        width_request: 120,
        tooltip_text: `${percentage}% of selected day`,
    });
    const percentageLabel = new Gtk.Label({
        label: `${percentage}%`,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END,
        width_request: 42,
    });
    row.add_prefix(icon);
    row.add_suffix(progress);
    row.add_suffix(percentageLabel);
    return row;
}

const MOOD_MAX_LEVEL = Math.max(...MOOD_LEVELS.map(mood => mood.level));

// The Patterns section groups the mood scale into a positive and a negative half, so a
// level at or above GOOD or at or below LOW is what "good" and "low" days mean there.
const GOOD_MOOD_LEVEL = 4;
const LOW_MOOD_LEVEL = 2;

// A compact "Xh Ym avg" for a set of day totals, or a dash when there is nothing to
// average rather than a misleading 0m.
function averageDurationLabel(totals) {
    if (totals.length === 0)
        return '—';
    const avg = Math.round(totals.reduce((sum, seconds) => sum + seconds, 0) / totals.length);
    return `${formatCompactDuration(avg)} avg`;
}

// The chart's own labels drop the year, which the range makes redundant and which would
// crowd the axis.
function formatShortDate(dateString) {
    const [, m, d] = dateString.split('-').map(Number);
    return `${d} ${MONTH_NAMES_ABBREVIATED[m - 1]}`;
}

// One column per day, each a bar whose height is the mood level and whose colour is the
// level colour; an unlogged day keeps a short faint stub so the axis stays evenly spaced.
function buildMoodChart(entries) {
    const chart = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
        height_request: 120,
        css_classes: ['mood-chart'],
    });
    for (const entry of entries) {
        const column = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: true,
            vexpand: true,
        });
        column.append(new Gtk.Box({ vexpand: true }));
        const height = entry.level > 0
            ? 10 + Math.round((entry.level / MOOD_MAX_LEVEL) * 100)
            : 4;
        const bar = new Gtk.Box({
            height_request: height,
            valign: Gtk.Align.END,
            css_classes: entry.level > 0
                ? ['mood-bar', `mood-fill-${entry.level}`]
                : ['mood-bar', 'mood-fill-none'],
        });
        bar.set_tooltip_text(entry.level > 0
            ? `${formatDateString(entry.date)}  ·  ${entry.label}`
            : `${formatDateString(entry.date)}  ·  Not logged`);
        column.append(bar);
        chart.append(column);
    }
    return chart;
}

// The screen-time counterpart to the mood chart: one bar per day, height scaled to the
// busiest day in the range, with a faint stub for days that were never tracked.
function buildStChart(entries) {
    const maxSeconds = Math.max(0, ...entries.map(entry => entry.seconds));
    const safeMax = maxSeconds || 1;
    const chart = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 2,
        height_request: 120,
    });

    // GTK 4 fixes its tooltip hover delay at 500ms and no longer exposes a setting for it,
    // so an instant readout is a popover shown on motion instead of a native tooltip.
    const tipLabel = new Gtk.Label();
    const tip = new Gtk.Popover({
        autohide: false,
        has_arrow: true,
        position: Gtk.PositionType.TOP,
        child: tipLabel,
        css_classes: ['tooltip'],
        can_focus: false,
    });
    const showTip = (column, text) => {
        tipLabel.set_text(text);
        // A popover can only point at one widget at a time, so it is detached before
        // being re-parented to the column under the cursor.
        if (tip.get_parent())
            tip.unparent();
        tip.set_parent(column);
        tip.popup();
    };
    const hideTip = () => {
        if (tip.get_parent())
            tip.popdown();
    };

    for (const entry of entries) {
        const column = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: true,
            vexpand: true,
        });
        column.append(new Gtk.Box({ vexpand: true }));
        const height = entry.seconds > 0
            ? 10 + Math.round((entry.seconds / safeMax) * 100)
            : 4;
        const bar = new Gtk.Box({
            height_request: height,
            valign: Gtk.Align.END,
            css_classes: entry.seconds > 0 ? ['st-bar'] : ['st-bar-none'],
        });
        column.append(bar);

        const text = entry.seconds > 0
            ? `${formatDateString(entry.date)}  ·  ${formatCompactDuration(entry.seconds)}`
            : `${formatDateString(entry.date)}  ·  No activity`;
        const motion = new Gtk.EventControllerMotion();
        motion.connect('enter', () => showTip(column, text));
        motion.connect('leave', hideTip);
        column.add_controller(motion);

        chart.append(column);
    }
    // The popover is parented to a column, so it has to go before the chart tears those
    // down; otherwise it would outlive its parent.
    chart.connect('destroy', () => {
        hideTip();
        if (tip.get_parent())
            tip.unparent();
    });
    return chart;
}

// Start, middle and end of the range, spaced evenly under the bars.
function buildChartAxis(entries) {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, margin_top: 4 });
    if (entries.length === 0)
        return box;
    const labels = [
        { entry: entries[0], halign: Gtk.Align.START },
        { entry: entries[Math.floor((entries.length - 1) / 2)], halign: Gtk.Align.CENTER },
        { entry: entries[entries.length - 1], halign: Gtk.Align.END },
    ];
    for (const { entry, halign } of labels) {
        box.append(new Gtk.Label({
            label: formatShortDate(entry.date),
            halign,
            hexpand: true,
            css_classes: ['dim-label', 'caption'],
        }));
    }
    return box;
}

function buildMoodLegend() {
    const wrap = new Adw.WrapBox({ child_spacing: 12, line_spacing: 6, margin_top: 10 });
    const items = [
        ...MOOD_LEVELS.map(mood => ({ label: mood.label, fillClass: `mood-fill-${mood.level}` })),
        { label: 'Not logged', fillClass: 'mood-fill-none' },
    ];
    for (const item of items) {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, valign: Gtk.Align.CENTER });
        box.append(new Gtk.Box({ css_classes: ['mood-dot', item.fillClass], valign: Gtk.Align.CENTER }));
        box.append(new Gtk.Label({ label: item.label, css_classes: ['caption'] }));
        wrap.append(box);
    }
    return wrap;
}

// A breakdown row is built once and then only its fill width and count change, so the
// level colour and label stay put across refreshes.
function buildMoodBreakdownRow(mood) {
    const row = new Adw.ActionRow({ title: mood.label });
    row.add_prefix(new Gtk.Box({ css_classes: ['mood-dot', `mood-fill-${mood.level}`], valign: Gtk.Align.CENTER }));

    const trough = new Gtk.Box({ css_classes: ['mood-trough'], width_request: 150, valign: Gtk.Align.CENTER });
    const fill = new Gtk.Box({ css_classes: ['mood-bar', `mood-fill-${mood.level}`], width_request: 2, valign: Gtk.Align.FILL });
    trough.append(fill);
    row.add_suffix(trough);

    const countLabel = new Gtk.Label({
        label: '0 days',
        width_request: 60,
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
        css_classes: ['dim-label'],
    });
    row.add_suffix(countLabel);

    return {
        row,
        setCount(count, maxCount) {
            countLabel.set_text(`${count} ${count === 1 ? 'day' : 'days'}`);
            fill.width_request = maxCount > 0 && count > 0
                ? Math.max(3, Math.round((count / maxCount) * 150))
                : 2;
        },
    };
}

function buildExportDialog(parentWindow, title, defaultFilename, jsonString) {
    const dialog = new Gtk.FileDialog({ title });
    const filter = new Gtk.FileFilter();
    filter.set_name('JSON');
    filter.add_mime_type('application/json');
    filter.add_pattern('*.json');
    const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
    filters.append(filter);
    dialog.set_filters(filters);
    dialog.set_initial_name(defaultFilename);
    dialog.save(parentWindow, null, (dlg, result) => {
        try {
            const file = dlg.save_finish(result);
            if (file) {
                let path = file.get_path();
                if (!path && file.get_uri())
                    path = GLib.filename_from_uri(file.get_uri())[0];
                if (path) {
                    const bytes = new TextEncoder().encode(jsonString);
                    const gioFile = Gio.File.new_for_path(path);
                    gioFile.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                }
            }
        } catch (error) {
            if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                console.error('Export dialog failed:', error);
        }
    });
}

export function buildInsightsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Insights',
        icon_name: 'org.gnome.Extensions-symbolic',
    });
    addPageStylesheet(page, CSS_DATA);

    // Async work started by this page must not resume once the page is gone:
    // its callbacks write straight into the rows below.
    const pageCancellable = new Gio.Cancellable();
    let rangeRefreshId = 0;
    page.connect('destroy', () => {
        pageCancellable.cancel();
        if (rangeRefreshId)
            GLib.Source.remove(rangeRefreshId);
    });

    let selectedRange = 2;
    let stAvailableDates = [];
    let stSelectedDate = '';
    let stAppEntries = [];
    let moodAvailableDates = [];
    let moodSelectedDate = '';

    // The range presets read as a single segmented control across the top of the page
    // rather than a labelled combo row, matching how the rest of the shell offers ranges.
    const rangeGroup = new Adw.PreferencesGroup();
    const rangeToggle = new Adw.ToggleGroup({
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
    });
    RANGE_PRESETS.forEach((preset, index) => {
        rangeToggle.add(new Adw.Toggle({ name: String(index), label: preset.shortLabel }));
    });
    rangeToggle.set_active_name(String(selectedRange));
    // Each refresh walks the whole selected range, so stepping through the presets
    // is coalesced into one rebuild once the user settles on a value.
    rangeToggle.connect('notify::active-name', () => {
        selectedRange = Number(rangeToggle.get_active_name());
        if (rangeRefreshId)
            GLib.Source.remove(rangeRefreshId);
        rangeRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RANGE_REFRESH_DEBOUNCE_MS, () => {
            rangeRefreshId = 0;
            refreshAll();
            return GLib.SOURCE_REMOVE;
        });
    });
    const rangeBox = new Gtk.Box({ halign: Gtk.Align.CENTER });
    rangeBox.append(rangeToggle);
    rangeGroup.add(rangeBox);
    page.add(rangeGroup);

    const stSummaryGroup = new Adw.PreferencesGroup({
        title: 'Screen Time',
        description: 'Desktop usage over the selected period.',
    });
    const stCardsBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        homogeneous: true,
    });
    const stTotalCard = buildStatCard('Total');
    const stAvgCard = buildStatCard('Daily average');
    const stPeakHourCard = buildStatCard('Peak hour');
    stCardsBox.append(stTotalCard.box);
    stCardsBox.append(stAvgCard.box);
    stCardsBox.append(stPeakHourCard.box);
    // A group keeps its action rows in one list and any other widget in a block after
    // that list, so the cards cannot share a group with the two rows and still sit above
    // them. They get the titled group, and the rows follow in their own panel.
    stSummaryGroup.add(stCardsBox);
    page.add(stSummaryGroup);

    const stMostUsedRow = new Adw.ActionRow({ title: 'Most Used App' });
    const stBestRow = new Adw.ActionRow({ title: 'Most Productive Day' });
    const stRowsGroup = new Adw.PreferencesGroup();
    stRowsGroup.add(stMostUsedRow);
    stRowsGroup.add(stBestRow);
    page.add(stRowsGroup);

    const stChartGroup = new Adw.PreferencesGroup({ title: 'Daily Activity' });
    const stChartBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 6,
        margin_bottom: 6,
    });
    stChartGroup.add(stChartBox);
    page.add(stChartGroup);

    // Both destructive actions live together, apart from the figures, and are placed last
    // so they sit after the export actions rather than interrupting the overview above.
    const stClearGroup = new Adw.PreferencesGroup();
    const clearStBtn = new Adw.ActionRow({
        title: 'Clear Screen Time Data',
        activatable: true,
    });
    clearStBtn.connect('activated', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'Clear All Screen Time Data?',
            body: 'This cannot be undone.',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('clear', 'Clear');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dlg, responseId) => {
            // Dismissing changes nothing, so it must not trigger a rebuild.
            if (responseId === 'clear')
                clearAllScreenTimeData(refreshAll, pageCancellable);
        });
        dialog.present(page.get_root());
    });
    stClearGroup.add(clearStBtn);

    const clearMoodBtn = new Adw.ActionRow({
        title: 'Clear Mood Data',
        activatable: true,
    });
    clearMoodBtn.connect('activated', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'Clear All Mood Data?',
            body: 'This cannot be undone.',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('clear', 'Clear');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dlg, responseId) => {
            // Dismissing changes nothing, so it must not trigger a rebuild.
            if (responseId === 'clear')
                clearAllMoodData(refreshAll, pageCancellable);
        });
        dialog.present(page.get_root());
    });
    stClearGroup.add(clearMoodBtn);

    const stEmptyBox = buildEmptyState(
        'preferences-system-time-symbolic',
        'No screen time data yet',
        'Screen time tracking will appear here once the Screen Time widget is active on your desktop.'
    );
    const stEmptyGroup = new Adw.PreferencesGroup();
    stEmptyGroup.add(stEmptyBox);
    page.add(stEmptyGroup);

    const stDayGroup = new Adw.PreferencesGroup({
        title: 'Day Detail',
        description: 'Browse daily usage breakdowns.',
    });
    // The day's date and total live in the group description, and the two arrows sit in
    // the group header, so the whole section reads as one navigable day.
    const stNavBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
    const stPrevBtn = new Gtk.Button({
        icon_name: 'go-previous-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['circular'],
        tooltip_text: 'Previous date',
    });
    const stNextBtn = new Gtk.Button({
        icon_name: 'go-next-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['circular'],
        tooltip_text: 'Next date',
    });
    stNavBox.append(stPrevBtn);
    stNavBox.append(stNextBtn);
    stDayGroup.set_header_suffix(stNavBox);

    const stAppsBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        margin_top: 4,
        margin_bottom: 4,
        css_classes: ['boxed-list'],
    });
    stDayGroup.add(stAppsBox);
    page.add(stDayGroup);

    stPrevBtn.connect('clicked', () => {
        if (stAvailableDates.length === 0) return;
        const idx = stAvailableDates.indexOf(stSelectedDate);
        const newIdx = (idx < 0) ? 0 : idx + 1;
        if (newIdx < stAvailableDates.length) {
            stSelectedDate = stAvailableDates[newIdx];
            refreshStDayDetail();
        }
    });
    stNextBtn.connect('clicked', () => {
        if (stAvailableDates.length === 0) return;
        const idx = stAvailableDates.indexOf(stSelectedDate);
        const newIdx = (idx < 0) ? 0 : idx - 1;
        if (newIdx >= 0) {
            stSelectedDate = stAvailableDates[newIdx];
            refreshStDayDetail();
        }
    });

    const moodSummaryGroup = new Adw.PreferencesGroup({
        title: 'Mood',
        description: 'Your logged mood, summarised.',
    });
    const moodCardsBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        homogeneous: true,
    });
    const moodAvgCard = buildStatCard('Average');
    const moodDaysCard = buildStatCard('Days logged');
    const moodBestWeekCard = buildStatCard('Best week');
    moodCardsBox.append(moodAvgCard.box);
    moodCardsBox.append(moodDaysCard.box);
    moodCardsBox.append(moodBestWeekCard.box);
    moodSummaryGroup.add(moodCardsBox);
    page.add(moodSummaryGroup);

    const moodChartGroup = new Adw.PreferencesGroup({ title: 'Daily Mood' });
    const moodChartBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 6,
        margin_bottom: 6,
    });
    moodChartGroup.add(moodChartBox);
    page.add(moodChartGroup);

    const moodBreakdownGroup = new Adw.PreferencesGroup({
        title: 'Mood Breakdown',
        description: 'How your logged days were spread.',
    });
    // One row per level, built once and reordered on refresh so the most common mood
    // sits at the top.
    const moodBreakdownRows = MOOD_LEVELS.map(mood => buildMoodBreakdownRow(mood));
    for (const breakdownRow of moodBreakdownRows)
        moodBreakdownGroup.add(breakdownRow.row);
    page.add(moodBreakdownGroup);

    const moodEmptyBox = buildEmptyState(
        'face-smile-big-symbolic',
        'No mood data yet',
        'Log your first mood in the Mood Logger widget to start tracking how you feel.'
    );
    const moodEmptyGroup = new Adw.PreferencesGroup();
    moodEmptyGroup.add(moodEmptyBox);
    page.add(moodEmptyGroup);

    const moodDayGroup = new Adw.PreferencesGroup({
        title: 'Day Detail',
        description: 'Browse your mood entry for each day.',
    });
    const moodNav = buildDayNavRow('Selected Day');
    moodDayGroup.add(moodNav.row);
    const moodDayIcon = new Gtk.Image({
        icon_size: Gtk.IconSize.LARGE,
        valign: Gtk.Align.CENTER,
    });
    const moodDayLabel = new Gtk.Label({
        label: 'No data',
        valign: Gtk.Align.CENTER,
    });
    const moodDayBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        margin_top: 8,
        margin_bottom: 8,
    });
    moodDayBox.append(moodDayIcon);
    moodDayBox.append(moodDayLabel);
    moodDayGroup.add(moodDayBox);
    page.add(moodDayGroup);

    moodNav.prevBtn.connect('clicked', () => {
        if (moodAvailableDates.length === 0) return;
        const idx = moodAvailableDates.indexOf(moodSelectedDate);
        const newIdx = (idx < 0) ? 0 : idx + 1;
        if (newIdx < moodAvailableDates.length) {
            moodSelectedDate = moodAvailableDates[newIdx];
            refreshMoodDayDetail();
        }
    });
    moodNav.nextBtn.connect('clicked', () => {
        if (moodAvailableDates.length === 0) return;
        const idx = moodAvailableDates.indexOf(moodSelectedDate);
        const newIdx = (idx < 0) ? 0 : idx - 1;
        if (newIdx >= 0) {
            moodSelectedDate = moodAvailableDates[newIdx];
            refreshMoodDayDetail();
        }
    });

    const patternsGroup = new Adw.PreferencesGroup({
        title: 'Patterns',
        description: 'Mood alongside your screen time.',
    });
    const patternBestRow = new Adw.ActionRow({ title: 'Best Day' });
    const patternBestValue = new Gtk.Label({ valign: Gtk.Align.CENTER });
    patternBestRow.add_suffix(patternBestValue);
    const patternCommonRow = new Adw.ActionRow({ title: 'Most Common Mood' });
    const patternCommonValue = new Gtk.Label({ valign: Gtk.Align.CENTER });
    patternCommonRow.add_suffix(patternCommonValue);
    const patternGoodRow = new Adw.ActionRow({ title: 'Screen Time on Good Days' });
    const patternGoodValue = new Gtk.Label({ valign: Gtk.Align.CENTER });
    patternGoodRow.add_suffix(patternGoodValue);
    const patternLowRow = new Adw.ActionRow({ title: 'Screen Time on Low Days' });
    const patternLowValue = new Gtk.Label({ valign: Gtk.Align.CENTER });
    patternLowRow.add_suffix(patternLowValue);
    patternsGroup.add(patternBestRow);
    patternsGroup.add(patternCommonRow);
    patternsGroup.add(patternGoodRow);
    patternsGroup.add(patternLowRow);
    page.add(patternsGroup);

    const exportGroup = new Adw.PreferencesGroup({
        title: 'Export Data',
        description: 'Save your insights data to a JSON file.',
    });
    const exportStBtn = new Adw.ActionRow({
        title: 'Export Screen Time Data',
        activatable: true,
    });
    exportStBtn.connect('activated', () => {
        const exportData = buildScreenTimeExportData(stAvailableDates);
        const json = JSON.stringify(exportData, null, 2);
        const filename = `gridgets-screen-time-${todayDateString()}.json`;
        buildExportDialog(page.get_root(), 'Export Screen Time Data', filename, json);
    });
    exportGroup.add(exportStBtn);

    const exportMoodBtn = new Adw.ActionRow({
        title: 'Export Mood Data',
        activatable: true,
    });
    exportMoodBtn.connect('activated', () => {
        const exportData = buildMoodExportData(moodAvailableDates);
        const json = JSON.stringify(exportData, null, 2);
        const filename = `gridgets-mood-${todayDateString()}.json`;
        buildExportDialog(page.get_root(), 'Export Mood Data', filename, json);
    });
    exportGroup.add(exportMoodBtn);
    page.add(exportGroup);
    page.add(stClearGroup);

    function buildScreenTimeExportData(dates) {
        const days = [];
        let grandTotal = 0;
        const appAgg = {};
        for (const dateStr of dates) {
            const summary = loadDaySummary(dateStr);
            if (summary) {
                grandTotal += summary.totalSeconds;
                const trackedApps = summary.apps.filter(app => app.key !== DESKTOP_APP_KEY);
                for (const app of trackedApps)
                    appAgg[app.key] = (appAgg[app.key] || 0) + app.seconds;
                days.push({
                    date: summary.date,
                    totalSeconds: summary.totalSeconds,
                    apps: trackedApps.map(app => ({
                        id: app.key,
                        name: resolveAppName(app.key),
                        seconds: app.seconds,
                    })),
                });
            }
        }
        const topApps = Object.entries(appAgg)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id, seconds]) => ({ id, name: resolveAppName(id), seconds }));
        return {
            exported: GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S'),
            range: RANGE_PRESETS[selectedRange].label,
            summary: {
                // From days, not dates: a day file that would not parse is not in the
                // export, so counting it here would put a total in the summary that the
                // days array does not support and divide by a number nothing else used.
                totalDays: days.length,
                totalSeconds: grandTotal,
                dailyAverageSeconds: days.length > 0 ? Math.round(grandTotal / days.length) : 0,
                topApps,
            },
            days,
        };
    }

    function buildMoodExportData(dates) {
        loadDatesSync(dates);
        const entries = [];
        for (const dateStr of dates) {
            const level = getMood(dateStr);
            if (level > 0) {
                const mood = MOOD_LEVELS.find(m => m.level === level);
                entries.push({
                    date: dateStr,
                    level,
                    label: mood ? mood.label : 'Unknown',
                });
            }
        }
        let totalLevel = 0;
        for (const e of entries) totalLevel += e.level;
        const avg = entries.length > 0 ? totalLevel / entries.length : 0;
        // Null rather than the nearest level: with no entries the average is 0, which
        // sits below every level, so the reduce would always resolve to level 1 and
        // report an average mood of Sad for a range that was never logged.
        const avgMood = entries.length > 0
            ? MOOD_LEVELS.reduce((prev, curr) =>
                Math.abs(curr.level - avg) < Math.abs(prev.level - avg) ? curr : prev)
            : null;
        return {
            exported: GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S'),
            range: RANGE_PRESETS[selectedRange].label,
            summary: {
                totalEntries: entries.length,
                averageLevel: Number(avg.toFixed(2)),
                averageLabel: avgMood ? avgMood.label : null,
            },
            entries,
        };
    }

    function updateNavButtons() {
        const stHasData = stAvailableDates.length > 0;
        const stIdx = stAvailableDates.indexOf(stSelectedDate);
        stPrevBtn.set_sensitive(stHasData && stIdx < stAvailableDates.length - 1);
        stNextBtn.set_sensitive(stHasData && stIdx > 0);

        const moodHasData = moodAvailableDates.length > 0;
        const moodIdx = moodAvailableDates.indexOf(moodSelectedDate);
        moodNav.prevBtn.set_sensitive(moodHasData && moodIdx < moodAvailableDates.length - 1);
        moodNav.nextBtn.set_sensitive(moodHasData && moodIdx > 0);
    }

    function refreshStSummary() {
        const preset = RANGE_PRESETS[selectedRange];
        stSummaryGroup.set_description(preset.days === 0
            ? 'Desktop usage over all time.'
            : `Desktop usage over the last ${preset.days} days.`);

        const hasData = stAvailableDates.length > 0;
        stChartGroup.set_visible(hasData);
        if (!hasData) {
            stTotalCard.setValue('—');
            stAvgCard.setValue('—');
            stPeakHourCard.setValue('—');
            stMostUsedRow.set_subtitle('No data yet');
            stBestRow.set_subtitle('No data yet');
            return;
        }
        let grandTotal = 0;
        const appAgg = {};
        const rangeHourTotals = new Array(HOURS_PER_DAY).fill(0);
        let bestDay = { date: '', total: 0 };
        // Days that resolve to a summary are the only ones the chart colours in; the rest
        // of the range is drawn from this map too, so a missing day is a stub rather than
        // another failed read.
        const rangeTotals = new Map();
        for (const dateStr of stAvailableDates) {
            const summary = loadDaySummary(dateStr);
            if (summary) {
                grandTotal += summary.totalSeconds;
                rangeTotals.set(dateStr, summary.totalSeconds);
                for (let hour = 0; hour < HOURS_PER_DAY; hour++)
                    rangeHourTotals[hour] += summary.hourTotals[hour];
                for (const app of summary.apps) {
                    if (app.key === DESKTOP_APP_KEY) continue;
                    appAgg[app.key] = (appAgg[app.key] || 0) + app.seconds;
                }
                if (summary.totalSeconds > bestDay.total)
                    bestDay = { date: summary.date, total: summary.totalSeconds };
            }
        }
        stTotalCard.setValue(formatCompactDuration(grandTotal));
        stAvgCard.setValue(formatCompactDuration(Math.round(grandTotal / stAvailableDates.length)));

        // The busiest hour of the day across the whole range. A tie keeps the earlier
        // hour, which reads as "starts at" rather than drifting into the evening.
        let peakHour = 0;
        for (let hour = 1; hour < HOURS_PER_DAY; hour++) {
            if (rangeHourTotals[hour] > rangeHourTotals[peakHour])
                peakHour = hour;
        }
        stPeakHourCard.setValue(rangeHourTotals[peakHour] > 0
            ? formatHourOfDay(peakHour, settings.get_boolean('time-format-24h'))
            : '—');

        const topApp = Object.entries(appAgg).sort((a, b) => b[1] - a[1])[0];
        stMostUsedRow.set_subtitle(topApp ? resolveAppName(topApp[0]) : 'None');
        stBestRow.set_subtitle(bestDay.date ? `${formatDateString(bestDay.date)}  ·  ${formatCompactDuration(bestDay.total)}` : 'None');

        const stEarliest = stAvailableDates.reduce((min, date) => (date < min ? date : min), stAvailableDates[0]);
        const chartDates = buildChartDates(stEarliest);
        const chartEntries = chartDates.map(date => ({
            date,
            seconds: rangeTotals.get(date) || 0,
        }));
        clearBox(stChartBox);
        stChartBox.append(buildStChart(chartEntries));
        stChartBox.append(buildChartAxis(chartEntries));
    }

    function renderStApps() {
        clearBox(stAppsBox);
        const dayTotal = stDayTotalSeconds;

        if (stAppEntries.length === 0) {
            stAppsBox.append(buildEmptyState(
                'application-x-generic-symbolic',
                'No application activity',
                'Applications used on this day will appear here.'
            ));
            return;
        }

        for (const app of stAppEntries.slice(0, APPS_PREVIEW_COUNT))
            stAppsBox.append(buildAppRow(app, dayTotal));

        // The remainder collapse behind one expander row: clicking it reveals the rest
        // instead of paging through them a handful at a time.
        if (stAppEntries.length > APPS_PREVIEW_COUNT) {
            const expander = new Adw.ExpanderRow({
                title: `Show all ${stAppEntries.length} applications`,
            });
            for (const app of stAppEntries.slice(APPS_PREVIEW_COUNT))
                expander.add_row(buildAppRow(app, dayTotal));
            stAppsBox.append(expander);
        }
    }

    let stDayTotalSeconds = 0;

    function refreshStDayDetail() {
        clearBox(stAppsBox);
        stAppEntries = [];
        stDayTotalSeconds = 0;
        if (!stSelectedDate) {
            stDayGroup.set_description('No data');
            stAppsBox.append(buildEmptyState(
                'folder-open-symbolic',
                'No data for this day',
                'Navigate to a different day or change the date range above.'
            ));
            updateNavButtons();
            return;
        }
        const summary = loadDaySummary(stSelectedDate);
        if (!summary) {
            stDayGroup.set_description(`${formatDateString(stSelectedDate)}  ·  —`);
            stAppsBox.append(buildEmptyState(
                'folder-open-symbolic',
                'No data for this day',
                'Navigate to a different day or change the date range above.'
            ));
            updateNavButtons();
            return;
        }
        stDayGroup.set_description(`${formatDateString(stSelectedDate)}  ·  ${formatCompactDuration(summary.totalSeconds)}`);
        stDayTotalSeconds = summary.totalSeconds;
        stAppEntries = summary.apps.filter(app => app.key !== DESKTOP_APP_KEY);
        renderStApps();
        updateNavButtons();
    }

    // A chart only draws one bar per day, so a very long history would compress the bars
    // to slivers. "All time" therefore starts at the earliest logged date and is capped
    // to the most recent window. `earliest` is the oldest date known for the series.
    function buildChartDates(earliest) {
        const preset = RANGE_PRESETS[selectedRange];
        const end = GLib.DateTime.new_now_local();
        let start;
        if (preset.days === 0) {
            if (!earliest) return [];
            const [y, m, d] = earliest.split('-').map(Number);
            start = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
        } else {
            start = end.add_days(-(preset.days - 1));
        }
        const dates = [];
        for (let dt = start; dt.compare(end) <= 0; dt = dt.add_days(1))
            dates.push(dt.format('%Y-%m-%d'));
        return dates.slice(-MAX_CHART_DAYS);
    }

    function refreshMoodSummary() {
        const hasData = moodAvailableDates.length > 0;
        moodSummaryGroup.set_visible(hasData);
        moodChartGroup.set_visible(hasData);
        moodBreakdownGroup.set_visible(hasData);

        if (!hasData) {
            moodAvgCard.setValue('—');
            moodAvgCard.setCaption('Average');
            moodDaysCard.setValue('0');
            moodDaysCard.setCaption('Days logged');
            moodBestWeekCard.setValue('—');
            moodBestWeekCard.setCaption('Best week');
            return;
        }
        loadDatesSync(moodAvailableDates);
        let totalLevel = 0;
        let loggedCount = 0;
        const levelCounts = new Map();
        const weekScores = {};
        for (const dateStr of moodAvailableDates) {
            const level = getMood(dateStr);
            if (level <= 0) continue;
            totalLevel += level;
            loggedCount++;
            levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
            const [y, m, d] = dateStr.split('-').map(Number);
            const dt = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
            const weekKey = `${dt.get_year()}-W${dt.get_week_of_year().toString().padStart(2, '0')}`;
            if (!weekScores[weekKey]) weekScores[weekKey] = { total: 0, count: 0 };
            weekScores[weekKey].total += level;
            weekScores[weekKey].count++;
        }

        if (loggedCount === 0) {
            moodAvgCard.setValue('—');
            moodAvgCard.setCaption('Average');
            moodDaysCard.setValue('0');
            moodDaysCard.setCaption('Days logged');
            moodBestWeekCard.setValue('—');
            moodBestWeekCard.setCaption('Best week');
            return;
        }

        const avg = totalLevel / loggedCount;
        const avgMood = MOOD_LEVELS.reduce((prev, curr) => Math.abs(curr.level - avg) < Math.abs(prev.level - avg) ? curr : prev);
        moodAvgCard.setValue(`${avg.toFixed(1)} / 5`);
        moodAvgCard.setCaption(`Average · ${avgMood.label}`);
        moodDaysCard.setValue(`${loggedCount}`);
        moodDaysCard.setCaption('Days logged');

        const weekEntries = Object.entries(weekScores).sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count));
        if (weekEntries.length > 0) {
            moodBestWeekCard.setValue(`W${weekEntries[0][0].split('-W')[1]}`);
            moodBestWeekCard.setCaption('Best week');
        } else {
            moodBestWeekCard.setValue('—');
            moodBestWeekCard.setCaption('Best week');
        }

        const moodEarliest = moodAvailableDates.reduce((min, date) => (date < min ? date : min), moodAvailableDates[0]);
        const chartDates = buildChartDates(moodEarliest);
        loadDatesSync(chartDates);
        const entries = chartDates.map(date => {
            const level = getMood(date);
            const mood = MOOD_LEVELS.find(item => item.level === level);
            return { date, level, label: mood ? mood.label : '' };
        });
        clearBox(moodChartBox);
        moodChartBox.append(buildMoodChart(entries));
        moodChartBox.append(buildChartAxis(entries));
        moodChartBox.append(buildMoodLegend());

        const maxCount = Math.max(0, ...MOOD_LEVELS.map(mood => levelCounts.get(mood.level) || 0));
        // Rows are re-added in descending count order; the sort is stable, so equal counts
        // keep their level order.
        const breakdownOrder = MOOD_LEVELS
            .map((mood, index) => ({ breakdownRow: moodBreakdownRows[index], count: levelCounts.get(mood.level) || 0 }))
            .sort((a, b) => b.count - a.count);
        for (const { breakdownRow, count } of breakdownOrder) {
            moodBreakdownGroup.remove(breakdownRow.row);
            moodBreakdownGroup.add(breakdownRow.row);
            breakdownRow.setCount(count, maxCount);
        }
    }

    function refreshMoodDayDetail() {
        if (!moodSelectedDate) {
            moodNav.row.set_subtitle('No data');
            moodDayIcon.set_from_icon_name('face-plain-symbolic');
            moodDayLabel.set_text('No data');
            for (const cls of moodDayIcon.get_css_classes()) {
                if (cls.startsWith('mood-level-') || cls === 'mood-none')
                    moodDayIcon.remove_css_class(cls);
            }
            moodDayIcon.add_css_class('mood-none');
            updateNavButtons();
            return;
        }
        moodNav.row.set_subtitle(formatDateString(moodSelectedDate));
        loadDatesSync([moodSelectedDate]);
        for (const cls of moodDayIcon.get_css_classes()) {
            if (cls.startsWith('mood-level-') || cls === 'mood-none')
                moodDayIcon.remove_css_class(cls);
        }
        const level = getMood(moodSelectedDate);
        if (level > 0) {
            const mood = MOOD_LEVELS.find(m => m.level === level);
            moodDayIcon.set_from_icon_name(mood.icon);
            moodDayIcon.add_css_class(`mood-level-${mood.level}`);
            moodDayLabel.set_text(`${mood.label}  ·  Level ${level}/5`);
        } else {
            moodDayIcon.set_from_icon_name('face-plain-symbolic');
            moodDayIcon.add_css_class('mood-none');
            moodDayLabel.set_text('No mood logged this day');
        }
        updateNavButtons();
    }

    // Patterns is a relationship view over the whole history rather than the selected
    // range, so it reports the same thing whichever range is active above.
    function refreshPatterns() {
        const allMoodDates = listMoodDatesSync();
        patternsGroup.set_visible(allMoodDates.length > 0);
        if (allMoodDates.length === 0)
            return;
        loadDatesSync(allMoodDates);

        // Only days with a screen-time file carry a total; a mood logged on a day without
        // one still counts as logged but is left out of the averages.
        const stDates = new Set(listDayFiles());
        const levelCounts = new Map();
        let totalLogged = 0;
        let best = null;
        const goodTotals = [];
        const lowTotals = [];
        for (const date of allMoodDates) {
            const level = getMood(date);
            if (level <= 0) continue;
            totalLogged++;
            levelCounts.set(level, (levelCounts.get(level) || 0) + 1);

            const hasScreenTime = stDates.has(date);
            const seconds = hasScreenTime ? (loadDaySummary(date)?.totalSeconds ?? 0) : 0;
            if (hasScreenTime) {
                if (level >= GOOD_MOOD_LEVEL)
                    goodTotals.push(seconds);
                else if (level <= LOW_MOOD_LEVEL)
                    lowTotals.push(seconds);
            }
            // Best day is the highest mood; ties go to the day with the most screen time,
            // which keeps a flat scale from collapsing onto an arbitrary date.
            if (!best || level > best.level || (level === best.level && seconds > best.seconds))
                best = { date, level, seconds };
        }
        if (totalLogged === 0) {
            patternsGroup.set_visible(false);
            return;
        }

        const bestMood = MOOD_LEVELS.find(mood => mood.level === best.level);
        patternBestRow.set_subtitle(formatDateString(best.date));
        patternBestValue.set_text(bestMood ? bestMood.label : 'Unknown');

        let commonLevel = 0;
        for (const [level, count] of levelCounts) {
            if (count > (levelCounts.get(commonLevel) || 0))
                commonLevel = level;
        }
        const commonMood = MOOD_LEVELS.find(mood => mood.level === commonLevel);
        patternCommonRow.set_subtitle(`${levelCounts.get(commonLevel)} of ${totalLogged} logged days`);
        patternCommonValue.set_text(commonMood ? commonMood.label : 'Unknown');

        // The bands are named from the levels they cover, so renaming a mood keeps the
        // rows accurate.
        const goodLabels = MOOD_LEVELS.filter(mood => mood.level >= GOOD_MOOD_LEVEL).map(mood => mood.label).join(' or ');
        const lowLabels = MOOD_LEVELS.filter(mood => mood.level <= LOW_MOOD_LEVEL).map(mood => mood.label).join(' or ');
        patternGoodRow.set_subtitle(`Days rated ${goodLabels}`);
        patternGoodValue.set_text(averageDurationLabel(goodTotals));
        patternLowRow.set_subtitle(`Days rated ${lowLabels}`);
        patternLowValue.set_text(averageDurationLabel(lowTotals));
    }

    function refreshAll() {
        const allFiles = listDayFiles();
        stAvailableDates = filterByRange(allFiles, selectedRange);
        if (stAvailableDates.length > 0) {
            if (!stSelectedDate || !stAvailableDates.includes(stSelectedDate))
                stSelectedDate = stAvailableDates[0];
        } else {
            stSelectedDate = '';
        }

        const hasStData = stAvailableDates.length > 0;
        stEmptyGroup.set_visible(!hasStData);
        stDayGroup.set_visible(hasStData);

        refreshStSummary();
        refreshStDayDetail();

        const allMoodDates = listMoodDatesSync();
        moodAvailableDates = filterByRange(allMoodDates, selectedRange);
        if (moodAvailableDates.length > 0) {
            if (!moodSelectedDate || !moodAvailableDates.includes(moodSelectedDate))
                moodSelectedDate = moodAvailableDates[0];
        } else {
            moodSelectedDate = '';
        }

        const hasMoodData = moodAvailableDates.length > 0;
        moodEmptyGroup.set_visible(!hasMoodData);
        moodDayGroup.set_visible(hasMoodData);

        refreshMoodSummary();
        refreshMoodDayDetail();
        refreshPatterns();
    }

    refreshAll();
    return page;
}

function clearAllScreenTimeData(callback, cancellable) {
    const dir = getGridgetsDataDir('screen-time');
    const dirFile = Gio.File.new_for_path(dir);
    dirFile.enumerate_children_async(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (sourceObj, res) => {
            if (cancellable.is_cancelled()) return;
            try {
                const enumerator = sourceObj.enumerate_children_finish(res);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (name.endsWith('.json')) {
                        const file = Gio.File.new_for_path(GLib.build_filenamev([dir, name]));
                        file.delete(null);
                    }
                }
                daySummaryCache.clear();
            } catch (e) {
                if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                console.error('Error clearing screen time data:', e);
            }
            if (callback) callback();
        }
    );
}

function clearAllMoodData(callback, cancellable) {
    const dir = getGridgetsDataDir('mood');
    const dirFile = Gio.File.new_for_path(dir);
    dirFile.enumerate_children_async(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (sourceObj, res) => {
            if (cancellable.is_cancelled()) return;
            try {
                // Mood history is one file per month under a year directory, so the year
                // level is walked first and each month file deleted from there.
                const enumerator = sourceObj.enumerate_children_finish(res);
                let yearInfo;
                while ((yearInfo = enumerator.next_file(null)) !== null) {
                    if (yearInfo.get_file_type() !== Gio.FileType.DIRECTORY) continue;
                    const yearName = yearInfo.get_name();
                    const yearDir = Gio.File.new_for_path(GLib.build_filenamev([dir, yearName]));
                    let monthEnum;
                    try {
                        monthEnum = yearDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                    } catch (error) {
                        // An unreadable year is skipped so the rest of the history still
                        // clears, but the reason is logged rather than swallowed.
                        console.error(`Gridgets: could not read mood year ${yearName}:`, error.message);
                        continue;
                    }
                    let monthInfo;
                    while ((monthInfo = monthEnum.next_file(null)) !== null) {
                        const name = monthInfo.get_name();
                        if (!name.endsWith('.json')) continue;
                        Gio.File.new_for_path(GLib.build_filenamev([dir, yearName, name])).delete(null);
                    }
                }
                // The store caches month files in memory, so it has to be told the files
                // are gone or the cleared data would keep rendering from the cache.
                clearMoodStoreCache();
            } catch (e) {
                if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                console.error('Error clearing mood data:', e);
            }
            if (callback) callback();
        }
    );
}
