/**
 * Shared djb2 hash function for cache keys.
 * Used by text-cache to avoid re-parsing unchanged content.
 */

/**
 * djb2 hash - fast with good distribution for strings.
 * Returns an unsigned 32-bit integer.
 */
export function djb2Hash(text: string): number {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
    return hash;
}
