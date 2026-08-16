/**
 * URI <-> filesystem-path conversion. Output of pathToUri is a NormalizedUri
 * branded value because Node's pathToFileURL produces the same canonical
 * encoding as normalizeUri's round-trip.
 */

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "url";
import type { NormalizedUri } from "./core/normalized-uri";

/**
 * The path a URI names. Total by design: `fileURLToPath` throws on any scheme but `file:`, and this sits
 * on the parse path that every opened document reaches, so a throw here unwinds past the request handler
 * and exits the server - one document on an unfamiliar scheme taking down every other file's language
 * support. A non-file URI yields its path portion instead; nothing on disk answers to it, and the caller
 * learns that from the read that fails rather than from a dead process.
 */
export function uriToPath(uri_string: string): string {
    if (!uri_string.startsWith("file://")) {
        return decodeURIComponent(uri_string.replace(/^[^:]+:/, ""));
    }
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
