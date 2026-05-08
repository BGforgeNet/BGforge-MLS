/**
 * Branded URI type that guarantees consistent percent-encoding.
 *
 * On Windows, VSCode and Node's pathToFileURL() produce different encodings
 * for the same file (e.g., `%21` vs `!`, `%3A` vs `:`). Using raw URI strings
 * as Map keys or in Set lookups causes silent mismatches.
 *
 * NormalizedUri solves this by canonicalizing file:// URIs through a
 * fileURLToPath -> pathToFileURL round-trip, which produces consistent encoding.
 * The branded type makes it a compile-time error to use raw strings where
 * normalized URIs are expected.
 */

import { fileURLToPath, pathToFileURL } from "node:url";

// eslint-disable-next-line no-underscore-dangle -- compile-time-only brand symbol; double underscore marks it as never read at runtime
declare const __normalizedUri: unique symbol;

/**
 * A file URI string with guaranteed canonical percent-encoding.
 * Constructed only via normalizeUri() to ensure consistency.
 */
export type NormalizedUri = string & { readonly [__normalizedUri]: true };

/**
 * Normalize a URI to canonical encoding.
 *
 * For file:// URIs: round-trips through fileURLToPath -> pathToFileURL
 * to produce consistent percent-encoding regardless of input.
 *
 * For non-file URIs (e.g., untitled:): returns as-is (cast to branded type).
 */
export function normalizeUri(uri: string): NormalizedUri {
    if (uri.startsWith("file://")) {
        return pathToFileURL(fileURLToPath(uri)).toString() as NormalizedUri;
    }
    return uri as NormalizedUri;
}
