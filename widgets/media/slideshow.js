import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createAnimatedImageNode } from './gif.js';
import { listImagesInFolder, attachCaptionOverlay, imageDateCaption, backgroundImageStyle } from './mediaCommon.js';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveExplicitFontFamily, resolveWidgetCornerRadius, buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { WidgetActor, connectTimerCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { TYPOGRAPHY_SIZE, TYPOGRAPHY_WEIGHT, TEXT_OPACITY, MIN_FONT_SIZE, scaleFontSize } from '../../utils/typography.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';

const DEFAULT_SLIDE_INTERVAL_SECONDS = 10;
const REFERENCE_WIDTH_PX = 240;
const REFERENCE_HEIGHT_PX = 160;
const MILLISECONDS_PER_SECOND = 1000;
const CROSSFADE_DURATION_MS = 800;
const CLUTTER_OPACITY_OPAQUE = 255;
const CLUTTER_OPACITY_TRANSPARENT = 0;

// A single space, not a word: the first picture may have no readable date, and the
// overlay still has to exist so the next slide's date has somewhere to go.
const PLACEHOLDER_CAPTION = ' ';

/** A full-bleed rounded layer, whichever way the picture has to be drawn. */
function createImageLayer(imagePath, borderRadius, width, height, animateGif) {
    const fill = {
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        opacity: CLUTTER_OPACITY_OPAQUE,
    };

    if (imagePath.toLowerCase().endsWith('.gif')) {
        const gifWidget = createAnimatedImageNode({
            imagePath,
            appliedBorderRadius: borderRadius
        }, width, height, 0, 0, animateGif);
        Object.assign(gifWidget, fill);
        return gifWidget;
    }

    return new St.Widget({
        ...fill,
        style: backgroundImageStyle(imagePath, `border-radius: ${borderRadius}px;`),
    });
}

export function createSlideshowNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    // The layers sit inside a container rounded by the shared default, so they carry
    // the same radius or the picture covers the rounded corners.
    const borderRadius = resolveWidgetCornerRadius(widgetData);
    const slideInterval = (widgetData.intervalSeconds || DEFAULT_SLIDE_INTERVAL_SECONDS) * MILLISECONDS_PER_SECOND;
    const folderPath = widgetData.slideshowFolder || '';
    const backgroundColor = resolveWidgetBackgroundColor(widgetData);

    const container = new WidgetActor({
        style: `background-color: ${backgroundColor}; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);
    watchActorLifecycle(container);

    const state = {
        timerId: null,
    };

    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);
    const placeholderLabel = new St.Label({
        text: 'Loading images…',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    watchActorLifecycle(placeholderLabel);
    const updatePlaceholderScale = scale => {
        if (isActorDestroyed(placeholderLabel)) return;
        const fontSize = scaleFontSize(TYPOGRAPHY_SIZE.label, scale, MIN_FONT_SIZE.label);
        placeholderLabel.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px;`
            + `font-weight: ${TYPOGRAPHY_WEIGHT.medium}; opacity: ${TEXT_OPACITY.secondary};`;
    };
    updatePlaceholderScale(1);
    container.add_child(placeholderLabel);
    attachResponsiveScaler(container, REFERENCE_WIDTH_PX, REFERENCE_HEIGHT_PX, (scale) => {
        updatePlaceholderScale(scale);
    });

    listImagesInFolder(folderPath).then((images) => {
        if (isActorDestroyed(container)) return;

        if (images.length === 0) {
            placeholderLabel.text = 'No images found in folder';
            return;
        }

        container.remove_child(placeholderLabel);
        placeholderLabel.destroy();

        const imageContainer = new St.Widget({
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        container.add_child(imageContainer);

        const shouldAnimateGif = widgetData.animateGif !== undefined ? widgetData.animateGif : (widgetData.globalAnimateGif !== false);
        const usesDateCaption = widgetData.useDateCaption === true;
        const firstDate = usesDateCaption ? imageDateCaption(images[0]) : '';
        const captionForFirstSlide = usesDateCaption && firstDate === ''
            ? PLACEHOLDER_CAPTION
            : (firstDate || widgetData.caption || '');
        const captionHandle = attachCaptionOverlay(container, widgetData, width, height, false, images[0], captionForFirstSlide);

        let currentIndex = 0;
        let currentLayer = watchActorLifecycle(createImageLayer(images[0], borderRadius, width, height, shouldAnimateGif));
        imageContainer.add_child(currentLayer);

        const advanceSlide = () => {
            if (isActorDestroyed(container) || images.length <= 1) return;

            currentIndex = (currentIndex + 1) % images.length;
            const nextImage = images[currentIndex];

            // A picture with no readable date leaves the text empty rather than keeping
            // the previous slide's, which would be a lie about the picture on screen.
            if (usesDateCaption)
                captionHandle?.setCaption(imageDateCaption(nextImage));

            const incomingLayer = watchActorLifecycle(createImageLayer(nextImage, borderRadius, width, height, shouldAnimateGif));
            incomingLayer.set_opacity(CLUTTER_OPACITY_TRANSPARENT);
            imageContainer.add_child(incomingLayer);

            const outgoingLayer = currentLayer;
            currentLayer = incomingLayer;

            incomingLayer.ease({
                opacity: CLUTTER_OPACITY_OPAQUE,
                duration: CROSSFADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            });

            outgoingLayer.ease({
                opacity: CLUTTER_OPACITY_TRANSPARENT,
                duration: CROSSFADE_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (outgoingLayer && !isActorDestroyed(outgoingLayer))
                        outgoingLayer.destroy();
                }
            });
        };

        const validInterval = Math.max(1000, Math.floor(slideInterval));
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validInterval, () => {
            if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            advanceSlide();
            return GLib.SOURCE_CONTINUE;
        });

        connectTimerCleanup(container, state);
    });

    return container;
}
