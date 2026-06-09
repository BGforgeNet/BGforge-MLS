/**
 * Display label for an enum value: value-prefixed ("<value> <name>") so the same byte reads uniformly
 * wherever an enum surfaces - a dropdown option, a closed dropdown's selected label, or a list-entry
 * summary - across every format (an opcode, an object type, an item-slot index). EXCEPT when the name
 * already carries that value as a whitespace-delimited token, where the prefix would only show the number
 * twice (MapElevation names ARE the elevation number, "0" -> "0" not "0 0"; CRE "Ability 0" embeds the
 * index -> "0" not "0 Ability 0"). The token test is exact, so a value embedded in a larger token does not
 * count (value 1 vs "BOW03" -> "1 BOW03"). A blank name renders as just the value.
 */
export function enumValueLabel(value: number, name: string): string {
    const v = String(value);
    if (!name || name.split(/\s+/).includes(v)) return v;
    return `${v} ${name}`;
}

/**
 * The label for a STORED enum value, as it reads on a closed dropdown and in a list-entry summary: the
 * mapped option name when the value is known, or "Unknown" when it is out of range - both value-prefixed via
 * `enumValueLabel`. Both surfaces reconstruct from the option map (not the parser's raw displayValue) so an
 * unmapped value reads "0 Unknown", never the parser's "0 Unknown (0)".
 */
export function enumSelectedLabel(value: number, options: Record<string, string> | undefined): string {
    return enumValueLabel(value, options?.[String(value)] ?? "Unknown");
}
