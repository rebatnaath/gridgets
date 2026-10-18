import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetSurfaces, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { resolveMusicPanelColors, resolveArtworkLayerStyle, initialMusicScale } from './cover.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, createWidgetMetrics } from '../../utils/typography.js';

const BASE_CONTAINER_WIDTH = 480;
const BASE_CONTAINER_HEIGHT = 240;

const BASE_PADDING = 24;
const BASE_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.title;
const BASE_SECONDARY_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;

const LABEL_MARGIN_BOTTOM_PX = 4;
const CONTROLS_MARGIN_HORIZONTAL_PX = 12;
const CONTROLS_MARGIN_TOP_PX = 18;
const CONTROLS_MARGIN_BOTTOM_PX = 4;

const CLUTTER_OPACITY_OPAQUE = 255;

export function buildLargeLayout(config, state, width) {
    const cornerRadius = resolveWidgetCornerRadius(config);
    // The responsive scaler below owns sizing. This is the pre-allocation value;
    // applyLayoutStyles replaces it on the first pass.
    const scale = initialMusicScale(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT);
    let px = createWidgetMetrics(scale).px;
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const { panelColor, textColor } = resolveMusicPanelColors(config, state);
    const halfWidth = Math.floor(width / 2);

    const splitContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${panelColor}; border-radius: ${cornerRadius}px;`,
    });

    const imagePanel = new St.Widget({
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        style: `background-color: ${panelColor}; border-radius: ${cornerRadius}px 0 0 ${cornerRadius}px;`,
    });
    state.backgroundLayer = imagePanel;

    const infoPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        x_align: Clutter.ActorAlign.CENTER,
        style: `padding: ${px(BASE_PADDING)}px;`,
    });

    const labelsSection = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: 'Not Playing',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_TITLE_FONT_SIZE)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`,
    });
    const artistLabel = new St.Label({
        text: 'Unknown Artist',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_SECONDARY_FONT_SIZE)}px; `
            + `margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`,
        opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.secondary),
    });
    const albumLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${px(BASE_SECONDARY_FONT_SIZE)}px; `
            + `margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`,
        opacity: Math.round(CLUTTER_OPACITY_OPAQUE * TEXT_OPACITY.metadata),
    });

    state.titleLabel = titleLabel;
    state.artistLabel = artistLabel;
    state.albumLabel = albumLabel;

    labelsSection.add_child(titleLabel);
    labelsSection.add_child(artistLabel);
    labelsSection.add_child(albumLabel);

    const controlsBox = buildControlsColumn(config, state, initialMusicScale(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT));

    infoPanel.add_child(labelsSection);
    if (controlsBox) infoPanel.add_child(controlsBox);

    splitContainer.add_child(imagePanel);
    splitContainer.add_child(infoPanel);
    state.container.add_child(splitContainer);

    const applyLayoutStyles = (scalerRatio, currentWidth) => {
        ({ px } = createWidgetMetrics(scalerRatio));
        const colors = resolveMusicPanelColors(config, state);
        const { highlight } = resolveWidgetSurfaces(config);
        const newHalfWidth = Math.floor(currentWidth / 2);
        imagePanel.set_width(newHalfWidth);
        infoPanel.set_width(newHalfWidth);

        const titleSize = px(BASE_TITLE_FONT_SIZE);
        const artistSize = px(BASE_SECONDARY_FONT_SIZE);
        const albumSize = px(BASE_SECONDARY_FONT_SIZE);
        const padding = px(BASE_PADDING);

        splitContainer.style = `background-color: ${colors.panelColor}; border-radius: ${cornerRadius}px;`;
        infoPanel.style = `padding: ${padding}px;`;
        imagePanel.style = resolveArtworkLayerStyle(state)
            + ` background-color: ${colors.panelColor};`
            + ` border-radius: ${cornerRadius}px 0 0 ${cornerRadius}px;`;
        titleLabel.style = `${fontCss}color: ${colors.textColor}; font-size: ${titleSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; `
            + `margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`;
        artistLabel.style = `${fontCss}color: ${colors.textColor}; font-size: ${artistSize}px; `
            + `margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`;
        albumLabel.style = `${fontCss}color: ${colors.textColor}; font-size: ${albumSize}px; `
            + `margin-bottom: ${px(LABEL_MARGIN_BOTTOM_PX)}px;`;

        updateControlButtonScaling(state, scalerRatio, fontFamily, colors.textColor, highlight);

        if (state.controlsColumn) {
            const controlMarginH = px(CONTROLS_MARGIN_HORIZONTAL_PX);
            const controlMarginTop = px(CONTROLS_MARGIN_TOP_PX);
            const controlMarginBottom = px(CONTROLS_MARGIN_BOTTOM_PX);
            state.controlsColumn.style = `margin: ${controlMarginTop}px ${controlMarginH}px ${controlMarginBottom}px ${controlMarginH}px;`;
        }
    };

    // Before the scaler is attached, whose first pass is deferred to an idle: the panels
    // are built unscaled and would otherwise paint one frame at 1.0.
    applyLayoutStyles(scale, width);
    const updateScaling = attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, applyLayoutStyles);

    if (config.coverBackground === true) {
        state.refreshBackground = () => {
            if (isActorDestroyed(state.container)) return;
            updateScaling();
        };
    }
}
