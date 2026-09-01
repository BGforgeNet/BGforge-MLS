/**
 * Display label for an enum value: value-prefixed ("<value> <name>") so the same byte reads uniformly
 * wherever an enum surfaces - a dropdown option, a closed dropdown's selected label, or a list-entry
 * summary - across every format (an opcode, an object type, an item-slot index). EXCEPT when the name
 * already carries that value as a whitespace-delimited token, where the prefix would only show the number
 * twice (MapElevation names ARE the elevation number, "0" -> "0" not "0 0"; CRE "Ability 0" embeds the
 * index -> "0" not "0 Ability 0"). The token test is exact, so a value embedded in a larger token does not
 * count (value 1 vs "BOW03" -> "1 BOW03"). A blank name renders as just the value.
 *
 * `hexDigits > 0`: the field is a packed/bitfield value (its spec declares `format: "hex32"`), so the prefix
 * renders in hex, unsigned and zero-padded to `hexDigits` - the field's byte width x2, so a packed dword reads
 * "0x00800000 Conjurer" and a packed byte reads "0x13 Lawful evil", not the meaningless "8388608" / "19". Pass
 * 0 (the default) for plain decimal. Whether a value IS hex, and how wide, are model facts (the declared
 * format and the codec width), never inferred here from the value's magnitude.
 */
export function enumValueLabel(value: number, name: string, hexDigits = 0): string {
    // `>>> 0` is unsigned-32-bit coercion (not truncation): a high-bit / i32-negative code renders as unsigned
    // hex (0x80000000, not -0x80000000). Math.trunc would keep it negative - not equivalent.
    const v = hexDigits > 0 ? `0x${(value >>> 0).toString(16).padStart(hexDigits, "0")}` : String(value);
    if (!name || name.split(/\s+/).includes(v)) return v;
    return `${v} ${name}`;
}

/**
 * The label for a STORED enum value, as it reads on a closed dropdown and in a list-entry summary: the
 * mapped option name when the value is known, or "Unknown" when it is out of range - both value-prefixed via
 * `enumValueLabel` (hex-prefixed when `hexDigits > 0`). Both surfaces reconstruct from the option map (not the
 * parser's raw displayValue) so an unmapped value reads "0 Unknown", never the parser's "0 Unknown (0)".
 */
export function enumSelectedLabel(value: number, options: Record<string, string> | undefined, hexDigits = 0): string {
    return enumValueLabel(value, options?.[String(value)] ?? "Unknown", hexDigits);
}

/**
 * Hex digit width for an enum field's value prefix: 0 (render decimal) unless the field declares `hex32`, in
 * which case the width follows the field's byte size - a u8 kit/alignment byte renders 2 digits ("0x13"), a
 * u32 kit dword renders 8 ("0x00800000"). Size is the field's byte count; a missing size assumes a 4-byte
 * field. ("hex32" is the historical format name for "render in hex"; the actual digit count is the codec
 * width, not a fixed 32 bits.)
 */
export function enumHexDigits(numericFormat: string | undefined, size: number | undefined): number {
    return numericFormat === "hex32" ? (size ?? 4) * 2 : 0;
}
