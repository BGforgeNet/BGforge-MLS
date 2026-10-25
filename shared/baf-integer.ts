/**
 * The value of a BAF `number` node's text.
 *
 * The grammar reads one node type for every integer spelling a script can use: decimal, `0x` hex, either one
 * signed, and a `#` prefix (`#5`, `# 5`) that the reference reads as a plain integer in a value position. Every
 * consumer that turns the text into a number goes through here, because `Number()` alone reads none of the
 * signed-hex and hash forms.
 */

/** NaN when the text is not a number - a `%variable%` standing where one is expected, say. */
export function bafIntegerValue(text: string): number {
    const body = text.replace(/^#\s*/, "");
    const negative = body.startsWith("-");
    const digits = negative ? body.slice(1) : body;
    const magnitude = digits.startsWith("0x") ? Number.parseInt(digits.slice(2), 16) : Number(digits);
    return negative ? -magnitude : magnitude;
}
