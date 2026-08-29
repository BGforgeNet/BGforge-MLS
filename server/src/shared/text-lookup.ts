/**
 * Per-request memoization for a URI -> text lookup.
 *
 * A call-hierarchy reference list carries one entry per OCCURRENCE, not per file, so looking the text up
 * per entry re-reads the same file once per reference - and the provider's lookup is a synchronous
 * `readFileSync` on the server's event loop. Memoizing for the span of one request collapses that to one
 * read per distinct URI. The map is discarded with the request, so an open buffer edited mid-session is
 * never served stale.
 */

/** Resolve a document's text, or null when it cannot be read. */
export type TextLookup = (uri: string) => string | null;

/** Wrap `getText` so each distinct URI is resolved at most once. */
export function memoizeTextLookup(getText: TextLookup): TextLookup {
    const seen = new Map<string, string | null>();
    return (uri) => {
        const cached = seen.get(uri);
        // `has` distinguishes a cached null (unreadable file) from a miss; without it an unreadable file
        // is re-read once per reference - the exact repetition this memo exists to remove.
        if (cached !== undefined || seen.has(uri)) return cached ?? null;
        const text = getText(uri);
        seen.set(uri, text);
        return text;
    };
}
