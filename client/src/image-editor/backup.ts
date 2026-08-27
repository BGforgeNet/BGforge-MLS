/**
 * Container format for the animation editor's hot-exit backup: a one-line JSON header, a newline,
 * then the serialized animation verbatim. The animation bytes alone cannot round-trip a dirty
 * document - whether the external palette is in use is a user choice no FRM/BAM stream expresses -
 * and a header keeps the payload byte-exact where an all-JSON envelope would base64-inflate it.
 */

/** One PVRZ page travelling inside a backup, addressed by the number its data blocks name. */
export interface BackupPage {
    page: number;
    bytes: Uint8Array;
}

/** Restorable document state a backup carries. The sidecar palette and the FR-split / IE-pair file
 *  identity are deliberately absent: a dirty document has written nothing, so both still re-derive
 *  from disk on restore. */
export interface DocumentBackup {
    bytes: Uint8Array;
    externalPalette: boolean;
    /**
     * A BAM v2's PVRZ pages. Present because a v2's frames live OUTSIDE the `.bam` - it names pages
     * by number, and a dirty document's edited pages have by definition never been written to disk,
     * so a restore that re-read them from the folder would rebuild the pre-edit picture (or fail
     * outright, for pages that do not exist yet). Empty for every palette-indexed format.
     */
    pages?: readonly BackupPage[];
}

const HEADER_TERMINATOR = 0x0a;

// Bumped only on a breaking container change. A backup outlives the extension version that wrote it
// (an update can land while one is pending), so an unreadable header must fail loudly rather than
// feed a mis-sliced payload to the parser. v2 added the page table, which moved the main payload
// from "everything after the header" to a counted length.
const BACKUP_VERSION = 2;

interface PageEntry {
    page: number;
    length: number;
}

function isPageEntry(value: unknown): value is PageEntry {
    return (
        typeof value === "object" &&
        value !== null &&
        "page" in value &&
        "length" in value &&
        typeof value.page === "number" &&
        typeof value.length === "number" &&
        value.length >= 0
    );
}

export function encodeBackup(backup: DocumentBackup): Uint8Array {
    const pages = backup.pages ?? [];
    const header = new TextEncoder().encode(
        JSON.stringify({
            version: BACKUP_VERSION,
            externalPalette: backup.externalPalette,
            main: backup.bytes.length,
            pages: pages.map((p) => ({ page: p.page, length: p.bytes.length })),
        }),
    );
    const payloadLength = backup.bytes.length + pages.reduce((n, p) => n + p.bytes.length, 0);
    const out = new Uint8Array(header.length + 1 + payloadLength);
    out.set(header, 0);
    out[header.length] = HEADER_TERMINATOR;
    let offset = header.length + 1;
    out.set(backup.bytes, offset);
    offset += backup.bytes.length;
    for (const page of pages) {
        out.set(page.bytes, offset);
        offset += page.bytes.length;
    }
    return out;
}

export function decodeBackup(raw: Uint8Array): DocumentBackup {
    const end = raw.indexOf(HEADER_TERMINATOR);
    if (end === -1) throw new Error("Animation editor backup is missing its header");
    const header: unknown = JSON.parse(new TextDecoder().decode(raw.subarray(0, end)));
    if (typeof header !== "object" || header === null || !("version" in header) || !("externalPalette" in header)) {
        throw new Error("Animation editor backup has a malformed header");
    }
    if (header.version !== BACKUP_VERSION) {
        throw new Error(`Animation editor backup has unsupported version ${String(header.version)}`);
    }
    if (typeof header.externalPalette !== "boolean") {
        throw new TypeError("Animation editor backup is missing its externalPalette flag");
    }
    if (!("main" in header) || typeof header.main !== "number") {
        throw new TypeError("Animation editor backup is missing its payload length");
    }
    const entries: unknown = "pages" in header ? header.pages : [];
    if (!Array.isArray(entries) || !entries.every((entry) => isPageEntry(entry))) {
        throw new TypeError("Animation editor backup has a malformed page table");
    }

    let offset = end + 1;
    const bytes = raw.subarray(offset, offset + header.main);
    offset += header.main;
    const pages: BackupPage[] = entries.map((entry) => {
        const page = { page: entry.page, bytes: raw.subarray(offset, offset + entry.length) };
        offset += entry.length;
        return page;
    });
    // The lengths are what slice the payload, so a truncated file must fail here rather than hand
    // back a short final page that decodes as a corrupt texture.
    if (offset > raw.length) throw new Error("Animation editor backup is truncated");
    return { bytes, externalPalette: header.externalPalette, pages };
}
