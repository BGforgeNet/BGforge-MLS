/**
 * The BCS engine axis, shared by the client (decompiling a `.bcs` for the read-only view) and the server
 * (compiling a `.baf` with the built-in compiler) so both agree on which engine a configured install is.
 */

import type { IeScriptStyle } from "../binary/src/index";
import type { BcsEngine } from "../compilers/bcs/src/index";

/**
 * The BCS engine a detected script style names.
 *
 * The detector already reports the axis the decompiler needs - it is how the games themselves are told apart -
 * so this is a total mapping with no fallback. The two Baldur's Gate styles collapse because they share an
 * object layout and their naming differences live in the install's own tables, which are read either way.
 */
export function bcsEngineForScriptStyle(style: IeScriptStyle): BcsEngine {
    switch (style) {
        case "bg1":
        case "bg2":
            return "bg";
        case "iwd1":
            return "iwd";
        case "iwd2":
            return "iwd2";
        case "pst":
            return "pst";
        default: {
            const exhaustiveCheck: never = style;
            return exhaustiveCheck;
        }
    }
}
