/**
 * What a compiled script must stay inside, as the original Fallout 2 engine and the file format set it; sfall
 * changes none of these. Each is a refusal in the compiler: the reference compiles past every one of them, and the
 * result fails in the game or, for a table record, in anything that reads the file. The README's engine limits
 * table lists these beside the ones left unchecked.
 */

/** The engine stores an exported or imported name in 31 characters and then looks it up under its full name. */
export const EXTERNAL_NAME_MAX = 31;

/** The value stack is 4096 bytes of 6-byte values, and a push that would reach the end is a fatal error. */
export const VALUE_STACK_MAX = 682;

/**
 * The longest string a name or string table record holds: its 16-bit length counts the string, a NUL and padding
 * to even. The engine reads the string to its NUL and ignores the length, but every other reader walks by it.
 */
export const TABLE_STRING_MAX = 0xfffd;

/** An integer is one 32-bit operand. Read unsigned, so a hex mask such as `0xFFFFFFFF` is still one. */
const INT_LITERAL_MAX = 0xffffffff;

/** The refusal for an integer literal the operand cannot hold, or `null` when it fits. Front ends position it. */
export function intLiteralProblem(text: string, value: number): string | null {
    // NaN compares false against the bound, so it is refused by name rather than written out as zero.
    if (!Number.isFinite(value)) return `integer literal ${text} is not a finite number`;
    return value > INT_LITERAL_MAX ? `integer literal ${text} does not fit in 32 bits` : null;
}

/** A numeric literal's type and value; an integer carries its `intLiteralProblem` verdict. */
export type NumberLiteral = { kind: "float"; value: number } | { kind: "int"; value: number; problem: string | null };

/**
 * Reads a numeric literal the way both front ends spell one: a `.` makes it a float, and anything else is an
 * integer. Neither front end hands this an exponent form: the SSL grammar has none, and the TSSL front end writes
 * one out as a float with a point before it gets here.
 */
export function numberLiteral(text: string): NumberLiteral {
    const value = Number(text);
    if (text.includes(".")) return { kind: "float", value };
    return { kind: "int", value, problem: intLiteralProblem(text, value) };
}
