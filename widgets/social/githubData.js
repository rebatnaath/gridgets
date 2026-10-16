import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import { getGridgetsDataDir, loadJsonFromFileAsync, saveJsonToFile } from '../../utils/widgetUtils.js';
import { HTTP_STATUS_OK, createGetMessage } from '../../utils/httpClient.js';
import { cachedImageUri, writeCachedImageBytes } from '../../utils/lastGoodCache.js';

// A session with no timeout waits forever, so a network that accepts the connection and
// then goes quiet would leave a request in flight until the widget was destroyed.
export const REQUEST_TIMEOUT_SECONDS = 30;
const CONTRIBUTIONS_ENDPOINT = 'https://github-contributions-api.jogruber.de/v4/';
export const AVATAR_REQUEST_SIZE_PX = 64;
/** Both GitHub widgets keep their saved username and cached avatar under one folder. */
export const GITHUB_CACHE_FOLDER = 'github';
const decoder = new TextDecoder();

/** Usernames whose avatar has already failed, so a 404 is not retried in the journal. */
const loggedAvatarFailures = new Set();

export function githubDataFilePath(config) {
    return GLib.build_filenamev([
        getGridgetsDataDir(GITHUB_CACHE_FOLDER),
        `github-${config.id}.json`,
    ]);
}

/** The username saved beside this widget, or an empty string when there is none. */
export function loadGithubUsername(config, callback) {
    loadJsonFromFileAsync(githubDataFilePath(config), (data, loadError) => {
        callback(data && typeof data.username === 'string' ? data.username : '', loadError);
    });
}

export function saveGithubUsername(config, username) {
    saveJsonToFile(githubDataFilePath(config), { username });
}

/**
 * One Soup session for a widget's contribution and avatar requests.
 *
 * The two requests belong together because they share a timeout and a cancellable: a
 * widget that is torn down mid-flight has to be able to cancel both, and each widget
 * having its own session is what let them drift apart.
 */
export function createGithubClient(cancellable) {
    const session = new Soup.Session({ timeout: REQUEST_TIMEOUT_SECONDS });

    function send(url, callback) {
        const message = createGetMessage(url);
        if (!message) {
            callback(new Error('request could not be created'), null);
            return;
        }
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (message.get_status() !== HTTP_STATUS_OK)
                    throw new Error(`HTTP ${message.get_status()}`);
                callback(null, bytes);
            } catch (err) {
                // A cancelled request is not a failure: teardown triggers it on purpose.
                const isCancelled = err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
                callback(isCancelled ? null : err, null);
            }
        });
    }

    return {
        /** Answers with a Map of 'YYYY-MM-DD' to a count. */
        fetchContributions(username, callback) {
            send(`${CONTRIBUTIONS_ENDPOINT}${encodeURIComponent(username)}`, (err, bytes) => {
                if (err || !bytes) {
                    callback(err, null);
                    return;
                }
                try {
                    const data = JSON.parse(decoder.decode(bytes.get_data()));
                    if (!data || !Array.isArray(data.contributions))
                        throw new Error('no contributions in response');
                    const byDate = new Map();
                    data.contributions.forEach(day => byDate.set(day.date, day.count || 0));
                    callback(null, byDate);
                } catch (parseError) {
                    callback(parseError, null);
                }
            });
        },

        fetchAvatar(username, callback) {
            send(`https://github.com/${encodeURIComponent(username)}.png?size=${AVATAR_REQUEST_SIZE_PX}`,
                (err, bytes) => {
                    if (err || !bytes || bytes.get_size() === 0) {
                        callback(err || new Error('empty response'), null);
                        return;
                    }
                    // GitHub's avatar endpoint redirects and answers with JPEG whatever the
                    // .png in the URL says, so the bytes are stored as they arrive and the
                    // stylesheet is left to work out the format.
                    callback(null, bytes);
                });
        },
    };
}

// Keyed by username and size, so a different person gets a different file and St's CSS
// cache cannot serve one avatar in place of another.
function avatarKey(username) {
    return `avatar-${username}-${AVATAR_REQUEST_SIZE_PX}`;
}

export function githubAvatarCacheUri(config, username) {
    return cachedImageUri(GITHUB_CACHE_FOLDER, config.id, avatarKey(username));
}

/** The style is applied only once the write has landed: a background-image pointing at a
 * file that is not there yet fails silently. */
export function writeGithubAvatar(config, username, bytes, callback) {
    writeCachedImageBytes(GITHUB_CACHE_FOLDER, config.id, avatarKey(username), bytes, callback);
}

/** Latched per username: a mistyped name 404s on every fetch, and the avatar is retried on
 * each reconnect, so this would otherwise repeat for what is a user error, not a fault. */
export function noteGithubAvatarFailure(username, err) {
    const key = `avatar-failed-${username}`;
    if (loggedAvatarFailures.has(key))
        return;
    loggedAvatarFailures.add(key);
    console.error('Gridgets: github avatar could not be fetched:', err.message);
}

/** Total over the `days` days beginning at `start`. */
export function sumContributions(byDate, start, days) {
    let total = 0;
    for (let day = 0; day < days; day++)
        total += byDate.get(start.add_days(day).format('%Y-%m-%d')) || 0;
    return total;
}

/** Total over the `months` calendar months ending on `today`. */
export function sumOverMonths(byDate, today, months) {
    let total = 0;
    for (let date = today.add_months(-months); date.compare(today) <= 0; date = date.add_days(1))
        total += byDate.get(date.format('%Y-%m-%d')) || 0;
    return total;
}

/** Sunday first, which is the order the days are stored in and the order they are drawn. */
export const DAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/**
 * The current week and the one before it.
 *
 * A day that has not happened yet is null rather than zero. Zero would say the day was
 * quiet, which is a claim about the past; a day still to come has no count to report, and
 * the caller draws it as an empty placeholder instead.
 */
export function weekOfContributions(byDate, today) {
    // GLib counts Monday as 1 and Sunday as 7, so the modulus maps Sunday to 0 and starts
    // the week on the Sunday before today.
    const weekStart = today.add_days(-(today.get_day_of_week() % 7));
    const counts = [];
    for (let day = 0; day < 7; day++) {
        const date = weekStart.add_days(day);
        counts.push(date.compare(today) > 0 ? null : (byDate.get(date.format('%Y-%m-%d')) || 0));
    }
    const thisWeek = counts.reduce((sum, count) => sum + (count || 0), 0);
    return {
        counts,
        thisWeek,
        lastWeek: sumContributions(byDate, weekStart.add_days(-7), 7),
    };
}