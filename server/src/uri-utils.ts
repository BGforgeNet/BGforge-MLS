/**
 * URI <-> filesystem-path conversion. Output of pathToUri is a NormalizedUri
 * branded value because Node's pathToFileURL produces the same canonical
 * encoding as normalizeUri's round-trip.
 */

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "url";
import type { NormalizedUri } from "./core/normalized-uri";

export function uriToPath(uri_string: string) {
    return fileURLToPath(uri_string);
}

/**
 * Convert a file path to a canonical file:// URI.
 * Returns NormalizedUri since pathToFileURL produces the same canonical
 * encoding as normalizeUri's round-trip (they both use Node's pathToFileURL).
 */
export function pathToUri(filePath: string): NormalizedUri {
    const uri = pathToFileURL(filePath);
    return uri.toString() as NormalizedUri;
}
