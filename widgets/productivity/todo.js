import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveTextOnAccentColor, resolveWidgetForegroundColor, resolveWidgetSurfaces, resolveAccentColor, resolveChildCornerRadius, DEFAULT_CHILD_CORNER_RADIUS_PX, saveJsonToFile, saveJsonToFileSync } from '../../utils/widgetUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH_PX = 360;
const REF_HEIGHT_PX = 170;
const CONTAINER_PADDING_V_PX = 14;
const CONTAINER_PADDING_H_PX = 20;
const LEFT_COLUMN_WIDTH_PX = 90;
const TITLE_FONT_SIZE_PX = TYPOGRAPHY_SIZE.subtitle;
const COUNT_FONT_SIZE_PX = TYPOGRAPHY_SIZE.displayXL;
const ADD_BUTTON_SIZE_PX = 32;
const TASK_ROW_RADIUS_PX = DEFAULT_CHILD_CORNER_RADIUS_PX;
const TASK_ROW_PADDING_V_PX = 9;
const TASK_ROW_PADDING_H_PX = 14;
const TASK_TEXT_FONT_SIZE_PX = 15;
const CHECKBOX_SIZE_PX = 16;
const ROW_SPACING_PX = 8;
const COUNTER_ROW_MARGIN_TOP_PX = 6;
const COUNTER_ROW_SPACING_PX = 8;
const LIST_ICON_SIZE_PX = 20;
const ADD_BUTTON_ICON_SIZE_PX = 18;
const PILL_RADIUS_PX = 9999;
const TASK_ROW_SPACING_PX = 10;
const TASK_LIST_SPACING_PX = 8;
const CHECKBOX_BORDER_WIDTH_PX = 1.5;
const CHECKMARK_ICON_SIZE_PX = 10;
const DELETE_ICON_SIZE_PX = 13;

const DEFAULT_TASKS = [
    { text: 'Make tea', done: false },
    { text: 'Make cake', done: false },
    { text: 'Linux os', done: false },
];

