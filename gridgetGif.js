/**
 * ============================================================================
 * ANIMATED GIF WIDGET 
 * 
 * This module handles the rendering of animated GIFs within the widget grid.
 * It implements manual pixel manipulation and frame timing to bypass the lack
 * of native animated GIF support in Clutter/St, while supporting rounded corners.
 * ============================================================================
 */

import St from 'gi://St';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import { buildBaseWidgetStyle } from './widgetUtils.js';
import { createCaptionOverlay, connectTimerCleanup } from './widgetUIUtils.js';

const ASPECT_RATIO_TOLERANCE = 0.01;
const GIF_FRAME_INTERVAL_MS = 20;

// Applies a circular alpha mask to the corners of the GIF frame's raw pixel buffer.
// Manual byte manipulation is required because Clutter/Cogl doesn't natively 
// support CSS border-radius on St.ImageContent textures generated from GdkPixbufs.
function applyCornerMask(pixels, width, height, radius, rowstride) {
    if (radius <= 0) return;
    const radiusSquared = radius * radius;
    // Assume 4-channel RGBA format based on prior validation
    const channels = 4;
    
    // Mask top-left corner
    for (let y = 0; y < radius; y++) {
        for (let x = 0; x < radius; x++) {
            const deltaX = radius - x - 0.5;
            const deltaY = radius - y - 0.5;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * channels + 3] = 0;
            }
        }
    }
    // Mask top-right corner
    for (let y = 0; y < radius; y++) {
        for (let x = width - radius; x < width; x++) {
            const deltaX = x - (width - radius) + 0.5;
            const deltaY = radius - y - 0.5;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * channels + 3] = 0;
            }
        }
    }
    // Mask bottom-left corner
    for (let y = height - radius; y < height; y++) {
        for (let x = 0; x < radius; x++) {
            const deltaX = radius - x - 0.5;
            const deltaY = y - (height - radius) + 0.5;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * channels + 3] = 0;
            }
        }
    }
    // Mask bottom-right corner
    for (let y = height - radius; y < height; y++) {
        for (let x = width - radius; x < width; x++) {
            const deltaX = x - (width - radius) + 0.5;
            const deltaY = y - (height - radius) + 0.5;
            if (deltaX * deltaX + deltaY * deltaY > radiusSquared) {
                pixels[y * rowstride + x * channels + 3] = 0;
            }
        }
    }
}

