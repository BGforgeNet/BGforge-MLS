/**
 * Fallout Worldmap TXT language provider.
 * Simple provider for worldmap.txt files with static completion and hover only.
 *
 * Uses unified Symbols storage (same as other providers).
 */

import type { CompletionItem } from "vscode-languageserver/node";
import { conlog } from "../common";
import { LANG_FALLOUT_WORLDMAP_TXT } from "../core/languages";
import type { IndexedSymbol } from "../core/symbol";
import { Symbols } from "../core/symbol-index";
import { loadStaticSymbols } from "../core/static-loader";
import type {
    LanguageProvider,
    ProviderContext,
    ProviderBase,
    CompletionCapability,
    DataCapability,
} from "../language-provider";
import { resolveSymbolStatic, getStaticCompletions } from "../shared/provider-helpers";

class FalloutWorldmapProvider implements ProviderBase, CompletionCapability, DataCapability {
    readonly id = LANG_FALLOUT_WORLDMAP_TXT;
    private symbolStore: Symbols | undefined;

    async init(_context: ProviderContext): Promise<void> {
        this.symbolStore = new Symbols();
        const staticSymbols = loadStaticSymbols(LANG_FALLOUT_WORLDMAP_TXT);
        this.symbolStore.loadStatic(staticSymbols);

        conlog(`Fallout Worldmap provider initialized with ${staticSymbols.length} static symbols`);
    }

    // Worldmap is a simple key-value config format, no user-defined constructs.
    // Symbol lookup is static-only (YAML data: worldmap field names).
    resolveSymbol(name: string, _text: string, _uri: string): IndexedSymbol | undefined {
        return resolveSymbolStatic(name, this.symbolStore);
    }

    getCompletions(_uri: string): CompletionItem[] {
        return getStaticCompletions(this.symbolStore);
    }
}

export const falloutWorldmapProvider: LanguageProvider = new FalloutWorldmapProvider();
