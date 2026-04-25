/**
 * Factory for format-only language providers.
 *
 * Produces providers that implement only FormattingCapability — no symbols,
 * navigation, completion, or other capabilities. Use for languages whose sole
 * LSP feature is document formatting.
 */

import { conlog } from "../common";
import type { FormatResult, ProviderContext } from "./capabilities";
import type { LanguageProvider } from "../language-provider";
import { createFullDocumentEdit } from "../shared/format-edits";
import type { FormatOutput } from "@bgforge/format";

/**
 * Creates a minimal LanguageProvider that exposes only document formatting.
 *
 * @param id - The language ID string (must match package.json contributes.languages).
 * @param formatFn - Pure function that transforms document text into a FormatOutput.
 */
export function createFormatOnlyProvider(id: string, formatFn: (text: string) => FormatOutput): LanguageProvider {
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
    };
}
