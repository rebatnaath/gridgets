/**
 * ============================================================================
 * PREFERENCES: WEATHER CITY SEARCH
 * 
 * Asynchronous city search handler for Weather API / Open-Meteo geocoding.
 * ============================================================================
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

let searchSession = null;

export function performCitySearch(query, resultsList, addButton, selectCallback) {
    if (!query || query.length < 2) return;

    if (addButton) addButton.set_sensitive(false);
    let child = resultsList.get_first_child();
    while (child) {
        let nextSibling = child.get_next_sibling();
        resultsList.remove(child);
        child = nextSibling;
    }
    resultsList.set_visible(false);

    if (!searchSession) {
        searchSession = new Soup.Session();
    }

    const renderResults = (locationItems) => {
        if (!locationItems || locationItems.length === 0) {
            resultsList.append(new Adw.ActionRow({ title: 'No results found.' }));
            resultsList.set_visible(true);
            return;
        }

        for (const loc of locationItems.slice(0, 5)) {
            const row = new Adw.ActionRow({
                title: loc.name,
                subtitle: `${loc.subtitle ? loc.subtitle : (loc.region ? loc.region + ', ' : '') + (loc.country || '')}`,
                activatable: true
            });

            row.connect('activated', () => {
                selectCallback(loc.name);
                if (addButton) addButton.set_sensitive(true);
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

    const openMeteoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`;
    const openMeteoMessage = Soup.Message.new('GET', openMeteoUrl);
    searchSession.send_and_read_async(openMeteoMessage, GLib.PRIORITY_DEFAULT, null, (session, result) => {
        try {
            const bytes = session.send_and_read_finish(result);
            if (openMeteoMessage.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const openMeteoJson = JSON.parse(decoder.decode(bytes.get_data()));
                if (openMeteoJson.results && openMeteoJson.results.length > 0) {
                    const items = openMeteoJson.results.map(item => ({
                        name: item.name,
                        subtitle: `${item.admin1 ? item.admin1 + ', ' : ''}${item.country || ''}`
                    }));
                    renderResults(items);
                    return;
                }
            }
            renderResults([]);
        } catch (e) {
            renderResults([]);
        }
    });
}
