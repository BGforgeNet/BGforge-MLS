/**
 * Single source of truth for `string` field charset rules.
 *
 * `stringCharset` is declared per-field in `presentation-schema.ts` and resolved
 * via `resolveStringCharset`. Both the host-side validator and the webview's
 * live keystroke sanitizer must agree on what each charset *means* — the
 * predicate below is the authoritative answer, imported by both sides.
 *
 * `ascii-printable`: codepoints 0x20..0x7E inclusive. Engines that consume
 * these strings (1990s-era Fallout / Infinity Engine binaries) do not honour
 * multi-byte encodings; restricting input keeps on-disk bytes within the
 * engine's documented input range.
 *
 * `utf8`: any codepoint whose UTF-8 encoding fits the field's byte budget.
 */
export type StringCharset = "ascii-printable" | "utf8";

export function isCharAllowedInCharset(codePoint: number, charset: StringCharset): boolean {
    if (charset === "utf8") {
        return true;
    }
    return codePoint >= 0x20 && codePoint <= 0x7e;
}

export function isStringAllowedInCharset(value: string, charset: StringCharset): boolean {
    if (charset === "utf8") {
        return true;
    }
    for (let i = 0; i < value.length; i++) {
        if (!isCharAllowedInCharset(value.charCodeAt(i), charset)) {
            return false;
        }
    }
    return true;
}
