/**
 * Factory for format-only language providers.
 *
 * Produces providers that implement FormattingCapability and, for the .tra/.msg translation
 * languages, SymbolCapability and FoldingCapability derived from parseEntries - no navigation,
 * completion, or other capabilities. Use for languages whose LSP surface is this small.
 */

import { conlog } from "../logger";
import type { FormatResult, ProviderContext } from "./capabilities";
import type { LanguageProvider } from "../language-provider";
import { createFullDocumentEdit } from "../shared/format-edits";
import { getTranslationSymbols, getTranslationFoldingRanges } from "../translation/symbols";
import type { TraExt } from "../translation/entries";
import type { FormatOutput } from "@bgforge/format";

/**
 * Creates a minimal LanguageProvider that exposes document formatting and, when `traExt` is
 * given, document symbols and folding ranges over its translation entries.
 *
 * @param id - The language ID string (must match package.json contributes.languages).
 * @param formatFn - Pure function that transforms document text into a FormatOutput.
 * @param traExt - When set, the language is a translation file format ("tra" or "msg") and the
 *   provider also implements SymbolCapability/FoldingCapability over its entries.
 */
export function createFormatOnlyProvider(
    id: string,
    formatFn: (text: string) => FormatOutput,
    traExt?: TraExt,
): LanguageProvider {
    return {
        id,
        async init(_context: ProviderContext): Promise<void> {
            conlog(`${id} provider initialized`);
        },
        format(text: string, _uri: string): FormatResult {
            const out = formatFn(text);
            if (out.warning) return { edits: [], warning: out.warning };
            if (out.text === text) return { edits: [] };
            return { edits: createFullDocumentEdit(text, out.text) };
        },
        ...(traExt
            ? {
                  symbols: (text: string) => getTranslationSymbols(text, traExt),
                  foldingRanges: (text: string) => getTranslationFoldingRanges(text, traExt),
              }
            : {}),
    };
}
