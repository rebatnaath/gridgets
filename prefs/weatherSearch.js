import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { clearBox } from './displayUtils.js';

const MAX_RESULT_COUNT = 5;

let sharedSession = null;

function getSession() {
    if (!sharedSession)
        sharedSession = new Soup.Session();
    return sharedSession;
}

// Creates an isolated search controller so concurrent dialogs don't cancel each other.
export function createOpenMeteoCitySearch() {
    let requestSequence = 0;
    let cancellable = null;

    return function performCitySearch(query, resultsList, selectCallback) {
        if (!query || query.length < 2) return;

        clearBox(resultsList);
        resultsList.set_visible(false);

        const requestId = ++requestSequence;
        if (cancellable)
            cancellable.cancel();
        cancellable = new Gio.Cancellable();

        const renderResults = (locationItems) => {
            if (requestId !== requestSequence || cancellable.is_cancelled())
                return;
            if (!locationItems || locationItems.length === 0) {
                resultsList.append(new Adw.ActionRow({ title: 'No results found.' }));
                resultsList.set_visible(true);
                return;
            }

            for (const loc of locationItems.slice(0, MAX_RESULT_COUNT)) {
                const row = new Adw.ActionRow({
                    title: loc.name,
                    subtitle: loc.subtitle || '',
                    activatable: true
                });

                row.connect('activated', () => {
                    selectCallback(loc);
                    let currentChild = resultsList.get_first_child();
                    while (currentChild) {
                        currentChild.remove_css_class('selected');
                        currentChild = currentChild.get_next_sibling();
                    }
                    row.add_css_class('selected');
                });
                resultsList.append(row);
            }
            resultsList.set_visible(true);
        };

        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${MAX_RESULT_COUNT}`;
        const message = Soup.Message.new('GET', geocodeUrl);
        getSession().send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (bytes && message.get_status() === 200) {
                    const byteArray = bytes.get_data();
                    if (byteArray) {
                        const decoder = new TextDecoder('utf-8');
                        const geocodeJson = JSON.parse(decoder.decode(byteArray));
                        if (geocodeJson.results && geocodeJson.results.length > 0) {
                            const items = geocodeJson.results.map(item => ({
                                name: item.name,
                                subtitle: `${item.admin1 ? item.admin1 + ', ' : ''}${item.country || ''}`,
                                latitude: item.latitude,
                                longitude: item.longitude,
                            }));
                            renderResults(items);
                            return;
                        }
                    }
                }
                renderResults([]);
            } catch (e) {
                renderResults([]);
            }
        });
    };
}
