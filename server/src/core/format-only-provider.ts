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

/**
 * Creates a minimal LanguageProvider that exposes only document formatting.
 *
 * @param id - The language ID string (must match package.json contributes.languages).
 * @param formatFn - Pure function that transforms document text into TextEdits.
 */
export function createFormatOnlyProvider(
    id: string,
    formatFn: (text: string) => FormatResult,
): LanguageProvider {
    return {
        id,
        async init(_context: ProviderContext): Promise<void> {
            conlog(`${id} provider initialized`);
        },
        format(text: string, _uri: string): FormatResult {
            return formatFn(text);
        },
    };
}
