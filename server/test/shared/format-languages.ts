/**
 * The four tree formatters as one table for the comment tests: parse, format, and the content guard's normalizer.
 */

import { beforeAll, expect } from "vitest";
import { initParser as initBaf, getParser as bafParser } from "@bgforge/shared/parsers/weidu-baf";
import { initParser as initSsl, getParser as sslParser } from "@bgforge/shared/parsers/fallout-ssl";
import { initParser as initD, getParser as dParser } from "@bgforge/shared/parsers/weidu-d";
import { initParser as initTp2, getParser as tp2Parser } from "@bgforge/shared/parsers/weidu-tp2";
import {
    formatWeiduBaf,
    formatFalloutSsl,
    formatWeiduD,
    formatWeiduTp2,
    validateFormatting,
    stripCommentsWeidu,
    stripCommentsWeiduD,
    stripCommentsForCompareFalloutSsl,
    type CompareNormalizer,
} from "@bgforge/format";
import type { Node as SyntaxNode } from "web-tree-sitter";

/** Registers the hook that initialises every parser: one after the other, as they share a runtime. */
export function initFormatParsers(): void {
    beforeAll(async () => {
        await initBaf();
        await initSsl();
        await initD();
        await initTp2();
    });
}

export interface Language {
    parse: (text: string) => SyntaxNode;
    format: (root: SyntaxNode) => { text: string; notice?: string; warning?: string };
    normalize: CompareNormalizer;
}

export const BAF: Language = {
    parse: (text) => bafParser().parse(text)!.rootNode,
    format: formatWeiduBaf,
    normalize: stripCommentsWeidu,
};

export const SSL: Language = {
    parse: (text) => sslParser().parse(text)!.rootNode,
    format: formatFalloutSsl,
    normalize: stripCommentsForCompareFalloutSsl,
};

export const D: Language = {
    parse: (text) => dParser().parse(text)!.rootNode,
    format: formatWeiduD,
    normalize: stripCommentsWeiduD,
};

export const TP2: Language = {
    parse: (text) => tp2Parser().parse(text)!.rootNode,
    format: formatWeiduTp2,
    normalize: stripCommentsWeidu,
};

/** The comments of a text in order, with their blanks squeezed, as the guard reads them. */
export function commentsOf(language: Language, text: string): string[] {
    return (language.normalize.omitted?.(text) ?? []).map((comment) => comment.replaceAll(/\s+/g, ""));
}

/** Formats `input`; asserts the result keeps every comment, passes the guard and is stable; returns it. */
export function formatKeepingComments(language: Language, input: string): string {
    const first = language.format(language.parse(input)).text;
    expect(commentsOf(language, first)).toEqual(commentsOf(language, input));
    expect(validateFormatting(input, first, language.normalize)).toBeNull();
    expect(language.format(language.parse(first)).text).toBe(first);
    return first;
}
