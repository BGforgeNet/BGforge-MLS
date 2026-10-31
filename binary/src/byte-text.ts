/**
 * The byte-to-text decodings the formats share, one definition each.
 *
 * - `decodeByteString` maps every byte to the code point of the same value (ISO-8859-1 proper). It is lossless, so
 *   fields that round-trip through a string or name a file use it: `chars` fields, resrefs, signatures, KEY BIF
 *   names and DLG script text.
 * - `decodeWindows1252` reads codepage text, as the classic games write their text resources and string tables.
 *   There 0x80-0x9F are printable characters (0x80 is the euro sign), not the C1 controls of the byte decoding.
 *
 * The WHATWG `latin1` label is an alias of windows-1252, so `new TextDecoder("latin1")` is the second decoding,
 * never the first.
 */

const WINDOWS_1252 = new TextDecoder("windows-1252");

/** `bytes[start, end)` as one character per byte, each the code point of the byte's value. */
export function decodeByteString(bytes: ArrayLike<number>, start = 0, end = bytes.length): string {
    let out = "";
    for (let i = start; i < end; i++) out += String.fromCodePoint(bytes[i]!);
    return out;
}

/** `bytes` decoded as windows-1252. */
export function decodeWindows1252(bytes: Uint8Array): string {
    return WINDOWS_1252.decode(bytes);
}
