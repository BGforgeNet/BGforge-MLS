/**
 * Document symbols and folding ranges for .tra/.msg translation files.
 * Built directly on parseEntries - one DocumentSymbol/FoldingRange per translation entry, keyed
 * by the entry's recorded start/end positions. No tree-sitter parser involved; these files are
 * flat entry lists, not ASTs.
 */

import { type DocumentSymbol, type FoldingRange, SymbolKind } from "vscode-languageserver/node";
import { parseEntries, type TraExt } from "./entries";

const DETAIL_MAX_LENGTH = 60;

/** First line of an entry's source text, truncated for use as a DocumentSymbol detail string. */
function entryDetail(source: string): string {
    const firstLine = source.replaceAll("\r", "").split("\n")[0] ?? "";
    if (firstLine.length > DETAIL_MAX_LENGTH) {
        return firstLine.slice(0, DETAIL_MAX_LENGTH - 3) + "...";
    }
    return firstLine;
}

/** The entry key as it appears in the file: `@N` for tra, `{N}` for msg. */
function entryKeyName(num: string, traExt: TraExt): string {
    return traExt === "tra" ? `@${num}` : `{${num}}`;
}

/** One DocumentSymbol per parsed translation entry. */
export function getTranslationSymbols(text: string, traExt: TraExt): DocumentSymbol[] {
    const entries = parseEntries(text, traExt);
    const symbols: DocumentSymbol[] = [];
    for (const [num, entry] of entries) {
        const name = entryKeyName(num, traExt);
        symbols.push({
            name,
            detail: entryDetail(entry.source),
            kind: SymbolKind.String,
            range: {
                start: { line: entry.line, character: entry.character },
                end: { line: entry.endLine, character: entry.endCharacter },
            },
            selectionRange: {
                start: { line: entry.line, character: entry.character },
                end: { line: entry.line, character: entry.character + name.length },
            },
        });
    }
    return symbols;
}

/** One FoldingRange per translation entry that spans more than one line. */
export function getTranslationFoldingRanges(text: string, traExt: TraExt): FoldingRange[] {
    const entries = parseEntries(text, traExt);
    const ranges: FoldingRange[] = [];
    for (const entry of entries.values()) {
        if (entry.endLine > entry.line) {
            ranges.push({ startLine: entry.line, endLine: entry.endLine });
        }
    }
    return ranges;
}
