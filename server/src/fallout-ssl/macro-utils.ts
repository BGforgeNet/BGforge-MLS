/**
 * Shared utilities for macro handling.
 * Used by header-parser.ts and local-symbols.ts for building macro hover, completion, and signature.
 */

import { CompletionItem, CompletionItemKind, ParameterInformation, MarkupKind } from "vscode-languageserver/node";
import * as jsdoc from "../shared/jsdoc";
import { formatSignature } from "../../../shared/signature-format";
import * as signature from "../shared/signature";
import { LANG_FALLOUT_SSL_TOOLTIP } from "../core/languages";
import { buildSignatureBlock } from "../../../shared/tooltip-format";
import { buildTooltipBase } from "./utils";

/**
 * Check if macro name looks like a constant (all uppercase).
 * Examples: MAX_VALUE, LEFT_HAND, HOOK_GAMEMODECHANGE
 */
function isConstantMacro(name: string): boolean {
    return /^[A-Z][A-Z0-9_]+$/.test(name);
}

/**
 * Check if a value is a simple numeric constant.
 * Matches: 123, (123), -123, (-123), 0x1F, (0x1F)
 * Strips inline comments before checking.
 */
function isNumericValue(value: string): boolean {
    // Strip inline comment (// or /* */)
    const stripped = value
        .replace(/\/\/.*$/, "")
        .replace(/\/\*.*\*\//, "")
        .trim();
    return /^\(?-?(?:0x[0-9a-fA-F]+|\d+)\)?$/.test(stripped);
}

/**
 * Parse macro parameters from string.
 * Input: "msg" or "critter, slot" or "(msg)" or "(critter, slot)"
 * Output: ["msg"] or ["critter", "slot"]
 */
export function parseMacroParams(params: string): string[] {
    // Remove parentheses if present
    const cleaned = params.replace(/^\(|\)$/g, "").trim();
    if (!cleaned) return [];

    return cleaned
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

/**
 * Macro data interface (used by both header-parser and tree-sitter).
 */
export interface MacroData {
    name: string;
    params?: string[]; // ["msg"] or ["critter", "slot"] or undefined
    hasParams: boolean;
    body?: string; // Macro body text (if available)
    firstline?: string; // First line of body (for display)
    multiline?: boolean; // Has line continuations
    jsdoc?: jsdoc.JSdoc;
    /** AST node for the define directive (for location extraction). Only present when extracted from tree-sitter. */
    node?: import("web-tree-sitter").Node;
}

/**
 * Build the signature/detail line for a macro.
 * Definition params are the source of truth; JSDoc only enriches with types and return info.
 * Returns: value for numeric constants, signature for others.
 */
function buildMacroSignature(macro: MacroData): string {
    const isNumeric = !macro.hasParams && macro.firstline !== undefined && isNumericValue(macro.firstline);

    if (isNumeric) {
        // Numeric constants just show the value
        return macro.firstline!;
    }

    // Build from definition params, enrich with JSDoc types
    const params =
        macro.hasParams && macro.params
            ? macro.params.map((name, idx) => ({
                  name,
                  type: macro.jsdoc?.args[idx]?.type ?? "var",
              }))
            : [];

    let prefix = "macro ";
    if (macro.jsdoc?.ret) {
        prefix = `${macro.jsdoc.ret.type} `;
    }

    return formatSignature({ name: macro.name, prefix, params });
}

/**
 * Build tooltip content for a macro.
 * Uses shared buildTooltipBase, then appends body for function-like macros without JSDoc.
 * Used by: hover (contents.value), completion (documentation.value).
 */
export function buildMacroTooltip(macro: MacroData, filePath: string): string {
    const sig = buildMacroSignature(macro);

    // If has JSDoc, use base tooltip (signature + path + jsdoc)
    if (macro.jsdoc) {
        return buildTooltipBase(sig, macro.jsdoc, filePath || undefined);
    }

    // No JSDoc - use base tooltip without jsdoc, then maybe append body
    let markdown = buildTooltipBase(sig, null, filePath || undefined);

    // For non-constant, non-numeric, non-multiline macros, show body as fallback
    const isConstant = !macro.hasParams && isConstantMacro(macro.name);
    const isNumeric = !macro.hasParams && macro.firstline !== undefined && isNumericValue(macro.firstline);
    if (!isConstant && !isNumeric && !macro.multiline && macro.firstline) {
        markdown += "\n" + buildSignatureBlock(macro.firstline, LANG_FALLOUT_SSL_TOOLTIP);
    }

    return markdown;
}

/** Parameter from the actual definition (AST or macro). */
interface DefinitionParam {
    name: string;
    defaultValue?: string;
}

/**
 * Build signature help from definition params, enriched with optional JSDoc.
 * Definition params are always the source of truth; JSDoc only adds types and descriptions.
 */
export function buildSignatureHelp(
    name: string,
    definitionParams: readonly DefinitionParam[],
    jsd: jsdoc.JSdoc | null | undefined,
    uri: string,
): signature.SigInfoEx {
    const parameters: ParameterInformation[] = definitionParams.map((p, idx) => {
        const arg = jsd?.args[idx];
        let label = arg?.type ? `${arg.type} ${p.name}` : `var ${p.name}`;
        if (p.defaultValue) {
            label += ` = ${p.defaultValue}`;
        }
        const info: ParameterInformation = { label };
        if (arg?.type || arg?.description) {
            const typePrefix = arg.type ? `${arg.type} ` : "";
            let doc = buildSignatureBlock(`${typePrefix}${p.name}`, LANG_FALLOUT_SSL_TOOLTIP);
            if (arg.description) {
                doc += "\n" + arg.description;
            }
            info.documentation = { kind: "markdown", value: doc };
        }
        return info;
    });

    let sigLabel = name + "(" + parameters.map((p) => p.label).join(", ") + ")";
    if (jsd?.ret) {
        sigLabel = `${jsd.ret.type} ${sigLabel}`;
    }

    const sig: signature.SigInfoEx = { label: sigLabel, uri, parameters };

    if (jsd?.desc) {
        sig.documentation = {
            kind: "markdown",
            value: "\n---\n" + jsd.desc,
        };
    }

    return sig;
}

/**
 * Build completion item for a macro.
 * Used by header-parser.ts and local-symbols.ts.
 */
export function buildMacroCompletion(macro: MacroData, _uri: string, filePath: string): CompletionItem {
    const isConstant = !macro.hasParams && isConstantMacro(macro.name);
    const markdownValue = buildMacroTooltip(macro, filePath);

    const kind = isConstant
        ? CompletionItemKind.Constant
        : macro.hasParams
          ? CompletionItemKind.Function
          : CompletionItemKind.Snippet;

    const item: CompletionItem = {
        label: macro.name,
        kind,
        documentation: { kind: MarkupKind.Markdown, value: markdownValue },
    };

    if (filePath) {
        item.labelDetails = { description: filePath };
    }

    if (macro.jsdoc?.deprecated !== undefined) {
        const COMPLETION_TAG_deprecated = 1;
        item.tags = [COMPLETION_TAG_deprecated];
    }

    return item;
}
