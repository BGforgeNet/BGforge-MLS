/**
 * Local signature help for Fallout SSL files.
 * Extracts procedure and macro signatures from the current file using tree-sitter.
 */

import type { SignatureHelp } from "vscode-languageserver/node";
import { parseWithCache, isInitialized } from "./parser";
import * as jsdoc from "../shared/jsdoc";
import { findProcedure, findPrecedingDocComment, extractMacros, extractParams } from "./utils";
import { buildSignatureHelp } from "./macro-utils";

/**
 * Get signature help for a local procedure or function-like macro.
 * Returns null if the symbol is not found in the current file.
 */
export function getLocalSignature(text: string, symbol: string, paramIndex: number): SignatureHelp | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    // Try procedure first
    const procNode = findProcedure(tree.rootNode, symbol);
    if (procNode) {
        const params = extractParams(procNode);
        const docComment = findPrecedingDocComment(tree.rootNode, procNode);
        const parsed = docComment ? jsdoc.parse(docComment) : null;

        const sig = buildSignatureHelp(symbol, params, parsed, "");
        return {
            signatures: [sig],
            activeSignature: 0,
            activeParameter: paramIndex,
        };
    }

    // Try macros
    const macros = extractMacros(tree.rootNode);
    const macro = macros.find(m => m.name === symbol && m.hasParams);

    if (macro && macro.params) {
        const sig = buildSignatureHelp(
            macro.name,
            macro.params.map(name => ({ name })),
            macro.jsdoc ?? null,
            "",
        );
        return {
            signatures: [sig],
            activeSignature: 0,
            activeParameter: paramIndex,
        };
    }

    return null;
}