export function createTodoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const { card, highlight } = resolveWidgetSurfaces(config);
    const accentHex = resolveAccentColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const accentStyle = `color: ${accentHex};`;
    const rowBackgroundStyle = `background-color: ${card};`;

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
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`,
    });

    const counterRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: `margin-top: ${COUNTER_ROW_MARGIN_TOP_PX}px; spacing: ${COUNTER_ROW_SPACING_PX}px;`,
    });

    const listIcon = new St.Icon({
        icon_name: 'view-list-symbolic',
        icon_size: LIST_ICON_SIZE_PX,
        style: accentStyle,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const countLabel = new St.Label({
        text: '0',
        style: `${fontCss}font-size: ${COUNT_FONT_SIZE_PX}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.black}; color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    counterRow.add_child(listIcon);
    counterRow.add_child(countLabel);

    const addButton = new St.Button({
        child: new St.Icon({
            icon_name: 'list-add-symbolic',
            icon_size: ADD_BUTTON_ICON_SIZE_PX,
            style: accentStyle,
        }),
        reactive: true,
        can_focus: true,
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
        style: `spacing: ${COUNTER_ROW_SPACING_PX}px; padding-left: ${TASK_ROW_PADDING_H_PX}px;`,
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
        style: `spacing: ${TASK_LIST_SPACING_PX}px;`,
    });
    scrollView.set_child(taskList);

    const entryRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: rowBackgroundStyle + ` border-radius: ${resolveChildCornerRadius(TASK_ROW_RADIUS_PX, scale)}px;`
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
        titleLabel.style = `${fontCss}font-size: ${scaleFontSize(TITLE_FONT_SIZE_PX, scale, MIN_FONT_SIZE.subtitle)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.semibold}; color: ${textColor}; opacity: ${TEXT_OPACITY.secondary};`;
        countLabel.style = `${fontCss}font-size: ${scaleFontSize(COUNT_FONT_SIZE_PX, scale, MIN_FONT_SIZE.primary)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.black}; color: ${textColor};`;
        listIcon.icon_size = px(LIST_ICON_SIZE_PX);
        addButton.style = rowBackgroundStyle + ` border-radius: ${resolveChildCornerRadius(DEFAULT_CHILD_CORNER_RADIUS_PX, scale)}px;`
            + `width: ${px(ADD_BUTTON_SIZE_PX)}px; height: ${px(ADD_BUTTON_SIZE_PX)}px;`;
        addButton.child.icon_size = px(ADD_BUTTON_ICON_SIZE_PX);

        rightColumn.style = `spacing: ${px(TASK_ROW_SPACING_PX)}px; padding-left: ${px(TASK_ROW_PADDING_H_PX)}px;`;
        taskList.style = `spacing: ${px(ROW_SPACING_PX)}px;`;
        entryRow.style = rowBackgroundStyle + ` border-radius: ${resolveChildCornerRadius(TASK_ROW_RADIUS_PX, scale)}px;`
            + `padding: ${Math.max(1, px(TASK_ROW_PADDING_V_PX) - 3)}px ${px(TASK_ROW_PADDING_H_PX)}px;`;

        renderTasks();
    }

    function renderCounter() {
        const pendingCount = tasks.filter(task => !task.done).length;
        countLabel.text = String(pendingCount);
    }

    function buildTaskRow(task) {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const fontSize = scaleFontSize(TASK_TEXT_FONT_SIZE_PX, scale, MIN_FONT_SIZE.body);
        const checkboxSize = px(CHECKBOX_SIZE_PX);

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: rowBackgroundStyle + ` border-radius: ${resolveChildCornerRadius(TASK_ROW_RADIUS_PX, scale)}px;`
                + `padding: ${px(TASK_ROW_PADDING_V_PX)}px ${px(TASK_ROW_PADDING_H_PX)}px;`
                + `spacing: ${px(TASK_ROW_SPACING_PX)}px;`,
        });

        const checkbox = new St.Button({
            reactive: true,
            can_focus: true,
            style: task.done
                ? `background-color: ${accentHex}; border-radius: ${PILL_RADIUS_PX}px;`
                    + `width: ${checkboxSize}px; height: ${checkboxSize}px;`
                : `border: ${CHECKBOX_BORDER_WIDTH_PX}px solid ${highlight}; border-radius: ${PILL_RADIUS_PX}px;`
                    + `width: ${checkboxSize}px; height: ${checkboxSize}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (task.done) {
            checkbox.child = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: px(CHECKMARK_ICON_SIZE_PX),
                style: `color: ${resolveTextOnAccentColor(accentHex)};`,
            });
        }

        const escapedText = GLib.markup_escape_text(task.text || '', -1);
        const labelText = task.done ? `<s>${escapedText}</s>` : escapedText;

        const textLabel = new St.Label({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `${fontCss}font-size: ${fontSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`
                + `color: ${textColor}; opacity: ${task.done ? TEXT_OPACITY.metadata : TEXT_OPACITY.primary};`,
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
                icon_size: px(DELETE_ICON_SIZE_PX),
            }),
            reactive: true,
            can_focus: true,
            style: `opacity: ${TEXT_OPACITY.disabled};`,
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
                style: `${fontCss}font-size: ${scaleFontSize(TASK_TEXT_FONT_SIZE_PX, scale, MIN_FONT_SIZE.body)}px; font-weight: ${TYPOGRAPHY_WEIGHT.semibold};`
                    + `color: ${textColor}; opacity: ${TEXT_OPACITY.metadata};`,
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
        if (state.entryVisible) {
            if (taskEntry.text.trim()) commitTask();
            else hideEntry();
        } else {
            showEntry();
        }
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
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (scale) => {
        if (isActorDestroyed(container)) return;
        applyScale(scale);
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
