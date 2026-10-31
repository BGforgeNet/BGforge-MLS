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
    return value > INT_LITERAL_MAX ? `integer literal ${text} does not fit in 32 bits` : null;
}
