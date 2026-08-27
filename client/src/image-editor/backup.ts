/**
 * Container format for the animation editor's hot-exit backup: a one-line JSON header, a newline,
 * then the serialized animation verbatim. The animation bytes alone cannot round-trip a dirty
 * document - whether the external palette is in use is a user choice no FRM/BAM stream expresses -
 * and a header keeps the payload byte-exact where an all-JSON envelope would base64-inflate it.
 */

/** Restorable document state a backup carries. The sidecar palette and the FR-split / IE-pair file
 *  identity are deliberately absent: a dirty document has written nothing, so both still re-derive
 *  from disk on restore. */
export interface DocumentBackup {
    bytes: Uint8Array;
    externalPalette: boolean;
}

const HEADER_TERMINATOR = 0x0a;

// Bumped only on a breaking container change. A backup outlives the extension version that wrote it
// (an update can land while one is pending), so an unreadable header must fail loudly rather than
// feed a mis-sliced payload to the parser.
const BACKUP_VERSION = 1;

export function encodeBackup(backup: DocumentBackup): Uint8Array {
    const header = new TextEncoder().encode(
        JSON.stringify({ version: BACKUP_VERSION, externalPalette: backup.externalPalette }),
    );
    const out = new Uint8Array(header.length + 1 + backup.bytes.length);
    out.set(header, 0);
    out[header.length] = HEADER_TERMINATOR;
    out.set(backup.bytes, header.length + 1);
    return out;
}

export function decodeBackup(raw: Uint8Array): DocumentBackup {
    const end = raw.indexOf(HEADER_TERMINATOR);
    if (end === -1) throw new Error("IndexedAnimation editor backup is missing its header");
    const header: unknown = JSON.parse(new TextDecoder().decode(raw.subarray(0, end)));
    if (typeof header !== "object" || header === null || !("version" in header) || !("externalPalette" in header)) {
        throw new Error("IndexedAnimation editor backup has a malformed header");
    }
    if (header.version !== BACKUP_VERSION) {
        throw new Error(`IndexedAnimation editor backup has unsupported version ${String(header.version)}`);
    }
    if (typeof header.externalPalette !== "boolean") {
        throw new TypeError("IndexedAnimation editor backup is missing its externalPalette flag");
    }
    return { bytes: raw.subarray(end + 1), externalPalette: header.externalPalette };
}
