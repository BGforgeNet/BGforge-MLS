/**
 * The TypeScript operators TSSL accepts and the SSL operator each means, read by both routes. Kept out of
 * `types.ts`: that module is part of the published declarations, which cannot inline the SSL compiler's IR types.
 */

import type { AssignOp, BinaryOp } from "@bgforge/ssl";

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

/** The assignment operators, which arrive as binary expressions too and are spelled the same in SSL. */
export const ASSIGN_OPS: ReadonlyMap<string, AssignOp> = new Map<string, AssignOp>([
    ["=", "="],
    ["+=", "+="],
    ["-=", "-="],
    ["*=", "*="],
    ["/=", "/="],
]);
