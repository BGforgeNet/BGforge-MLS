/**
 * Reading another workspace file's text for a language feature (call hierarchy, rename, references).
 *
 * The open buffer wins, since its unsaved edits are what the reader is looking at. A file on disk is decoded
 * as the translation loader decodes one: UTF-8, else windows-1252. A multi-byte UTF-8 character read one byte
 * per character would shift every later position on its line. A file that cannot be read is null and logged,
 * so a feature that comes back short says why somewhere.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { errorMessage } from "../diagnostics";
import { conlog } from "../logger";
import { decodeFileBytes } from "../translation/encoding";
import { uriToPath } from "../uri-utils";

/** The open-document lookup a provider's context carries; undefined for a document not open. */
export type OpenDocumentText = (uri: string) => string | undefined;

function unreadable(uri: string, error: unknown): null {
    conlog(`cannot read ${uri}: ${errorMessage(error)}`, "warn");
    return null;
}

export function readWorkspaceTextSync(uri: string, openText?: OpenDocumentText): string | null {
    const open = openText?.(uri);
    if (open !== undefined) return open;
    try {
        return decodeFileBytes(readFileSync(uriToPath(uri))).text;
    } catch (error) {
        return unreadable(uri, error);
    }
}

export async function readWorkspaceText(uri: string, openText?: OpenDocumentText): Promise<string | null> {
    const open = openText?.(uri);
    if (open !== undefined) return open;
    try {
        return decodeFileBytes(await readFile(uriToPath(uri))).text;
    } catch (error) {
        return unreadable(uri, error);
    }
}
