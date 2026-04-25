/**
 * Infinity Engine 2DA language provider.
 * Provides semantic token (zebra-grid) highlighting and column-aligned formatting
 * for .2da table files.
 */

import { conlog } from "../common";
import { LANG_INFINITY_2DA } from "../core/languages";
import type { FormatResult } from "../core/capabilities";
import type {
    LanguageProvider,
    ProviderBase,
    ProviderContext,
    SemanticTokenCapability,
    FormattingCapability,
} from "../language-provider";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";
import { createFullDocumentEdit } from "../shared/format-edits";
import { getSemanticTokenSpans } from "./semantic-tokens";
import { format2da } from "@bgforge/format";

class Infinity2daProvider implements ProviderBase, SemanticTokenCapability, FormattingCapability {
    readonly id = LANG_INFINITY_2DA;

    async init(_context: ProviderContext): Promise<void> {
        conlog("Infinity 2DA provider initialized");
    }

    semanticTokens(text: string, _uri: string): SemanticTokenSpan[] {
        return getSemanticTokenSpans(text);
    }

    format(text: string, _uri: string): FormatResult {
        const out = format2da(text);
        if (out.warning) return { edits: [], warning: out.warning };
        if (out.text === text) return { edits: [] };
        return { edits: createFullDocumentEdit(text, out.text) };
    }
}

export const infinity2daProvider: LanguageProvider = new Infinity2daProvider();
