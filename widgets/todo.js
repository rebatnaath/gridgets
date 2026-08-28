import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, parseCssColor, resolveExplicitFontFamily, resolveTextOnAccentColor, resolveWidgetForegroundColor, saveJsonToFile, saveJsonToFileSync } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, attachButtonFeedback } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const REF_WIDTH_PX = 360;
const REF_HEIGHT_PX = 170;
const CONTAINER_PADDING_V_PX = 14;
const CONTAINER_PADDING_H_PX = 20;
const LEFT_COLUMN_WIDTH_PX = 90;
const TITLE_FONT_SIZE_PX = 13;
const COUNT_FONT_SIZE_PX = 24;
const ADD_BUTTON_SIZE_PX = 32;
const TASK_ROW_RADIUS_PX = 12;
const TASK_ROW_PADDING_V_PX = 9;
const TASK_ROW_PADDING_H_PX = 14;
const TASK_TEXT_FONT_SIZE_PX = 13;
const CHECKBOX_SIZE_PX = 16;
const ROW_SPACING_PX = 8;
const BORDER_ALPHA = 0.14;

const DEFAULT_TASKS = [
    { text: 'Make tea', done: false },
    { text: 'Make cake', done: false },
    { text: 'Linux os', done: false },
];

export function createTodoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    container.style += ` border: 1px solid ${textRgba(BORDER_ALPHA)};`;

    const accentHex = config.globalAccentColor || '#3584e4';
    const accent = parseCssColor(accentHex);
    const accentBytes = `${Math.round(accent.r * 255)},${Math.round(accent.g * 255)},${Math.round(accent.b * 255)}`;
    const accentStyle = `color: ${accentHex};`;
    const rowBackgroundStyle = `background-color: rgba(${accentBytes},0.1);`;

    const todosFilePath = GLib.build_filenamev([
        getGridgetsDataDir('todos'),
        `todo-${config.id}.json`,
    ]);

    let tasks = DEFAULT_TASKS.map(task => ({ ...task }));
    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    let tasksLoaded = false;

    const state = { entryVisible: false };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const leftColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
    });
    mainBox.add_child(leftColumn);

    const titleLabel = new St.Label({
        text: 'Tasks',
        style: `${fontCss}font-size: ${TITLE_FONT_SIZE_PX}px; `
            + `font-weight: 700; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
    });

    const counterRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: 'margin-top: 6px; spacing: 8px;',
    });

    const listIcon = new St.Icon({
        icon_name: 'view-list-symbolic',
        icon_size: 20,
        style: accentStyle,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const countLabel = new St.Label({
        text: '0',
        style: `${fontCss}font-size: ${COUNT_FONT_SIZE_PX}px; `
            + `font-weight: 300; color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    counterRow.add_child(listIcon);
    counterRow.add_child(countLabel);

    const addButton = new St.Button({
        child: new St.Icon({
            icon_name: 'list-add-symbolic',
            icon_size: 18,
            style: accentStyle,
        }),
        reactive: true,
        can_focus: true,
        style_class: 'todo-add-button',
    });

    leftColumn.add_child(titleLabel);
    leftColumn.add_child(counterRow);
    leftColumn.add_child(new St.Widget({ y_expand: true }));
    leftColumn.add_child(addButton);
    attachButtonFeedback(addButton);

    const rightColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'spacing: 8px; padding-left: 10px;',
    });
    mainBox.add_child(rightColumn);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    rightColumn.add_child(scrollView);

    const taskList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style: 'spacing: 8px;',
    });
    scrollView.set_child(taskList);

    const entryRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: rowBackgroundStyle + ` border-radius: ${TASK_ROW_RADIUS_PX}px;`
            + `padding: ${TASK_ROW_PADDING_V_PX - 3}px ${TASK_ROW_PADDING_H_PX}px;`,
    });

    const taskEntry = new St.Entry({
        hint_text: 'New task…',
        can_focus: true,
        x_expand: true,
    });
    entryRow.add_child(taskEntry);
    entryRow.hide();
    rightColumn.add_child(entryRow);

    const saveTasks = () => saveJsonToFile(todosFilePath, { tasks });

    function applyScale(newScale) {
        scale = newScale;
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_V_PX)}px ${px(CONTAINER_PADDING_H_PX)}px;`;
        leftColumn.set_style(`width: ${px(LEFT_COLUMN_WIDTH_PX)}px;`);
        titleLabel.style = `${fontCss}font-size: ${px(TITLE_FONT_SIZE_PX)}px; `
            + `font-weight: 700; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        countLabel.style = `${fontCss}font-size: ${px(COUNT_FONT_SIZE_PX)}px; `
            + `font-weight: 300; color: ${textColor};`;
        listIcon.icon_size = px(20);
        addButton.style = rowBackgroundStyle + ` border-radius: 9999px;`
            + `width: ${px(ADD_BUTTON_SIZE_PX)}px; height: ${px(ADD_BUTTON_SIZE_PX)}px;`;
        addButton.child.icon_size = px(18);

        rightColumn.style = `spacing: ${px(ROW_SPACING_PX)}px; padding-left: ${px(10)}px;`;
        taskList.style = `spacing: ${px(ROW_SPACING_PX)}px;`;
        entryRow.style = rowBackgroundStyle + ` border-radius: ${px(TASK_ROW_RADIUS_PX)}px;`
            + `padding: ${Math.max(1, px(TASK_ROW_PADDING_V_PX) - 3)}px ${px(TASK_ROW_PADDING_H_PX)}px;`;

        renderTasks();
    }

    function renderCounter() {
        const pendingCount = tasks.filter(task => !task.done).length;
        countLabel.text = String(pendingCount);
    }

    function buildTaskRow(task) {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const fontSize = px(TASK_TEXT_FONT_SIZE_PX);
        const checkboxSize = px(CHECKBOX_SIZE_PX);

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: rowBackgroundStyle + ` border-radius: ${px(TASK_ROW_RADIUS_PX)}px;`
                + `padding: ${px(TASK_ROW_PADDING_V_PX)}px ${px(TASK_ROW_PADDING_H_PX)}px;`
                + `spacing: ${px(10)}px;`,
        });

        const checkbox = new St.Button({
            reactive: true,
            can_focus: true,
            style: task.done
                ? `background-color: ${accentHex}; border-radius: 9999px;`
                    + `width: ${checkboxSize}px; height: ${checkboxSize}px;`
                : `border: 1.5px solid ${textRgba(0.35)}; border-radius: 9999px;`
                    + `width: ${checkboxSize}px; height: ${checkboxSize}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (task.done) {
            checkbox.child = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: px(10),
                style: `color: ${resolveTextOnAccentColor(accentHex)};`,
            });
        }

        const escapedText = GLib.markup_escape_text(task.text || '', -1);
        const labelText = task.done ? `<s>${escapedText}</s>` : escapedText;

        const textLabel = new St.Label({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `${fontCss}font-size: ${fontSize}px;`
                + `color: ${textColor}; opacity: ${task.done ? 0.5 : 1.0};`,
        });
        textLabel.clutter_text.use_markup = true;
        textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textLabel.clutter_text.set_markup(labelText);

        checkbox.connect('clicked', () => {
            if (isActorDestroyed(container)) return;
            task.done = !task.done;
            saveTasks();
            renderTasks();
        });

        const deleteButton = new St.Button({
            child: new St.Icon({
                icon_name: 'edit-delete-symbolic',
                icon_size: px(13),
            }),
            reactive: true,
            can_focus: true,
            style: `opacity: 0.45;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        deleteButton.connect('clicked', () => {
            if (isActorDestroyed(container)) return;
            const index = tasks.indexOf(task);
            if (index !== -1)
                tasks.splice(index, 1);
            saveTasks();
            renderTasks();
        });

        row.add_child(checkbox);
        row.add_child(textLabel);
        row.add_child(deleteButton);

        attachButtonFeedback(checkbox);
        attachButtonFeedback(deleteButton);
        return row;
    }

    function renderTasks() {
        renderCounter();

        taskList.destroy_all_children();
        if (tasks.length === 0) {
            const px = (v) => Math.max(1, Math.round(v * scale));
            const emptyLabel = new St.Label({
                text: 'No tasks yet — press + to add one',
                x_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(TASK_TEXT_FONT_SIZE_PX)}px;`
                    + `color: ${textColor}; opacity: 0.5;`,
            });
            taskList.add_child(emptyLabel);
            return;
        }

        tasks.forEach(task => taskList.add_child(buildTaskRow(task)));
    }

    const showEntry = () => {
        state.entryVisible = true;
        entryRow.show();
        global.stage.set_key_focus(taskEntry);
    };

    const hideEntry = () => {
        state.entryVisible = false;
        taskEntry.text = '';
        entryRow.hide();
        if (global.stage.get_key_focus() === taskEntry)
            global.stage.set_key_focus(null);
    };

    const commitTask = () => {
        const text = taskEntry.text.trim();
        if (text !== '') {
            tasks.push({ text, done: false });
            saveTasks();
            renderTasks();
        }
        hideEntry();
    };

    addButton.connect('clicked', () => {
        if (isActorDestroyed(container)) return;
        if (state.entryVisible) hideEntry();
        else showEntry();
    });

    taskEntry.clutter_text.connect('key-press-event', (_actor, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            commitTask();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) {
            hideEntry();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    registerWidgetCleanup(container, () => {
        if (tasksLoaded)
            saveJsonToFileSync(todosFilePath, { tasks });
        if (global.stage.get_key_focus() === taskEntry)
            global.stage.set_key_focus(null);
    });

    applyScale(scale);
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    loadJsonFromFileAsync(todosFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        tasksLoaded = true;
        if (savedData && Array.isArray(savedData.tasks)) {
            tasks = savedData.tasks.filter(task => task && typeof task.text === 'string')
                .map(task => ({ text: task.text, done: !!task.done }));
            renderTasks();
        } else if (!loadError) {
            saveTasks();
        }
    });

    return container;
}
