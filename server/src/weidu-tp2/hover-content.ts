/**
 * Hover markdown builders for WeiDU TP2 header symbols.
 * Kept apart from hover.ts because the symbol conversion in header-parser.ts embeds this
 * markdown in the items it builds, while hover.ts parses headers through header-parser.ts.
 */

import { type Hover, MarkupKind } from "vscode-languageserver/node";
import type { Ret } from "../shared/jsdoc";
import type { FunctionInfo, VariableInfo } from "./header-parser";
import { looksLikeConstant } from "./tree-utils";
import { buildWeiduTable, type VarRow, type VarSection } from "../../../shared/tooltip-table";
import { buildWeiduHoverContent } from "../../../shared/tooltip-format";
import { LANG_WEIDU_TP2_TOOLTIP } from "../core/languages";

/** Maximum length for parameter descriptions in hover table. */
const DESC_MAX_LENGTH = 80;

/**
 * Build a lookup map from JSDoc rets[] for RET/RET_ARRAY variable info.
 */
export function buildRetsMap(rets?: Ret[]): Map<string, Ret> {
    const map = new Map<string, Ret>();
    if (!rets) {
        return map;
    }
    for (const ret of rets) {
        if (ret.name) {
            map.set(ret.name, ret);
        }
    }
    return map;
}

/**
 * Build hover content from FunctionInfo.
 * Exported for use in symbol conversion.
 *
 * Hover markdown structure:
 *   1. Signature line: action function my_func
 *   2. File path (workspace-relative via displayPath, skipped if null)
 *   3. JSDoc description
 *   4. Parameter table with @arg data (type links, descriptions, defaults)
 *   5. @deprecated notice
 *
 * @param funcInfo Function definition info
 * @param displayPath Path to show in hover:
 *   - `undefined` = extract filename from URI (default)
 *   - `string` = use provided path
 *   - `null` = skip path block entirely (for local symbols)
 */
export function buildFunctionHover(funcInfo: FunctionInfo, displayPath?: string | null): Hover {
    // Build JSDoc arg lookup map for type overrides
    const jsdocArgs = new Map<string, { type: string; description?: string; required?: boolean }>();
    if (funcInfo.jsdoc?.args) {
        for (const arg of funcInfo.jsdoc.args) {
            jsdocArgs.set(arg.name, { type: arg.type, description: arg.description, required: arg.required });
        }
    }

    const signatureLine = `${funcInfo.context} ${funcInfo.dtype} ${funcInfo.name}`;
    const filePath = displayPath === null ? undefined : (displayPath ?? extractFilename(funcInfo.location.uri));
    const paramTable = buildParamTable(funcInfo, jsdocArgs);

    const value = buildWeiduHoverContent({
        signature: signatureLine,
        langId: LANG_WEIDU_TP2_TOOLTIP,
        filePath,
        description: funcInfo.jsdoc?.desc,
        paramTable: paramTable || undefined,
        deprecated: funcInfo.jsdoc?.deprecated,
    });

    return { contents: { kind: MarkupKind.Markdown, value } };
}

/**
 * Build parameter table markdown with @arg descriptions and type links.
 *
 * Maps FunctionInfo params + JSDoc metadata to VarSection[] and delegates
 * to the shared buildWeiduTable renderer.
 *
 * TODO: Replace markdown table with a DocumentSemanticTokensProvider to get
 * syntax coloring (types, variable names, defaults, descriptions) while
 * keeping markdown features like clickable type links.
 */
