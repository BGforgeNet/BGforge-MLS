/**
 * Snippet generation for WeiDU TP2 completions.
 * Builds VS Code snippets with tab stops for function call parameters
 * and SET/SPRINT variable assignment keywords.
 * Indent size is shared with the formatter via DEFAULT_OPTIONS.
 */

import type { CallableInfo, CallableParam } from "../core/symbol";
import { weiduTp2DefaultOptions as DEFAULT_OPTIONS } from "@bgforge/format";
import { SyntaxType } from "./tree-sitter.d";

/**
 * Variable assignment node types from the grammar, grouped by snippet pattern.
 * SET-style: `KEYWORD var = expr` (uses SyntaxType.*Set)
 * SPRINT-style: `KEYWORD var "value"` (uses SyntaxType.*Sprint/*TextSprint)
 *
 * Tied to SyntaxType rather than plain strings so adding/removing a keyword
 * requires updating the grammar first — the compiler catches stale entries.
 */
const SET_SYNTAX_TYPES: ReadonlySet<SyntaxType> = new Set([SyntaxType.PatchSet, SyntaxType.ActionOuterSet]);

const SPRINT_SYNTAX_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.PatchSprint,
    SyntaxType.PatchTextSprint,
    SyntaxType.ActionOuterSprint,
    SyntaxType.ActionOuterTextSprint,
]);

/** Maps completion label (from YAML data) to grammar node type. */
const KEYWORD_TO_SYNTAX: ReadonlyMap<string, SyntaxType> = new Map([
    ["SET", SyntaxType.PatchSet],
    ["OUTER_SET", SyntaxType.ActionOuterSet],
    ["SPRINT", SyntaxType.PatchSprint],
    ["TEXT_SPRINT", SyntaxType.PatchTextSprint],
    ["OUTER_SPRINT", SyntaxType.ActionOuterSprint],
    ["OUTER_TEXT_SPRINT", SyntaxType.ActionOuterTextSprint],
]);

/**
 * Build a snippet for a SET/SPRINT family keyword, or return undefined
 * if the keyword is not in the known set.
 * Pattern is derived from the grammar node type: set-style uses `=`, sprint-style uses quotes.
 */
export function getKeywordSnippet(keyword: string): string | undefined {
    const syntaxType = KEYWORD_TO_SYNTAX.get(keyword);
    if (syntaxType === undefined) {
        return undefined;
    }
    if (SET_SYNTAX_TYPES.has(syntaxType)) {
        return `${keyword} \${1} = \${2}$0`;
    }
    if (SPRINT_SYNTAX_TYPES.has(syntaxType)) {
        return `${keyword} \${1} "\${2}"$0`;
    }
    return undefined;
}

const INDENT_UNIT = " ".repeat(DEFAULT_OPTIONS.indentSize);
const KEYWORD_INDENT = INDENT_UNIT;
const ASSIGN_INDENT = INDENT_UNIT.repeat(2);

/**
 * Build a snippet for a function/macro call.
 * Always returns a snippet when prefix is provided (wraps in LPF/LAF ... END).
 * Without prefix, only returns a snippet when there are required parameters.
 *
 * @param callable - CallableInfo from Symbols (has JSDoc data merged into params)
 * @param name - Function name
 * @param prefix - Optional prefix to add before function name (e.g., "LAF" or "LPF")
 */
export function buildFunctionCallSnippet(callable: CallableInfo, name: string, prefix?: string): string | null {
    // When params info is available, check if any params exist.
    // When params is undefined (static symbols from YAML), assume params may exist.
    const params = callable.params;
    const hasParams =
        params !== undefined &&
        (params.intVar.length > 0 || params.strVar.length > 0 || params.ret.length > 0 || params.retArray.length > 0);
    const mayHaveParams = params === undefined || hasParams;

    // Without prefix (lafName/lpfName context), only generate snippet if may have params
    if (!prefix && !mayHaveParams) {
        return null;
    }

    // Macro launch (LAM/LPM) is a simple statement — no params, no END
    if (prefix === "LAM" || prefix === "LPM") {
        return `${prefix} ${name}$0`;
    }

    const firstLine = prefix ? `${prefix} ${name}` : name;

    // No params: single-line "LAF name END", cursor at end
    if (!mayHaveParams) {
        return `${firstLine} END$0`;
    }

    // If any required input params or any RET params exist, build explicit param blocks
    const requiredInt = params?.intVar.filter((p) => p.required) ?? [];
    const requiredStr = params?.strVar.filter((p) => p.required) ?? [];
    const retParams = params?.ret ?? [];
    const retArrayParams = params?.retArray ?? [];

    if (requiredInt.length > 0 || requiredStr.length > 0 || retParams.length > 0 || retArrayParams.length > 0) {
        const lines = [firstLine];
        let tabStop = 1;
        tabStop = appendParamBlock(lines, "INT_VAR", requiredInt, tabStop);
        appendParamBlock(lines, "STR_VAR", requiredStr, tabStop);
        appendRetBlock(lines, "RET", retParams);
        appendRetBlock(lines, "RET_ARRAY", retArrayParams);
        lines.push("END");
        return lines.join("\n") + "$0";
    }

    // Has params but none required and no RET: cursor between name and END for manual entry
    return `${firstLine}\n${INDENT_UNIT}$0\nEND`;
}

/**
 * Append a param keyword block (INT_VAR or STR_VAR) with aligned assignments.
 * Names are padded to the longest name in the block so `=` signs align vertically.
 * Returns the next tab stop number.
 *
 * NOTE: This mirrors the alignment logic in outputAlignedAssignments() in format/utils.ts.
 * If formatting rules change (indentation, alignment, separator), update both places.
 */
function appendParamBlock(lines: string[], keyword: string, params: readonly CallableParam[], tabStop: number): number {
    if (params.length === 0) {
        return tabStop;
    }
    const maxNameLen = Math.max(...params.map((p) => p.name.length));
    lines.push(`${KEYWORD_INDENT}${keyword}`);
    for (const p of params) {
        const padding = " ".repeat(maxNameLen - p.name.length);
        lines.push(`${ASSIGN_INDENT}${p.name}${padding} = \${${tabStop++}}`);
    }
    return tabStop;
}

/**
 * Append a RET or RET_ARRAY block with plain identifiers.
 * RET supports both `RET var = expr` and the short form `RET var`.
 * We insert the short form since it covers the common case.
 */
function appendRetBlock(lines: string[], keyword: "RET" | "RET_ARRAY", params: readonly string[]): void {
    if (params.length === 0) {
        return;
    }
    lines.push(`${KEYWORD_INDENT}${keyword}`);
    for (const name of params) {
        lines.push(`${ASSIGN_INDENT}${name}`);
    }
}
