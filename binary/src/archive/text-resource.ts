/**
 * Decoding shared by the game's plain-text lookup resources (IDS, 2DA).
 *
 * Either may be XOR-encrypted "to prevent casual tampering" behind an 0xFFFF marker, with a 64-byte key applied
 * cyclically (IESDP encryption.htm) - BG2 ships SOUNDOFF.IDS that way. A reader that skips the check gets binary
 * noise rather than a table, so both parsers decode through here.
 */

const ENCRYPTED_MARKER = 0xff;
// prettier-ignore
const IE_XOR_KEY = Uint8Array.from([
    0x88, 0xa8, 0x8f, 0xba, 0x8a, 0xd3, 0xb9, 0xf5, 0xed, 0xb1, 0xcf, 0xea, 0xaa, 0xe4, 0xb5, 0xfb,
    0xeb, 0x82, 0xf9, 0x90, 0xca, 0xc9, 0xb5, 0xe7, 0xdc, 0x8e, 0xb7, 0xac, 0xee, 0xf7, 0xe0, 0xca,
    0x8e, 0xea, 0xca, 0x80, 0xce, 0xc5, 0xad, 0xb7, 0xc4, 0xd0, 0x84, 0x93, 0xd5, 0xf0, 0xeb, 0xc8,
    0xb4, 0x9d, 0xcc, 0xaf, 0xa5, 0x95, 0xba, 0x99, 0x87, 0xd2, 0x9d, 0xe3, 0x91, 0xba, 0x90, 0xca,
]);

/** Decode a text resource, decrypting first when it carries the 0xFFFF marker. */
export function decodeTextResource(bytes: Uint8Array): string {
    if (bytes[0] !== ENCRYPTED_MARKER || bytes[1] !== ENCRYPTED_MARKER) {
        return new TextDecoder("latin1").decode(bytes);
    }
    const body = bytes.subarray(2);
    const plain = new Uint8Array(body.length);
    for (const [i, byte] of body.entries()) plain[i] = byte ^ IE_XOR_KEY[i % IE_XOR_KEY.length]!;
    return new TextDecoder("latin1").decode(plain);
}