function buildParamTable(
    funcInfo: FunctionInfo,
    jsdocArgs: Map<string, { type: string; description?: string; required?: boolean }>,
): string {
    if (!funcInfo.params) {
        return "";
    }

    /** Map INT_VAR/STR_VAR params to VarRow[], merging JSDoc metadata. */
    const mapVarRows = (params: { name: string; defaultValue?: string }[], defaultType: string): readonly VarRow[] =>
        params.map((p) => {
            const jsdoc = jsdocArgs.get(p.name);
            // Hide default value for required params (don't show _required_ - user code
            // can have required params with syntactic defaults that shouldn't be shown)
            const showDefault = !jsdoc?.required && p.defaultValue !== undefined;
            return {
                type: jsdoc?.type ?? defaultType,
                name: p.name,
                ...(showDefault ? { default: p.defaultValue } : {}),
                ...truncateOptionalDesc(jsdoc?.description),
            };
        });

    // Build rets lookup map for @return/@return-array tags
    const retsMap = buildRetsMap(funcInfo.jsdoc?.rets);

    /** Map RET/RET_ARRAY param names to VarRow[], preferring @return info over @param. */
    const mapRetRows = (params: string[]): readonly VarRow[] =>
        params.map((name) => {
            const retInfo = retsMap.get(name);
            const paramInfo = jsdocArgs.get(name);
            return {
                type: retInfo?.type ?? paramInfo?.type ?? "",
                name,
                ...truncateOptionalDesc(retInfo?.description ?? paramInfo?.description),
            };
        });

    const sections: VarSection[] = [
        { label: "INT vars", rows: mapVarRows(funcInfo.params.intVar, "int") },
        { label: "STR vars", rows: mapVarRows(funcInfo.params.strVar, "string") },
        { label: "RET vars", rows: mapRetRows(funcInfo.params.ret) },
        { label: "RET arrays", rows: mapRetRows(funcInfo.params.retArray) },
    ];

    return buildWeiduTable(sections);
}

/**
 * Truncate an optional description and return as a partial VarRow.
 * Returns `{ description }` if non-empty after truncation, empty object otherwise.
 */
function truncateOptionalDesc(desc: string | undefined): { description: string } | Record<string, never> {
    if (!desc) return {};
    const truncated = truncateDesc(desc);
    return truncated ? { description: truncated } : {};
}

/**
 * Truncate description to max length with ellipsis.
 * Preserves markdown links by not cutting through them.
 */
function truncateDesc(desc: string): string {
    if (desc.length <= DESC_MAX_LENGTH) return desc;

    // Find all markdown links and their positions
    const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
    let match;
    const links: { start: number; end: number }[] = [];
    while ((match = linkRegex.exec(desc)) !== null) {
        links.push({ start: match.index, end: match.index + match[0].length });
    }

    // Find a safe truncation point that doesn't cut through a link
    let cutPoint = DESC_MAX_LENGTH - 3;
    for (const link of links) {
        // If cut point is inside a link, move it before the link
        if (cutPoint > link.start && cutPoint < link.end) {
            cutPoint = link.start;
            break;
        }
    }

    if (cutPoint <= 0) {
        // Edge case: first link is too long, just show it without truncation
        return desc;
    }

    return desc.slice(0, cutPoint).trimEnd() + "...";
}

/**
 * Extract filename from a file URI.
 */
function extractFilename(uri: string): string {
    const path = uri.replace(/^file:\/\//, "");
    const lastSlash = path.lastIndexOf("/");
    return lastSlash !== -1 ? path.slice(lastSlash + 1) : path;
}

/**
 * Build hover content from VariableInfo.
 * Exported for use in symbol conversion.
 *
 * @param varInfo Variable definition info
 * @param displayPath Path to show in hover:
 *   - `undefined` = extract filename from URI (default)
 *   - `string` = use provided path
 *   - `null` = skip path block entirely (for local symbols)
 */
export function buildVariableHover(varInfo: VariableInfo, displayPath?: string | null): Hover {
    // Use JSDoc @type if available, otherwise inferred type
    const type = varInfo.jsdoc?.type ?? varInfo.inferredType;
    // Show value only for constant-like names (see tree-utils.ts:looksLikeConstant).
    const isConstant = looksLikeConstant(varInfo.name);
    const showValue = isConstant && varInfo.value !== undefined;
    const signature = showValue ? `${type} ${varInfo.name} = ${varInfo.value}` : `${type} ${varInfo.name}`;

    const filePath = displayPath === null ? undefined : (displayPath ?? extractFilename(varInfo.location.uri));

    const value = buildWeiduHoverContent({
        signature,
        langId: LANG_WEIDU_TP2_TOOLTIP,
        filePath,
        description: varInfo.jsdoc?.desc,
        deprecated: varInfo.jsdoc?.deprecated,
    });

    return { contents: { kind: MarkupKind.Markdown, value } };
}
