/** Text helpers shared by the feed-backed widgets. */

export function clampText(text, maxChars) {
    if (!text) return '';
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * "5m ago" for prose, "5m" for a dense row. `compact` also shortens the
 * sub-minute case to "now", which reads better beside a number.
 */
export function relativeTimeFromIso(dateIso, { compact = false } = {}) {
    const publishedMs = dateIso ? Date.parse(dateIso) : NaN;
    if (isNaN(publishedMs)) return '';

    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - publishedMs) / 60000));
    if (elapsedMinutes < 1) return compact ? 'now' : 'Just now';
    if (elapsedMinutes < 60) {
        return compact ? `${elapsedMinutes}m` : `${elapsedMinutes}m ago`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) {
        return compact ? `${elapsedHours}h` : `${elapsedHours}h ago`;
    }
    const elapsedDays = Math.floor(elapsedHours / 24);
    return compact ? `${elapsedDays}d` : `${elapsedDays}d ago`;
}

export function hostLabelFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (_urlError) {
        return '';
    }
}
