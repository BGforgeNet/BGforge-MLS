/**
 * Barrel module for TP2 completion context detection.
 * Re-exports the two public APIs: getContextAtPosition and getFuncParamsContext.
 *
 * Context detection uses tree-sitter to parse the document and walk the AST
 * from the cursor position upward, with a text-based fallback for incomplete
 * function/macro calls that tree-sitter cannot parse.
 */

import type { Position } from "vscode-languageserver/node";
import { SyntaxType } from "../../tree-sitter.d";
import { getUtf8ByteOffset } from "../../../shared/completion-context";
import { getLinePrefix } from "../../../common";
import { getParser, isInitialized } from "../../parser";
import { CompletionContext } from "../types";
import { ASSIGNMENT_SITE_PATTERN, DEFINITION_SITE_PATTERN, FUNC_CALL_KEYWORDS, FUNC_PARAM_KEYWORDS } from "./constants";
import { detectContextFromNode } from "./detectors";

export { getFuncParamsContext } from "./function-call";

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

/** Extract the line prefix up to the cursor, or null if position is out of bounds. */
function getLinePrefixAt(text: string, line: number, character: number): string | null {
    const lines = text.split("\n");
    if (line >= lines.length) return null;
    const currentLine = lines[line];
    if (currentLine === undefined) return null;
    return currentLine.substring(0, character);
}

/**
 * Text-based fallback for detecting lafName/lpfName/lamName/lpmName context.
 * Used when tree-sitter can't parse incomplete function/macro calls.
 * Returns the context or null if not at a function/macro name position.
 */
function detectFuncNameFromLineText(text: string, line: number, character: number): CompletionContext | null {
    const lineText = getLinePrefixAt(text, line, character);
    if (lineText === null) return null;

    const match = lineText.match(FUNC_CALL_KEYWORDS);
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
 * Matches "LAF/LPF funcname " — cursor is past the function name, in parameter position.
 */
function detectFuncParamFromLineText(text: string, line: number, character: number): CompletionContext | null {
    const lineText = getLinePrefixAt(text, line, character);
    if (lineText === null) return null;

    if (FUNC_PARAM_KEYWORDS.test(lineText)) {
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
    if (!isInitialized()) {
        return [];
    }

    const parser = getParser();
    const tree = parser.parse(text);
    if (!tree) {
        return [];
    }

    const cursorOffset = getUtf8ByteOffset(text, line, character);

    const node = tree.rootNode.descendantForPosition({ row: line, column: character });
    if (!node) {
        return [];
    }

    // No code completions inside comments; offer JSDoc tags inside /** */ comments
    if (node.type === SyntaxType.Comment) {
        const commentText = node.text.trimStart();
        if (commentText.startsWith("/**")) {
            return [CompletionContext.Jsdoc];
        }
        return [CompletionContext.Comment];
    }
    if (node.type === SyntaxType.LineComment) {
        return [CompletionContext.Comment];
    }

    // Walk up the tree to find function call/definition context
    const contexts = detectContextFromNode(node, cursorOffset);

    // Text-based fallback: detect function call contexts for incomplete code.
    // Only apply when tree-sitter found no context (empty array).
    if (contexts.length === 0) {
        const funcNameContext = detectFuncNameFromLineText(text, line, character);
        if (funcNameContext !== null) {
            return [funcNameContext];
        }
        // Detect parameter position: "LAF/LPF funcname " (past the name, typing params)
        const funcParamContext = detectFuncParamFromLineText(text, line, character);
        if (funcParamContext !== null) {
            return [funcParamContext];
        }
    }

    return contexts;
}
