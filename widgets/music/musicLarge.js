import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily, resolveWidgetSurfaces, resolveWidgetCornerRadius } from '../../utils/widgetUtils.js';
import { buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { resolveMusicPanelColors, resolveArtworkLayerStyle } from './cover.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';

const BASE_CONTAINER_WIDTH = 480;
const BASE_CONTAINER_HEIGHT = 240;

const BASE_PADDING = 24;
const BASE_TITLE_FONT_SIZE = TYPOGRAPHY_SIZE.title;
const BASE_SECONDARY_FONT_SIZE = TYPOGRAPHY_SIZE.subtitle;

const LABEL_MARGIN_BOTTOM_PX = 4;
const CONTROLS_MARGIN_HORIZONTAL_PX = 12;
const CONTROLS_MARGIN_TOP_PX = 18;
const CONTROLS_MARGIN_BOTTOM_PX = 4;

const scaledLabelMargin = scale => scaleFontSize(LABEL_MARGIN_BOTTOM_PX, scale);

export function buildLargeLayout(config, state, width) {
    const cornerRadius = resolveWidgetCornerRadius(config);
    const scale = config.layoutScale || 1;
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
        style: `padding: ${Math.floor(BASE_PADDING * scale)}px;`,
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
        style: `${fontCss}color: ${textColor}; font-size: ${scaleFontSize(BASE_TITLE_FONT_SIZE, scale, MIN_FONT_SIZE.title)}px; `
            + `font-weight: ${TYPOGRAPHY_WEIGHT.bold}; margin-bottom: ${scaledLabelMargin(scale)}px;`,
    });
    const artistLabel = new St.Label({
        text: 'Unknown Artist',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.secondary}; font-size: ${scaleFontSize(BASE_SECONDARY_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle)}px; `
            + `margin-bottom: ${scaledLabelMargin(scale)}px;`,
    });
    const albumLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; opacity: ${TEXT_OPACITY.metadata}; font-size: ${scaleFontSize(BASE_SECONDARY_FONT_SIZE, scale, MIN_FONT_SIZE.subtitle)}px; `
            + `margin-bottom: ${scaledLabelMargin(scale)}px;`,
    });

    state.titleLabel = titleLabel;
    state.artistLabel = artistLabel;
    state.albumLabel = albumLabel;

    labelsSection.add_child(titleLabel);
    labelsSection.add_child(artistLabel);
    labelsSection.add_child(albumLabel);

    const controlsBox = buildControlsColumn(config, state);

    infoPanel.add_child(labelsSection);
    if (controlsBox) infoPanel.add_child(controlsBox);

    splitContainer.add_child(imagePanel);
    splitContainer.add_child(infoPanel);
    state.container.add_child(splitContainer);

    const applyLayoutStyles = (scalerRatio, currentWidth) => {
        const colors = resolveMusicPanelColors(config, state);
        const { highlight } = resolveWidgetSurfaces(config);
        const newHalfWidth = Math.floor(currentWidth / 2);
        imagePanel.set_width(newHalfWidth);
        infoPanel.set_width(newHalfWidth);

        const titleSize = scaleFontSize(BASE_TITLE_FONT_SIZE, scalerRatio, MIN_FONT_SIZE.title);
        const artistSize = scaleFontSize(BASE_SECONDARY_FONT_SIZE, scalerRatio, MIN_FONT_SIZE.subtitle);
        const albumSize = scaleFontSize(BASE_SECONDARY_FONT_SIZE, scalerRatio, MIN_FONT_SIZE.subtitle);
        const padding = scaleFontSize(BASE_PADDING, scalerRatio);

        splitContainer.style = `background-color: ${colors.panelColor}; border-radius: ${cornerRadius}px;`;
        infoPanel.style = `padding: ${padding}px;`;
        imagePanel.style = resolveArtworkLayerStyle(state)
            + ` background-color: ${colors.panelColor};`
            + ` border-radius: ${cornerRadius}px 0 0 ${cornerRadius}px;`;
        titleLabel.style = `${fontCss}color: ${colors.textColor}; font-size: ${titleSize}px; font-weight: ${TYPOGRAPHY_WEIGHT.bold}; `
            + `margin-bottom: ${scaledLabelMargin(scalerRatio)}px;`;
        artistLabel.style = `${fontCss}color: ${colors.textColor}; opacity: ${TEXT_OPACITY.secondary}; font-size: ${artistSize}px; `
            + `margin-bottom: ${scaledLabelMargin(scalerRatio)}px;`;
        albumLabel.style = `${fontCss}color: ${colors.textColor}; opacity: ${TEXT_OPACITY.metadata}; font-size: ${albumSize}px; `
            + `margin-bottom: ${scaledLabelMargin(scalerRatio)}px;`;

        updateControlButtonScaling(state, scalerRatio, fontFamily, colors.textColor, highlight);

        if (state.controlsColumn) {
            const controlMarginH = scaleFontSize(CONTROLS_MARGIN_HORIZONTAL_PX, scalerRatio);
            const controlMarginTop = scaleFontSize(CONTROLS_MARGIN_TOP_PX, scalerRatio);
            const controlMarginBottom = scaleFontSize(CONTROLS_MARGIN_BOTTOM_PX, scalerRatio);
            state.controlsColumn.style = `margin: ${controlMarginTop}px ${controlMarginH}px ${controlMarginBottom}px ${controlMarginH}px;`;
        }
    };

    const updateScaling = attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, applyLayoutStyles);

    if (config.coverBackground === true) {
        state.refreshBackground = () => {
            if (isActorDestroyed(state.container)) return;
            updateScaling();
        };
    }
}
