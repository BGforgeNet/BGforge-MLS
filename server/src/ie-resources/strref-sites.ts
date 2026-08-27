/**
 * Locates TLK string references in a parsed script: which argument of which call is a strref, and where the
 * number sits. Resolving those to text is `./configured-game`; this module only says where to look.
 *
 * The strref slots come from a map generated from the engine data's own signatures, so a data update moves the
 * hints with it and no list of action names lives in code.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type { Range } from "vscode-languageserver/node";
import { SyntaxType } from "../weidu-baf/syntax-type";

/** One strref argument found in the source. */
export interface StrRefSite {
    readonly strref: number;
    /** Covers the number itself, so a hint sits right after it and a hover targets only it. */
    readonly range: Range;
}

/** The strref argument positions of a call, or undefined when it takes none. */
export type StrRefParams = (name: string) => readonly number[] | undefined;

/** Every strref argument under `root`, in source order. Nested calls are walked, so overrides are covered. */
export function findStrRefSites(root: SyntaxNode, paramsOf: StrRefParams): StrRefSite[] {
    const sites: StrRefSite[] = [];
    collect(root, paramsOf, sites);
    return sites;
}

function collect(node: SyntaxNode, paramsOf: StrRefParams, sites: StrRefSite[]): void {
    if (node.type === SyntaxType.CallExpr) {
        const name = node.childForFieldName("func")?.text;
        const indexes = name === undefined ? undefined : paramsOf(name);
        if (indexes !== undefined) {
            const args = node.childrenForFieldName("args");
            for (const index of indexes) {
                const arg = args[index];
                // Only a bare number is a strref. A `@100` tra reference in the same slot resolves from the
                // mod's translation files, which the translation layer already annotates.
                if (arg?.type !== SyntaxType.Number) continue;
                sites.push({
                    // The grammar admits only `-?\d+` and `0x...` here, so this is always a whole number.
                    strref: Number(arg.text),
                    range: {
                        start: { line: arg.startPosition.row, character: arg.startPosition.column },
                        end: { line: arg.endPosition.row, character: arg.endPosition.column },
                    },
                });
            }
        }
    }
    for (const child of node.namedChildren) {
        if (child) collect(child, paramsOf, sites);
    }
}
