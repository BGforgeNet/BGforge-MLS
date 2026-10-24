/**
 * Barrel module for TP2 completion context detection.
 * Re-exports the two public APIs: getContextAtPosition and getFuncParamsContext.
 *
 * Context detection uses tree-sitter to parse the document and walk the AST
 * from the cursor position upward, with a text-based fallback for incomplete
 * function/macro calls that tree-sitter cannot parse.
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SUBTYPES, SyntaxType } from "../../syntax-type";
import { CommentKind, detectCommentKind } from "../../../shared/completion-context";
import { getLinePrefix } from "../../../cursor-utils";
import { isInitialized, parseWithCache } from "@bgforge/shared/parsers/weidu-tp2";
import { CompletionContext } from "../types";
import { ASSIGNMENT_SITE_PATTERN, DEFINITION_SITE_PATTERN, FUNC_CALL_KEYWORDS, FUNC_PARAM_KEYWORDS } from "./constants";
import { detectContextFromNode } from "./detectors";
import { lastTokenBefore, resetFuncParamsContext } from "./function-call";

export { getFuncParamsContext } from "./function-call";

const LAUNCH_CALL_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.ActionLaunchFunction,
    SyntaxType.PatchLaunchFunction,
    SyntaxType.ActionLaunchMacro,
    SyntaxType.PatchLaunchMacro,
]);

/**
 * The last token before the cursor when it belongs to a call still being typed (its END missing). tree-sitter
 * ends such a call at that token, so the node at the cursor lies outside the call even though the user is still
 * inside it. A new line after it counts as inside too: the call stays open until its END, so a statement typed
 * there before the END gets the call's contexts.
 */
function unfinishedCallToken(root: SyntaxNode, cursorOffset: number): SyntaxNode | null {
    const token = lastTokenBefore(root, cursorOffset);
    for (let node = token?.parent ?? null; node; node = node.parent) {
        if (LAUNCH_CALL_TYPES.has(node.type)) {
            return node.lastChild?.isMissing ? token : null;
        }
    }
    return null;
}

/** Bodies whose statements are patches, beside the patch statements themselves. */
const PATCH_BODIES: ReadonlySet<string> = new Set([
    SyntaxType.Patches,
    SyntaxType.PatchFile,
    SyntaxType.ActionDefinePatchFunction,
    SyntaxType.ActionDefinePatchMacro,
]);

/**
 * Whether a statement typed at the cursor is a patch rather than an action: decided by the nearest enclosing
 * statement or body of the last token before the cursor. A half-typed word that error recovery left outside any
 * statement belongs to what precedes it. A COPY-family action's patch list ends where the code stops being
 * indented deeper than the action, which is how TP2 is written; on the action's own line its pairs come first.
 */
export function isPatchPosition(text: string, line: number, character: number): boolean {
    const tree = isInitialized() ? parseWithCache(text) : null;
    if (!tree) return false;
    const cursorOffset = TextDocument.create("", "", 0, text).offsetAt({ line, character });
    const lineText = text.split("\n")[line] ?? "";
    const indent = Math.min(character, lineText.search(/\S|$/));

    let token = lastTokenBefore(tree.rootNode, cursorOffset);
    for (let node = token?.parent ?? null; node; node = node.parent) {
        if (node.type === SyntaxType.ERROR) {
            token = lastTokenBefore(tree.rootNode, node.startIndex);
            break;
        }
    }

    for (let node = token?.parent ?? null; node; node = node.parent) {
        const owner = node.parent;
        if (node.type === SyntaxType.Patches && owner && SUBTYPES.action.has(owner.type)) {
            return owner.startPosition.row === line || indent > owner.startPosition.column;
        }
        if (node.type === SyntaxType.PatchFile) return true;
        // A statement or body that ended before the cursor holds nothing typed now; its container decides.
        if (node.endIndex < cursorOffset) continue;
        if (PATCH_BODIES.has(node.type) || SUBTYPES.patch.has(node.type)) return true;
        if (SUBTYPES.action.has(node.type)) {
            return node.children.some((child) => child.type === SyntaxType.FilePair && child.endIndex < cursorOffset);
        }
    }
    return false;
}

/**
 * The text of the statement the cursor is in when tree-sitter could not build it: from the start of the ERROR
 * node holding the last token before the cursor, else the current line. A call split over lines (`LAF fn` on
 * one line, `ST|` on the next) is one statement to the text fallbacks.
 */
function statementPrefix(text: string, root: SyntaxNode, cursorOffset: number, position: Position): string {
    for (let node = lastTokenBefore(root, cursorOffset)?.parent ?? null; node; node = node.parent) {
        if (node.type === SyntaxType.ERROR) return text.slice(node.startIndex, cursorOffset);
    }
    return getLinePrefix(text, position);
}

