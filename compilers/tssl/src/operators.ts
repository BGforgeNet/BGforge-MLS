/**
 * The TypeScript operators TSSL accepts and the SSL operator each means, read by both routes. Kept out of
 * `types.ts`: that module is part of the published declarations, which cannot inline the SSL compiler's IR types.
 */

import { SyntaxKind, type BinaryExpression } from "ts-morph";
import type { AssignOp, BinaryOp } from "@bgforge/ssl";
import { refuseAt } from "./program-model";

/**
 * TypeScript binary operators and the SSL operator each means, which is also its SSL spelling. An allowlist: an
 * operator absent here is refused by both routes rather than passed through. SSL's own set is wider - `in`,
 * `div`, `orelse`, `andalso` have no TypeScript spelling to map from.
 */
export const BINARY_OPS: ReadonlyMap<string, BinaryOp> = new Map<string, BinaryOp>([
    ["+", "+"],
    ["-", "-"],
    ["*", "*"],
    ["/", "/"],
    ["%", "%"],
    ["==", "=="],
    ["===", "=="],
    ["!=", "!="],
    ["!==", "!="],
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
    ["&", "bwand"],
    ["|", "bwor"],
    // `bwxor`, not `bxor` - the latter is not an SSL token and the compiler rejects it.
    ["^", "bwxor"],
    ["&&", "and"],
    ["||", "or"],
]);

/**
 * Operators refused by name, with what to write instead. SSL has no shift: `>>` is not a division because it
 * floors where SSL's `/` truncates toward zero, so the two differ on a negative value.
 */
export const REFUSED_OPS: ReadonlyMap<string, string> = new Map([
    ["**", "'**' is not supported; SSL spells exponentiation '^'"],
    ["??", "'??' is not supported; SSL has no null"],
    [">>", "'>>' is not supported; SSL has no shift. For a non-negative value, divide by a power of two"],
    [">>>", "'>>>' is not supported; SSL has no shift. For a non-negative value, divide by a power of two"],
]);

/**
 * The factor `a << n` multiplies by, which is how both routes write it: SSL has no shift, and a multiply by
 * 2^n wraps in the engine's 32-bit integers exactly as the shift does. The count must be a literal, since a
 * computed one has no constant factor; 2^31 still fits, as an integer literal is read unsigned.
 */
export function leftShiftFactor(shift: BinaryExpression): number {
    const count = shift.getRight().asKind(SyntaxKind.NumericLiteral)?.getLiteralValue();
    if (count === undefined || !Number.isInteger(count) || count > 31) {
        throw refuseAt(
            shift,
            "'<<' needs an integer literal count from 0 to 31; SSL has no shift, so it is a multiply",
        );
    }
    return 2 ** count;
}

/** The assignment operators, which arrive as binary expressions too and are spelled the same in SSL. */
export const ASSIGN_OPS: ReadonlyMap<string, AssignOp> = new Map<string, AssignOp>([
    ["=", "="],
    ["+=", "+="],
    ["-=", "-="],
    ["*=", "*="],
    ["/=", "/="],
]);
