import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveWidgetFontFamily } from '../../utils/widgetUtils.js';
import { buildControlsColumn, updateControlButtonScaling } from './musicCommon.js';
import { attachResponsiveScaler } from '../../utils/widgetUIUtils.js';

/** Base container layout metrics */
const BASE_CONTAINER_WIDTH = 480;
const BASE_CONTAINER_HEIGHT = 240;

/** Baseline font and padding metrics */
const BASE_PADDING = 24;
const BASE_TITLE_FONT_SIZE = 24;
const BASE_ARTIST_FONT_SIZE = 18;
const BASE_ALBUM_FONT_SIZE = 18;

/** Margin and spacing metrics */
const LABEL_MARGIN_BOTTOM_PX = 4;

/** Builds large split 2-panel music player UI layout. */
export function buildLargeLayout(config, state, width) {
    const cornerRadius = config.appliedBorderRadius || 0;
    const scale = config.layoutScale || 1;
    const fontFamily = resolveWidgetFontFamily(config);
    const textPanelColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const halfWidth = Math.floor(width / 2);

    const splitContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${textPanelColor}; border-radius: ${cornerRadius}px;`,
    });

    const imagePanel = new St.Widget({
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        style: `background-color: ${textPanelColor}; border-radius: ${cornerRadius}px 0px 0px ${cornerRadius}px;`,
    });
    state.backgroundLayer = imagePanel;

    const infoPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        width: halfWidth,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `padding: ${Math.floor(BASE_PADDING * scale)}px;`,
    });

    const titleLabel = new St.Label({
        text: 'Not Playing',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; font-size: ${Math.floor(BASE_TITLE_FONT_SIZE * scale)}px; font-weight: bold; margin-bottom: ${Math.floor(LABEL_MARGIN_BOTTOM_PX * scale)}px;`,
    });
    const artistLabel = new St.Label({
        text: 'Unknown Artist',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.8; font-size: ${Math.floor(BASE_ARTIST_FONT_SIZE * scale)}px; margin-bottom: ${Math.floor(LABEL_MARGIN_BOTTOM_PX * scale)}px;`,
    });
    const albumLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        style: `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.6; font-size: ${Math.floor(BASE_ALBUM_FONT_SIZE * scale)}px; margin-bottom: ${Math.floor(BASE_PADDING * scale)}px;`,
    });

    state.titleLabel = titleLabel;
    state.artistLabel = artistLabel;
    state.albumLabel = albumLabel;

    infoPanel.add_child(titleLabel);
    infoPanel.add_child(artistLabel);
    infoPanel.add_child(albumLabel);

    const controlsBox = buildControlsColumn(config, state);
    infoPanel.add_child(controlsBox);

    splitContainer.add_child(imagePanel);
    splitContainer.add_child(infoPanel);
    state.container.add_child(splitContainer);

    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scalerRatio, currentWidth) => {
        const newHalfWidth = Math.floor(currentWidth / 2);
        imagePanel.set_width(newHalfWidth);
        infoPanel.set_width(newHalfWidth);

        const titleSize = Math.max(14, Math.floor(22 * scalerRatio));
        const artistSize = Math.max(12, Math.floor(16 * scalerRatio));
        const albumSize = Math.max(10, Math.floor(14 * scalerRatio));
        const padding = Math.max(8, Math.floor(20 * scalerRatio));

        infoPanel.style = `padding: ${padding}px;`;
        titleLabel.style = `font-family: ${fontFamily}; color: ${textColor}; font-size: ${titleSize}px; font-weight: bold; margin-bottom: ${Math.max(2, Math.floor(LABEL_MARGIN_BOTTOM_PX * scalerRatio))}px;`;
        artistLabel.style = `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.8; font-size: ${artistSize}px; margin-bottom: ${Math.max(2, Math.floor(LABEL_MARGIN_BOTTOM_PX * scalerRatio))}px;`;
        albumLabel.style = `font-family: ${fontFamily}; color: ${textColor}; opacity: 0.6; font-size: ${albumSize}px; margin-bottom: ${Math.max(8, Math.floor(16 * scalerRatio))}px;`;

        updateControlButtonScaling(state, scalerRatio, fontFamily, textColor);

        const marginTop = Math.max(4, Math.floor(12 * scalerRatio));
        if (state.controlsColumn) {
            state.controlsColumn.style = `margin-top: ${marginTop}px;`;
        }
    });
}