/**
 * Result of declaration site detection.
 * - "assignment": cursor is on a variable name after SET/SPRINT - show local variable completions
 * - "definition": cursor is on a name after DEFINE_* / FOR_EACH / etc - suppress all completions
 * - false: not a declaration site - normal completions
 */
export type DeclarationSiteResult = "assignment" | "definition" | false;

/**
 * Check if the cursor is at a declaration site where the user is naming a new symbol.
 * Returns "assignment" for variable SET/SPRINT sites, "definition" for function/macro/array/loop
 * definition sites, or false if not at a declaration site.
 */
export function isAtDeclarationSite(text: string, position: Position): DeclarationSiteResult {
    const prefix = getLinePrefix(text, position);
    if (ASSIGNMENT_SITE_PATTERN.test(prefix)) {
        return "assignment";
    }
    if (DEFINITION_SITE_PATTERN.test(prefix)) {
        return "definition";
    }
    return false;
}

/**
 * Text-based fallback for detecting lafName/lpfName/lamName/lpmName context.
 * Used when tree-sitter can't parse incomplete function/macro calls.
 * Returns the context or null if not at a function/macro name position.
 */
function detectFuncNameFromText(prefix: string): CompletionContext | null {
    const match = prefix.match(FUNC_CALL_KEYWORDS);
    if (!match || !match[1]) return null;

    const keyword = match[1].toUpperCase();
    switch (keyword) {
        case "LAF":
        case "LAUNCH_ACTION_FUNCTION":
            return CompletionContext.LafName;
        case "LPF":
        case "LAUNCH_PATCH_FUNCTION":
            return CompletionContext.LpfName;
        case "LAM":
        case "LAUNCH_ACTION_MACRO":
            return CompletionContext.LamName;
        case "LPM":
        case "LAUNCH_PATCH_MACRO":
            return CompletionContext.LpmName;
        default:
            return null;
    }
}

/**
 * Text-based fallback for detecting funcParamName context.
 * Used when tree-sitter can't parse incomplete function calls (e.g., no END yet).
 * Matches "LAF/LPF funcname " - cursor is past the function name, in parameter position.
 */
function detectFuncParamFromText(prefix: string): CompletionContext | null {
    if (FUNC_PARAM_KEYWORDS.test(prefix)) {
        return CompletionContext.FuncParamName;
    }
    return null;
}

/**
 * Determine the completion context at a given position.
 * Uses tree-sitter to parse the text and walk up from cursor position.
 *
 * Returns an array of contexts. Empty array means no filtering (show everything).
 * Only function call/definition name/param positions produce non-empty contexts.
 *
 * @param text Document text
 * @param line 0-based line number
 * @param character 0-based character offset
 * @returns Array of detected contexts, or empty array if no filtering needed
 */
export function getContextAtPosition(text: string, line: number, character: number): CompletionContext[] {
    resetFuncParamsContext();
    if (!isInitialized()) {
        return [];
    }

    // Cached like every other tree-sitter consumer in the server - this was the one site left on a raw
    // parse, and it sits on the completion path, so each keystroke re-parsed the whole document, about 70x
    // the cost of the cached tree on a large installer.
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    // A UTF-16 offset, the unit tree-sitter's node indices use for the JS string it parsed.
    const cursorOffset = TextDocument.create("", "", 0, text).offsetAt({ line, character });

    const node = tree.rootNode.descendantForPosition({ row: line, column: character });
    if (!node) {
        return [];
    }

    // No code completions inside comments; offer JSDoc tags inside /** */ comments.
    // Boundary-robust: a cursor at the end of a line comment must still count as in-comment.
    const commentKind = detectCommentKind(
        tree.rootNode,
        { line, character },
        SyntaxType.Comment,
        SyntaxType.LineComment,
    );
    if (commentKind === CommentKind.Jsdoc) {
        return [CompletionContext.Jsdoc];
    }
    if (commentKind === CommentKind.Comment) {
        return [CompletionContext.Comment];
    }

    // Walk up the tree to find function call/definition context
    let contexts = detectContextFromNode(node, cursorOffset);

    // A call still being typed ends before the cursor; detect from its last token instead.
    if (contexts.length === 0) {
        const callToken = unfinishedCallToken(tree.rootNode, cursorOffset);
        if (callToken) {
            contexts = detectContextFromNode(callToken, cursorOffset);
        }
    }

    // Text-based fallback: detect function call contexts for incomplete code.
    // Only apply when tree-sitter found no context (empty array).
    if (contexts.length === 0) {
        const prefix = statementPrefix(text, tree.rootNode, cursorOffset, { line, character });
        const funcNameContext = detectFuncNameFromText(prefix);
        if (funcNameContext !== null) {
            return [funcNameContext];
        }
        // Detect parameter position: "LAF/LPF funcname " (past the name, typing params)
        const funcParamContext = detectFuncParamFromText(prefix);
        if (funcParamContext !== null) {
            return [funcParamContext];
        }
    }

    return contexts;
}
