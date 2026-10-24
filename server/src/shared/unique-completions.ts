/**
 * The workspace completion list, with identical definitions merged.
 *
 * A name several headers define identically (the same constant value, the same callable signature) is one
 * completion, from the first definition. Definitions that differ (a spell ID with another value per game) each stay,
 * labelled with their header, so the list shows the choice. Callables compare by signature: a parameterised macro's
 * body is not indexed, so two such macros with the same parameters merge whatever their bodies.
 */

import type { CompletionItem } from "vscode-languageserver/node";
import { type IndexedSymbol, isCallableSymbol, SymbolKind } from "../core/symbol";

/** What makes two same-named definitions the same, as far as a completion list can tell. */
function definition(symbol: IndexedSymbol): unknown {
    if (isCallableSymbol(symbol)) {
        const { context, dtype, params, parameters } = symbol.callable;
        return [symbol.kind, context, dtype, params, parameters];
    }
    if (symbol.kind === SymbolKind.Constant) return [symbol.kind, symbol.constant.value];
    if ("variable" in symbol) return [symbol.kind, symbol.variable.type, symbol.variable.value];
    return [symbol.kind];
}

export function uniqueCompletions(symbols: Iterable<IndexedSymbol>): CompletionItem[] {
    const unique = new Map<string, CompletionItem>();
    for (const symbol of symbols) {
        const key = JSON.stringify([symbol.completion.label, definition(symbol)]);
        if (!unique.has(key)) unique.set(key, symbol.completion);
    }
    return [...unique.values()];
}
