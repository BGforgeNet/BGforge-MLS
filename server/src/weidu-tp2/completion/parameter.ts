/**
 * Parameter completion for WeiDU TP2 function calls.
 * Provides completions for function parameters based on function definitions.
 */

import { CompletionItemKind, InsertTextFormat, MarkupKind } from "vscode-languageserver/node";
import {
    CallableContext,
    isCallableSymbol,
    type CallableParam,
    type CallableSymbol,
    type IndexedSymbol,
} from "../../core/symbol";
import type { Symbols } from "../../core/symbol-index";
import { CompletionCategory, ParamSection, type FuncParamsContext, type Tp2CompletionItem } from "./types";
import { LANG_WEIDU_TP2_TOOLTIP } from "../../core/languages";

/**
 * Generate parameter completions for a function call.
 * Looks up the function definition and returns completions for unused parameters.
 */
/**
 * The definition whose parameters a call takes, when several share its name: one in the file being edited first,
 * then one of the call's own kind (a patch function for LPF, an action function for LAF, a dimorphic one for
 * either), then any, each in the index's scope order.
 */
function definitionFor(
    context: FuncParamsContext,
    symbols: Symbols | undefined,
    local: ReadonlyMap<string, IndexedSymbol> | undefined,
    uri: string | undefined,
): CallableSymbol | undefined {
    const candidates = [local?.get(context.functionName), ...(symbols?.lookupAll(context.functionName, { uri }) ?? [])]
        .filter((symbol): symbol is CallableSymbol => symbol !== undefined && isCallableSymbol(symbol))
        .filter((symbol) => symbol.callable.params !== undefined);
    const ofKind = (symbol: CallableSymbol): boolean =>
        symbol.callable.context === context.callContext || symbol.callable.context === CallableContext.Dimorphic;
    const own = candidates.find((symbol) => symbol.location?.uri === uri && ofKind(symbol));
    return own ?? candidates.find((symbol) => ofKind(symbol)) ?? candidates[0];
}

export function getParamCompletions(
    context: FuncParamsContext,
    symbols?: Symbols,
    local?: ReadonlyMap<string, IndexedSymbol>,
    uri?: string,
): Tp2CompletionItem[] {
    const { paramSection, usedParams } = context;

    // A macro has no parameter list; an unknown function has none to offer
    const params = definitionFor(context, symbols, local, uri)?.callable.params;
    if (!params) {
        return [];
    }
    const usedSet = new Set(usedParams);
    const completions: Tp2CompletionItem[] = [];

    // Get the appropriate param list based on section
    // CallableParam already has JSDoc data merged (type, description, required)
    switch (paramSection) {
        case ParamSection.IntVar: {
            for (const param of params.intVar) {
                if (!usedSet.has(param.name)) {
                    completions.push(createParamCompletion(param));
                }
            }
            break;
        }
        case ParamSection.StrVar: {
            for (const param of params.strVar) {
                if (!usedSet.has(param.name)) {
                    completions.push(createParamCompletion(param));
                }
            }
            break;
        }
        case ParamSection.Ret: {
            for (const name of params.ret) {
                if (!usedSet.has(name)) {
                    // RET params are just names - no type/default info available
                    completions.push(createParamCompletion({ name, type: "any" }));
                }
            }
            break;
        }
        case ParamSection.RetArray: {
            for (const name of params.retArray) {
                if (!usedSet.has(name)) {
                    completions.push(createParamCompletion({ name, type: "array" }));
                }
            }
            break;
        }
    }

    return completions;
}

/**
 * Create a parameter completion item with documentation.
 * Format: "type name = default" for optional params, "type name" for required.
 * Uses CallableParam which already has JSDoc data merged (type, description, required).
 */
function createParamCompletion(param: CallableParam): Tp2CompletionItem {
    const { name, type, defaultValue, description, required } = param;

    // Build signature line - hide default value for required params
    const showDefault = defaultValue !== undefined && !required;
    const signature = showDefault ? `${type ?? ""} ${name} = ${defaultValue}` : `${type ?? ""} ${name}`;

    // Build markdown documentation
    const langId = LANG_WEIDU_TP2_TOOLTIP;
    const docParts = [`\`\`\`${langId}`, signature, "```"];

    if (description) {
        docParts.push("", description);
    }

    const item: Tp2CompletionItem = {
        label: name,
        kind: CompletionItemKind.Field,
        insertText: `${name} = `,
        insertTextFormat: InsertTextFormat.PlainText,
        documentation: {
            kind: MarkupKind.Markdown,
            value: docParts.join("\n"),
        },
        category: CompletionCategory.FuncVarKeyword,
    };

    return item;
}
