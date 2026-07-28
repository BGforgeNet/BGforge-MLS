/**
 * IDS lookup tables: the game's own mapping from a numeric identifier to a symbolic name.
 *
 * Read from the installed game rather than vendored, because the mapping is per-install: BG1's SOUNDOFF.IDS and
 * BG2's SNDSLOT.IDS disagree on most sound slots, and mods extend these tables.
 */

// Text resources may be XOR-encrypted "to prevent casual tampering" behind an 0xFFFF marker, with this 64-byte
// key applied cyclically (IESDP encryption.htm). BG2 ships SOUNDOFF.IDS this way.
const ENCRYPTED_MARKER = 0xff;
// prettier-ignore
const IE_XOR_KEY = Uint8Array.from([
    0x88, 0xa8, 0x8f, 0xba, 0x8a, 0xd3, 0xb9, 0xf5, 0xed, 0xb1, 0xcf, 0xea, 0xaa, 0xe4, 0xb5, 0xfb,
    0xeb, 0x82, 0xf9, 0x90, 0xca, 0xc9, 0xb5, 0xe7, 0xdc, 0x8e, 0xb7, 0xac, 0xee, 0xf7, 0xe0, 0xca,
    0x8e, 0xea, 0xca, 0x80, 0xce, 0xc5, 0xad, 0xb7, 0xc4, 0xd0, 0x84, 0x93, 0xd5, 0xf0, 0xeb, 0xc8,
    0xb4, 0x9d, 0xcc, 0xaf, 0xa5, 0x95, 0xba, 0x99, 0x87, 0xd2, 0x9d, 0xe3, 0x91, 0xba, 0x90, 0xca,
]);

function decodeText(bytes: Uint8Array): string {
    if (bytes[0] !== ENCRYPTED_MARKER || bytes[1] !== ENCRYPTED_MARKER) {
        return new TextDecoder("latin1").decode(bytes);
    }
    const body = bytes.subarray(2);
    const plain = new Uint8Array(body.length);
    for (const [i, byte] of body.entries()) plain[i] = byte ^ IE_XOR_KEY[i % IE_XOR_KEY.length]!;
    return new TextDecoder("latin1").decode(plain);
}

/** Parse an IDS resource into value -> identifier. Malformed rows are skipped rather than failing the table. */
export function parseIds(bytes: Uint8Array): Map<number, string> {
    const text = decodeText(bytes);
    const table = new Map<number, string>();
    for (const line of text.split(/\r?\n/)) {
        // Two columns, value then identifier (IESDP ids.htm). The header lines - a file identifier such as
        // "IDS V1.0" and an entry count - are both optional and both fail this shape, so neither needs a
        // special case; the count line is documented as unreliable anyway.
        const match = /^\s*(\S+)\s+(\S+)\s*$/.exec(line);
        const name = match?.[2];
        if (match === null || name === undefined) continue;
        const value = Number(match[1]);
        if (!Number.isInteger(value)) continue;
        table.set(value, name);
    }
    return table;
}
