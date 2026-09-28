/**
 * The BCS engine axis, shared by the client (decompiling a `.bcs` for the read-only view) and the server
 * (compiling a `.baf` with the built-in compiler) so both agree on which engine a configured install is.
 */

import type { IeScriptStyle } from "../../../binary/src/archive/game-type";
import type { BcsEngine } from "./signature";

/**
 * The BCS engine a detected script style names.
 *
 * The detector already reports the axis the decompiler needs - it is how the games themselves are told apart -
 * so this is a total mapping with no fallback. The two Baldur's Gate styles collapse because they share an
 * object layout and their naming differences live in the install's own tables, which are read either way.
 * A Record rather than a switch: the key type makes a missing style a compile error without an unreachable
 * default branch.
 */
const ENGINE_FOR_STYLE: Readonly<Record<IeScriptStyle, BcsEngine>> = {
    bg1: "bg",
    bg2: "bg",
    iwd1: "iwd",
    iwd2: "iwd2",
    pst: "pst",
};

export function bcsEngineForScriptStyle(style: IeScriptStyle): BcsEngine {
    return ENGINE_FOR_STYLE[style];
}
