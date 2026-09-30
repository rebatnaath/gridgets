import Soup from 'gi://Soup?version=3.0';

/** The one status every caller here treats as a success. */
export const HTTP_STATUS_OK = 200;

/**
 * Soup 3 has no session-level user agent, and a request that carries none is fair game for
 * a server to refuse: The Guardian's feeds answer 406 to it, leaving the widget empty with
 * one line in the journal to explain it. One place to name the client, so no call site can
 * forget to.
 */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Gridgets/1.0';

/** Null when the URL will not parse. */
export function createGetMessage(url, { acceptEncoding = null } = {}) {
    const message = Soup.Message.new('GET', url);
    if (!message)
        return null;
    message.request_headers.append('User-Agent', USER_AGENT);
    if (acceptEncoding)
        message.request_headers.append('Accept-Encoding', acceptEncoding);
    return message;
}
