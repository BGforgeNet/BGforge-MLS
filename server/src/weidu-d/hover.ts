/**
 * Hover functionality for WeiDU D files.
 * Provides JSDoc-based hover for state labels (definitions and references).
 *
 * When the cursor is on a state label, finds the definition and extracts
 * JSDoc from the preceding comment. Falls through to static data hover
 * if no JSDoc is found.
 */

import { MarkupKind, Position } from "vscode-languageserver/node";
import { type HoverResult, HoverResult as HR } from "../language-provider";
import { LANG_WEIDU_D_TOOLTIP } from "../core/languages";
import { parseWithCache, isInitialized } from "./parser";
import { SyntaxType } from "./tree-sitter.d";
import { findLabelNodeAtPosition, findStateInDialog } from "./state-utils";
import { parse as parseJSDoc } from "../shared/jsdoc";
import { buildSignatureBlock } from "../../../shared/tooltip-format";

/**
 * Get hover info for a state label (definition or reference).
 * Returns HoverResult.found() with JSDoc content, or HoverResult.notHandled()
 * to fall through to static data hover.
 */
export function getStateLabelHover(text: string, _symbol: string, _uri: string, position: Position): HoverResult {
    if (!isInitialized()) {
        return HR.notHandled();
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return HR.notHandled();
    }

    // Find the label node at cursor
    const labelInfo = findLabelNodeAtPosition(tree.rootNode, position);
    if (!labelInfo) {
        return HR.notHandled();
    }

    // Find the state definition in the matching dialog scope
    const state = findStateInDialog(tree.rootNode, labelInfo.dialogFile, labelInfo.labelNode.text);
    if (!state) {
        return HR.notHandled();
    }

    // Check for JSDoc comment preceding the state
    const comment = state.stateNode.previousNamedSibling;
    if (!comment || comment.type !== SyntaxType.Comment || !comment.text.startsWith("/**")) {
        return HR.notHandled();
    }

    // Parse JSDoc — D only uses the description, no tags
    const jsdoc = parseJSDoc(comment.text);
    if (!jsdoc.desc) {
        return HR.notHandled();
    }

    // Build hover content
    const signature = `state ${labelInfo.labelNode.text}`;
    const value = buildSignatureBlock(signature, LANG_WEIDU_D_TOOLTIP) + "\n\n---\n\n" + jsdoc.desc;

    return HR.found({
        contents: {
            kind: MarkupKind.Markdown,
            value,
        },
    });
}
