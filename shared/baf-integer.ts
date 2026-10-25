/**
 * The value of a BAF `number` node's text.
 *
 * The grammar reads one node type for every integer spelling a script can use: decimal, `0x` then decimal digits
 * (read as base 16), either one signed, and a `#` prefix (`#5`, `# 5`) that the reference reads as a plain
 * integer in a value position. Every consumer that turns the text into a number goes through here, because
 * `Number()` alone reads none of the signed-hex and hash forms.
 */

/** NaN when the text is not a number - a `%variable%` standing where one is expected, say. */
export function bafIntegerValue(text: string): number {
    const body = text.replace(/^#\s*/, "");
    const negative = body.startsWith("-");
    const digits = negative ? body.slice(1) : body;
    const magnitude = digits.startsWith("0x") ? Number.parseInt(digits.slice(2), 16) : Number(digits);
    return negative ? -magnitude : magnitude;
}

const QUOTED_INTEGER =
    /^([+-]?)(?:0[xX]([0-9a-fA-F][0-9a-fA-F_]*)|0[oO]([0-7][0-7_]*)|0[bB]([01][01_]*)|0[uU](\d[\d_]*)|(\d[\d_]*))$/;

/**
 * The value of a quoted text standing in a number slot (`"3"`, `"0xFF"`), read as the reference reads it: its
 * host language's integer syntax, which unlike a bare literal takes hex letters, `0o` and `0b`, `_` between
 * digits and a leading `+`, and no surrounding space. NaN when the text is none of those.
 */
export function bafQuotedIntegerValue(text: string): number {
    const match = QUOTED_INTEGER.exec(text);
    if (match === null) return Number.NaN;
    const [, sign, hex, octal, binary, unsigned, decimal] = match;
    const radix = hex !== undefined ? 16 : octal !== undefined ? 8 : binary !== undefined ? 2 : 10;
    const digits = (hex ?? octal ?? binary ?? unsigned ?? decimal ?? "").replaceAll("_", "");
    const magnitude = Number.parseInt(digits, radix);
    return sign === "-" ? -magnitude : magnitude;
}