export function createAnimatedGifNode(widgetData, width, height, xPosition, yPosition, animateGif = true) {
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const borderWidth = widgetData.appliedBorderWidth || 0;
    const baseStyle = buildBaseWidgetStyle(widgetData);

    const widgetNode = new St.Widget({
        style: `background-color: transparent; ${baseStyle}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
    });
    
    widgetNode.set_clip_to_allocation(true);

    const state = { timerId: null };
    
    try {
        const animation = GdkPixbuf.PixbufAnimation.new_from_file(widgetData.imagePath);
        if (animation.is_static_image()) {
            widgetNode.style = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; background-position: center; ${baseStyle}`;
            return widgetNode;
        }
        
        const iter = animation.get_iter(null);
        const imageActor = new St.Widget();
        widgetNode.add_child(imageActor);
        
        const updateImage = (pixbuf) => {
            let renderPixbuf = pixbuf;
            const bw = borderWidth;
            const containerWidth = widgetNode.width;
            const containerHeight = widgetNode.height;
            const innerWidth = Math.max(0, containerWidth - bw * 2);
            const innerHeight = Math.max(0, containerHeight - bw * 2);
            
            if (innerWidth > 0 && innerHeight > 0) {
                const imageWidth = pixbuf.get_width();
                const imageHeight = pixbuf.get_height();
                const imageAspect = imageWidth / imageHeight;
                const containerAspect = innerWidth / innerHeight;
                
                let cropWidth, cropHeight, cropX, cropY;
                
                if (Math.abs(imageAspect - containerAspect) > ASPECT_RATIO_TOLERANCE) {
                    if (imageAspect > containerAspect) {
                        cropHeight = imageHeight;
                        cropWidth = Math.floor(cropHeight * containerAspect);
                        cropX = Math.floor((imageWidth - cropWidth) / 2);
                        cropY = 0;
                    } else {
                        cropWidth = imageWidth;
                        cropHeight = Math.floor(cropWidth / containerAspect);
                        cropX = 0;
                        cropY = Math.floor((imageHeight - cropHeight) / 2);
                    }
                    
                    if (cropWidth > 0 && cropHeight > 0 && cropX >= 0 && cropY >= 0) {
                        renderPixbuf = pixbuf.new_subpixbuf(cropX, cropY, cropWidth, cropHeight);
                    }
                }
                
                imageActor.set_size(innerWidth, innerHeight);
                imageActor.set_position(bw, bw);
            }
            
            // Convert to RGBA to support transparent rounded corners
            if (!renderPixbuf.get_has_alpha()) {
                renderPixbuf = renderPixbuf.add_alpha(false, 0, 0, 0);
            }
            
            const format = Cogl.PixelFormat.RGBA_8888;
            const pixels = renderPixbuf.get_pixels();
            
            // Apply rounded corners directly to pixel data
            let textureRadius = 0;
            if (innerWidth > 0) {
                const scaleX = renderPixbuf.get_width() / innerWidth;
                textureRadius = Math.max(0, Math.round((borderRadius - bw) * scaleX));
            }
            
            if (textureRadius > 0) {
                applyCornerMask(pixels, renderPixbuf.get_width(), renderPixbuf.get_height(), textureRadius, renderPixbuf.get_rowstride());
            }
            
            const frameImage = new St.ImageContent();
            const coglContext = global.stage.context.get_backend().get_cogl_context();
            
            try {
                const bytes = pixels instanceof GLib.Bytes ? pixels : new GLib.Bytes(pixels);
                frameImage.set_bytes(coglContext, bytes, format, renderPixbuf.get_width(), renderPixbuf.get_height(), renderPixbuf.get_rowstride());
            } catch(e) {
                try {
                    const bytes = pixels instanceof GLib.Bytes ? pixels : new GLib.Bytes(pixels);
                    frameImage.set_bytes(bytes, format, renderPixbuf.get_width(), renderPixbuf.get_height(), renderPixbuf.get_rowstride());
                } catch(e2) {
                    console.error('Failed to set frame data: ' + e2);
                    return;
                }
            }
            
            imageActor.set_content(frameImage);
        };

        // Render initial frame immediately before starting loop
        updateImage(iter.get_pixbuf());

        if (animateGif) {
            const nextFrame = () => {
                try {
                    if (iter.advance(null)) {
                        updateImage(iter.get_pixbuf());
                    }
                    
                    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GIF_FRAME_INTERVAL_MS, () => {
                        state.timerId = null;
                        nextFrame();
                        return GLib.SOURCE_REMOVE;
                    });
                } catch(err) {
                    console.error('GIF loop error: ' + err);
                }
            };
            
            state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, iter.get_delay_time() || GIF_FRAME_INTERVAL_MS, () => {
                state.timerId = null;
                nextFrame();
                return GLib.SOURCE_REMOVE;
            });
        }
        
        widgetNode.connect('notify::width', () => updateImage(iter.get_pixbuf()));
        widgetNode.connect('notify::height', () => updateImage(iter.get_pixbuf()));
        
        connectTimerCleanup(widgetNode, state);
        
    } catch(e) {
        console.error('Failed to load GIF animation:', e);
        widgetNode.style = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; background-position: center; ${baseStyle}`;
    }

    const showText = widgetData.appliedShowText !== false;
    const caption = widgetData.caption || '';
    if (showText && caption.length > 0) {
        const captionOverlay = createCaptionOverlay(widgetData, caption);

        // Wrap in a sized container so the caption tracks the widget size
        const textOverlay = new St.Widget({
            width: width,
            height: height,
            layout_manager: new Clutter.BinLayout(),
        });

        textOverlay.add_child(captionOverlay);
        widgetNode.add_child(textOverlay);

        widgetNode.connect('notify::width', () => textOverlay.set_width(widgetNode.width));
        widgetNode.connect('notify::height', () => textOverlay.set_height(widgetNode.height));
    }

    return widgetNode;
}

