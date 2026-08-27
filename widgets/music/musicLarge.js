import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { resolveMusicPanelColors, resolveArtworkLayerStyle } from './cover.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 480;
const BASE_CONTAINER_HEIGHT = 240;

const BASE_PADDING = 24;
const BASE_TITLE_FONT_SIZE = 24;
const BASE_ARTIST_FONT_SIZE = 18;
const BASE_ALBUM_FONT_SIZE = 18;

const LABEL_MARGIN_BOTTOM_PX = 4;

export function buildLargeLayout(config, state, width) {
    const cornerRadius = config.appliedBorderRadius || 0;
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
        style: `${fontCss}color: ${textColor}; font-size: ${Math.floor(BASE_TITLE_FONT_SIZE * scale)}px; `
            + `font-weight: 400; margin-bottom: ${Math.floor(LABEL_MARGIN_BOTTOM_PX * scale)}px;`,
    });
    const artistLabel = new St.Label({
        text: 'Unknown Artist',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; opacity: 0.8; font-size: ${Math.floor(BASE_ARTIST_FONT_SIZE * scale)}px; `
            + `margin-bottom: ${Math.floor(LABEL_MARGIN_BOTTOM_PX * scale)}px;`,
    });
    const albumLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; opacity: 0.6; font-size: ${Math.floor(BASE_ALBUM_FONT_SIZE * scale)}px; `
            + `margin-bottom: ${Math.floor(LABEL_MARGIN_BOTTOM_PX * scale)}px;`,
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
        const newHalfWidth = Math.floor(currentWidth / 2);
        imagePanel.set_width(newHalfWidth);
        infoPanel.set_width(newHalfWidth);

        const titleSize = Math.max(1, Math.floor(BASE_TITLE_FONT_SIZE * scalerRatio));
        const artistSize = Math.max(1, Math.floor(BASE_ARTIST_FONT_SIZE * scalerRatio));
        const albumSize = Math.max(1, Math.floor(BASE_ALBUM_FONT_SIZE * scalerRatio));
        const padding = Math.max(1, Math.floor(BASE_PADDING * scalerRatio));

        splitContainer.style = `background-color: ${colors.panelColor}; border-radius: ${cornerRadius}px;`;
        infoPanel.style = `padding: ${padding}px;`;
        imagePanel.style = resolveArtworkLayerStyle(state)
            + ` background-color: ${colors.panelColor};`
            + ` border-radius: ${cornerRadius}px 0 0 ${cornerRadius}px;`;
        titleLabel.style = `${fontCss}color: ${colors.textColor}; font-size: ${titleSize}px; font-weight: 400; `
            + `margin-bottom: ${Math.max(1, Math.floor(LABEL_MARGIN_BOTTOM_PX * scalerRatio))}px;`;
        artistLabel.style = `${fontCss}color: ${colors.textColor}; opacity: 0.8; font-size: ${artistSize}px; `
            + `margin-bottom: ${Math.max(1, Math.floor(LABEL_MARGIN_BOTTOM_PX * scalerRatio))}px;`;
        albumLabel.style = `${fontCss}color: ${colors.textColor}; opacity: 0.6; font-size: ${albumSize}px; `
            + `margin-bottom: ${Math.max(1, Math.floor(LABEL_MARGIN_BOTTOM_PX * scalerRatio))}px;`;

        updateControlButtonScaling(state, scalerRatio, fontFamily, colors.textColor);

        if (state.controlsColumn) {
            const controlMarginH = Math.max(1, Math.floor(12 * scalerRatio));
            const controlMarginTop = Math.max(1, Math.floor(18 * scalerRatio));
            const controlMarginBottom = Math.max(1, Math.floor(4 * scalerRatio));
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
