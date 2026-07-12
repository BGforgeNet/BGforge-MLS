/**
 * File encoding: UTF-8-first read with a windows-1252 fallback, encoding-preserving write, and an
 * atomic (temp-file + rename) write-back. Shared by the loader (reading `.tra`/`.msg` and
 * consumer files) and the write-back path (persisting edited translation text).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/** Which decoder successfully read a `.tra`/`.msg` file's bytes. */
export type ResolvedEncoding = "utf-8" | "windows-1252";

const UTF8_STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_1252_DECODER = new TextDecoder("windows-1252");

/**
 * byte value (0-255) -> character, built by decoding every byte value through the windows-1252
 * decoder once. windows-1252 is a total single-byte mapping - the WHATWG encoding index assigns
 * even its five formally-unused positions (0x81/0x8D/0x8F/0x90/0x9D) to their C1 control code
 * points - so this string covers all 256 byte values with no gaps, and every character is a
 * single BMP code point, so spreading it below stays 1:1 with byte offset.
 */
const WINDOWS_1252_BYTE_TO_CHAR = WINDOWS_1252_DECODER.decode(Uint8Array.from({ length: 256 }, (_, i) => i));

/** character -> byte value: the reverse of the table above, used to encode text back on save. */
const WINDOWS_1252_CHAR_TO_BYTE: ReadonlyMap<string, number> = new Map(
    [...WINDOWS_1252_BYTE_TO_CHAR].map((ch, byte): [string, number] => [ch, byte]),
);

/**
 * Thrown by `encodeToResolvedEncoding` when saving would drop or corrupt a character the target
 * (non-UTF-8) encoding cannot represent. This is the loud-refusal side of the encoding-preserving
 * write: rather than silently transcoding the whole file to UTF-8 or writing U+FFFD replacement
 * characters, the save is refused and the error propagates to the caller.
 */
export class UnsupportedEncodingCharacterError extends Error {
    readonly character: string;
    readonly encoding: ResolvedEncoding;

    constructor(character: string, encoding: ResolvedEncoding) {
        super(
            `Cannot save: character ${JSON.stringify(character)} is not representable in ${encoding}. ` +
                "Save the file as UTF-8 (or remove the character) to keep this edit.",
        );
        this.name = "UnsupportedEncodingCharacterError";
        this.character = character;
        this.encoding = encoding;
    }
}

/**
 * Decode raw file bytes: strict UTF-8 first, falling back to windows-1252 if the bytes are not
 * valid UTF-8 - most real-world `.tra`/`.msg` files predate UTF-8 and are windows-1252/-1251-class
 * legacy-codepage text. The fallback is a total mapping (see WINDOWS_1252_BYTE_TO_CHAR above) so
 * this never itself throws: every byte sequence decodes to *some* string. A misdetected encoding
 * would only silently corrupt data on WRITE, so refusal happens there instead (see
 * `encodeToResolvedEncoding`), not here.
 */
export function decodeFileBytes(raw: Uint8Array): { text: string; encoding: ResolvedEncoding } {
    try {
        return { text: UTF8_STRICT_DECODER.decode(raw), encoding: "utf-8" };
    } catch {
        return { text: WINDOWS_1252_DECODER.decode(raw), encoding: "windows-1252" };
    }
}

/**
 * Encode text back to the encoding a file was originally read as, so untouched entries round-trip
 * byte-identically on save. Throws `UnsupportedEncodingCharacterError` for a windows-1252 file
 * whose edited text contains a character outside the windows-1252 repertoire - see the class doc.
 */
export function encodeToResolvedEncoding(text: string, encoding: ResolvedEncoding): Buffer {
    if (encoding === "utf-8") {
        return Buffer.from(text, "utf8");
    }
    const bytes: number[] = [];
    for (const ch of text) {
        const byte = WINDOWS_1252_CHAR_TO_BYTE.get(ch);
        if (byte === undefined) {
            throw new UnsupportedEncodingCharacterError(ch, encoding);
        }
        bytes.push(byte);
    }
    return Buffer.from(bytes);
}

/**
 * Write `data` to `absPath` atomically: write to a temp file in the SAME directory (guaranteeing
 * the same filesystem, so the rename below is atomic) then rename over the destination. A crash or
 * interruption mid-write leaves the original `.tra`/`.msg` - the document of record - untouched
 * instead of truncated; only the temp file can end up half-written.
 */
export function atomicWriteFileSync(absPath: string, data: Uint8Array): void {
    const dir = path.dirname(absPath);
    const tempPath = path.join(dir, `.${path.basename(absPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, absPath);
}
