export const TYPOGRAPHY_SIZE = Object.freeze({
    displayXL: 48,
    displayLG: 36,
    displayMD: 28,
    timer: 30,
    title: 20,
    subtitle: 16,
    body: 15,
    label: 13,
    metadata: 11,
    compact: 12,
    iconXs: 6,
    iconSm: 12,
    iconMd: 18,
    iconLg: 24,
    button: 14,
});

export const TYPOGRAPHY_WEIGHT = Object.freeze({
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
});

export const TEXT_OPACITY = Object.freeze({
    primary: 1.0,
    subtle: 0.85,
    secondary: 0.72,
    metadata: 0.62,
    disabled: 0.45,
});

export const ICON_OPACITY_SECONDARY = 0.7;

// Opacity for non-text graphics: dividers, borders, grid lines, progress tracks.
// Text-bearing elements use TEXT_OPACITY instead.
export const GRAPHICS_OPACITY = Object.freeze({
    arcTrack: 0.15,
    divider: 0.2,
    border: 0.25,
    gridLine: 0.3,
});

export const MIN_FONT_SIZE = Object.freeze({
    metadata: 10,
    label: 11,
    body: 12,
    title: 12,
    subtitle: 12,
    button: 12,
    primary: 20,
});

// Bounds for widget scale, applied by attachResponsiveScaler. The upper bound
// stops a type growing without limit on an oversized widget. The lower bound is
// often the binding one: 60 columns on a 1366px screen gives a 7px cell, so most
// Small and Medium presets derive below 0.5 and the floor, not the per-role
// MIN_FONT_SIZE values, is what decides their rendered size.
export const MIN_WIDGET_SCALE = 0.5;
export const MAX_WIDGET_SCALE = 1.5;

/**
 * Clamps a raw widget scale into the supported range, falling back to 1 for a scale
 * that is not a finite number.
 *
 * A bare Math.min(Math.max(scale, min), max) returns NaN for NaN and Infinity for
 * Infinity, and callers feed the result straight into CSS lengths, where St silently
 * drops a "NaNpx" and Clutter then warns about a NaN allocation. Any widget measuring
 * a zero reference size produces exactly that.
 */
export function clampWidgetScale(scale) {
    if (!Number.isFinite(scale))
        return 1;
    return Math.min(Math.max(scale, MIN_WIDGET_SCALE), MAX_WIDGET_SCALE);
}

export function scaleFontSize(baseSize, scale, minimum = 1) {
    // Last line of defence: a non-finite product here would reach St as a length.
    if (!Number.isFinite(baseSize * scale))
        return minimum;
    return Math.max(minimum, Math.round(baseSize * scale));
}
