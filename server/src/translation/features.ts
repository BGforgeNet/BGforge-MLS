/**
 * LSP feature surface for translation references: hover, definition, find-references, and inlay
 * hints. Reads the shared `TranslationState` (entry map, consumer index) built by the loader but
 * never mutates it, except for `resolveEntry`'s callers which may trigger a reload elsewhere.
 */

import * as fs from "fs";
import * as path from "path";
import {
    type Hover,
    type InlayHint,
    type Location,
    type MarkupContent,
    type Range,
    MarkupKind,
} from "vscode-languageserver/node";
import { conlog } from "../logger";
import { EXT_TBAF, EXT_TD, EXT_TSSL, LANG_TYPESCRIPT, MSG_LANGUAGES, TRA_LANGUAGES } from "../core/languages";
import {
    REGEX_MSG_HOVER,
    REGEX_MSG_INLAY,
    REGEX_MSG_INLAY_FLOATER_RAND,
    regexMsgRef,
    REGEX_TRANSPILER_TRA_HOVER,
    REGEX_TRANSPILER_TRA_INLAY,
    REGEX_TRA_COMMENT,
    REGEX_TRA_COMMENT_EXT,
    REGEX_TRA_HOVER,
    REGEX_TRA_INLAY,
    regexTraRef,
} from "../core/patterns";
import { pathToUri } from "../uri-utils";
import { decodeFileBytes } from "./encoding";
import { getLineKey, type TraEntries, type TraEntry, type TraExt } from "./entries";
import { resolveAbsolutePath } from "./loader";
import type { TranslationState } from "./state";

/** Languages that can have translation references */
export const translatableLanguages: ReadonlySet<string> = new Set([...TRA_LANGUAGES, ...MSG_LANGUAGES]);

/**
 * Check if a symbol is a translation reference for the given language.
 * For typescript files, also checks file extension to determine format.
 */
export function isTraRef(word: string, langId: string, filePath?: string): boolean {
    // For typescript, determine pattern by file extension
    if (langId === LANG_TYPESCRIPT && filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === EXT_TSSL) {
            return REGEX_MSG_HOVER.test(word);
        }
        if (ext === EXT_TBAF || ext === EXT_TD) {
            return REGEX_TRANSPILER_TRA_HOVER.test(word);
        }
        // Regular .ts file - check all patterns, format determined by @tra comment
        return REGEX_MSG_HOVER.test(word) || REGEX_TRANSPILER_TRA_HOVER.test(word);
    }

    // For other languages, check the language arrays
    if (TRA_LANGUAGES.includes(langId) && word.match(REGEX_TRA_HOVER)) {
        return true;
    }
    if (MSG_LANGUAGES.includes(langId) && word.match(REGEX_MSG_HOVER)) {
        return true;
    }
    return false;
}

/** Result of resolving a translation reference to its entry */
type ResolveResult =
    | { kind: "entry"; entry: TraEntry; fileKey: string }
    | { kind: "file-missing"; fileKey: string }
    | { kind: "entry-missing"; fileKey: string; lineKey: string }
    | null;

/**
 * Determine translation file extension based on language and file path.
 * For typescript files, checks .tssl (msg) vs .tbaf (tra) extension.
 * For regular .ts files, infers from @tra comment or loaded translation files.
 */
export function getTraExt(
    state: TranslationState,
    langId: string,
    filePath?: string,
    text?: string,
): TraExt | undefined {
    // For typescript, determine by file extension
    if (langId === LANG_TYPESCRIPT && filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === EXT_TSSL) {
            return "msg";
        }
        if (ext === EXT_TBAF || ext === EXT_TD) {
            return "tra";
        }
        // Regular .ts file - infer from @tra comment first
        if (text) {
            const traFileExt = getTraFileExtFromComment(text);
            if (traFileExt) {
                return traFileExt;
            }
        }
        // No @tra comment - infer from loaded translation files (msg and tra are never mixed)
        for (const key of state.data.keys()) {
            if (key.endsWith(".msg")) return "msg";
            if (key.endsWith(".tra")) return "tra";
        }
        return undefined;
    }

    // For other languages, check the language arrays
    // Check MSG_LANGUAGES first since it's more specific
    if (MSG_LANGUAGES.includes(langId)) {
        return "msg";
    }
    if (TRA_LANGUAGES.includes(langId)) {
        return "tra";
    }
    return undefined;
}

/**
 * Extract translation file extension from @tra comment.
 * Returns "msg" or "tra" based on the referenced file extension.
 */
function getTraFileExtFromComment(text: string): TraExt | undefined {
    const firstLine = text.split(/\r?\n/g)[0];
    if (!firstLine) return undefined;

    const match = REGEX_TRA_COMMENT_EXT.exec(firstLine);
    const captured = match?.[1];
    if (captured === "tra" || captured === "msg") {
        return captured;
    }
    return undefined;
}

/**
 * Resolve the translation file key for a source file.
 * Checks for @tra comment first, falls back to auto-matching by basename.
 */
export function resolveTraFileKey(
    state: TranslationState,
    filePath: string,
    fullText: string,
    langId: string,
): string | undefined {
    const firstLine = fullText.split(/\r?\n/g)[0];
    if (!firstLine) return undefined;

    const match = REGEX_TRA_COMMENT.exec(firstLine);
    if (match && match[1]) {
        return match[1];
    }
    if (state.settings.auto_tra) {
        const traExt = getTraExt(state, langId, filePath, fullText);
        if (!traExt) return undefined;
        const basename = path.parse(filePath).name;
        return `${basename}.${traExt}`;
    }
    return undefined;
}

/**
 * Resolve a translation reference to its entry, file key, and line key.
 * Shared by lookupHover and lookupDefinition to avoid duplicating resolution logic.
 */
function resolveEntry(
    state: TranslationState,
    word: string,
    text: string,
    relPath: string,
    langId: string,
): ResolveResult {
    const ext = getTraExt(state, langId, relPath, text);
    if (!ext) return null;

    const fileKey = resolveTraFileKey(state, relPath, text, langId);
    if (!fileKey) return null;

    const traFile = state.data.get(fileKey);
    if (!traFile) {
        return { kind: "file-missing", fileKey };
    }

    const lineKey = getLineKey(word, ext);
    if (!lineKey) {
        conlog(`Translation: line key not found for ${word}`);
        return null;
    }

    const traEntry = traFile.get(lineKey);
    if (!traEntry) {
        return { kind: "entry-missing", fileKey, lineKey };
    }

    return { kind: "entry", entry: traEntry, fileKey };
}

export function lookupHover(
    state: TranslationState,
    word: string,
    text: string,
    relPath: string,
    langId: string,
): Hover | null {
    const result = resolveEntry(state, word, text, relPath, langId);
    if (!result) return null;

    if (result.kind === "file-missing") {
        return {
            contents: {
                kind: "plaintext",
                value: `Error: file ${result.fileKey} not found.`,
            },
        };
    }
    if (result.kind === "entry-missing") {
        return {
            contents: {
                kind: "plaintext",
                value: `Error: entry ${result.lineKey} not found in ${result.fileKey}.`,
            },
        };
    }

    return result.entry.hover;
}

export function lookupDefinition(
    state: TranslationState,
    word: string,
    text: string,
    relPath: string,
    langId: string,
): Location | null {
    const result = resolveEntry(state, word, text, relPath, langId);
    if (!result || result.kind !== "entry") return null;

    const absolutePath = resolveAbsolutePath(state, result.fileKey);
    if (!absolutePath) return null;

    return {
        uri: pathToUri(absolutePath),
        range: {
            start: { line: result.entry.line, character: result.entry.character },
            end: { line: result.entry.line, character: result.entry.character },
        },
    };
}

function getHintValue(
    traEntries: TraEntries,
    traFileKey: string,
    lineKey: string,
): { label: string; tooltip?: string | MarkupContent } {
    const traEntry = traEntries.get(lineKey);
    if (traEntry === undefined) {
        return { label: `/* Error: no such string ${traFileKey}:${lineKey} */`, tooltip: "" };
    }
    const tooltip = traEntry.inlayTooltip
        ? { kind: MarkupKind.Markdown, value: "```bgforge-mls-string\n" + traEntry.inlayTooltip + "\n```" }
        : undefined;
    return {
        label: traEntry.inlay,
        tooltip,
    };
}

export function generateInlayHints(
    traFileKey: string,
    traEntries: TraEntries,
    traExt: TraExt,
    text: string,
    range: Range,
    filePath: string,
): InlayHint[] {
    const hints: InlayHint[] = [];

    let lines = text.split("\n");
    lines = lines.slice(range.start.line, range.end.line);

    const pushHint = (line: number, character: number, lineKey: string): void => {
        const hintValue = getHintValue(traEntries, traFileKey, lineKey);
        hints.push({
            position: { line, character },
            label: hintValue.label,
            tooltip: hintValue.tooltip,
            kind: 2,
            paddingLeft: true,
            paddingRight: true,
        });
    };

    // Determine regex based on file type
    // keyIndex: which capture group contains the translation ID
    let regex: RegExp;
    let keyIndex: number;
    if (traExt === "msg") {
        lines.forEach((lineText, i) => {
            const lineNumber = range.start.line + i;
            const lineHints: Array<{ character: number; lineKey: string }> = [];

            for (const match of lineText.matchAll(REGEX_MSG_INLAY)) {
                const lineKey = match[2];
                if (!lineKey) {
                    continue;
                }
                lineHints.push({
                    character: match.index + match[0].length,
                    lineKey,
                });
            }

            for (const match of lineText.matchAll(REGEX_MSG_INLAY_FLOATER_RAND)) {
                const secondKey = match[2];
                if (!secondKey) {
                    continue;
                }
                const secondStart = match[0].lastIndexOf(secondKey);
                lineHints.push({
                    character: match.index + secondStart + secondKey.length,
                    lineKey: secondKey,
                });
            }

            lineHints.sort((a, b) => a.character - b.character);
            for (const lineHint of lineHints) {
                pushHint(lineNumber, lineHint.character, lineHint.lineKey);
            }
        });
        return hints;
    } else {
        // TypeScript transpiler files (.tbaf, .td, .ts) use tra(123) syntax.
        // Native WeiDU files (baf, d, tp2) use @123 syntax.
        const ext = path.extname(filePath).toLowerCase();
        if (ext === EXT_TBAF || ext === EXT_TD || ext === ".ts") {
            regex = REGEX_TRANSPILER_TRA_INLAY;
        } else {
            regex = REGEX_TRA_INLAY;
        }
        keyIndex = 1;
    }

    // NOTE: This works because we split by newlines first, so each line element is
    // guaranteed single-line. If future patterns need multiline matching, this would
    // need byte-offset-to-position conversion like in weidu-tp2/rename.ts.
    lines.forEach((l, i) => {
        const matches = l.matchAll(regex);
        for (const m of matches) {
            const char_end = m.index + m[0].length;
            const lineKey = m[keyIndex];
            if (!lineKey) continue;
            pushHint(range.start.line + i, char_end, lineKey);
        }
    });
    return hints;
}

/**
 * Scan a file's text for references to a specific entry number.
 * Returns line/character positions for each match.
 */
function scanFileForReferences(
    text: string,
    entryNum: string,
    traExt: TraExt,
): Array<{ line: number; character: number; endCharacter: number }> {
    const results: Array<{ line: number; character: number; endCharacter: number }> = [];
    const lines = text.split("\n");

    // MSG references (mstr(num), NOption(num), floater_rand(x, num)) use a
    // combined regex covering both first-arg and floater_rand second-arg
    // patterns; TRA references use a separate pattern.
    const regex = traExt === "tra" ? regexTraRef(entryNum) : regexMsgRef(entryNum);
    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i]!;
        for (const match of lineText.matchAll(regex)) {
            results.push({
                line: i,
                character: match.index,
                endCharacter: match.index + match[0].length,
            });
        }
    }

    return results;
}

/**
 * Find all references to a specific entry number across consumer files.
 * Consumer files are read concurrently via fs.promises.readFile to avoid
 * blocking the event loop on large mod projects.
 */
export async function findReferencesInConsumers(
    state: TranslationState,
    traFileKey: string,
    entryNum: string,
    traExt: TraExt,
    traAbsPath: string,
    includeDeclaration: boolean,
): Promise<Location[]> {
    const locations: Location[] = [];

    // Optionally include the declaration itself
    if (includeDeclaration) {
        const entry = state.data.get(traFileKey)?.get(entryNum);
        if (entry) {
            locations.push({
                uri: pathToUri(traAbsPath),
                range: {
                    start: { line: entry.line, character: entry.character },
                    end: { line: entry.endLine, character: entry.endCharacter },
                },
            });
        }
    }

    const consumerFiles = state.consumers.get(traFileKey);
    if (!consumerFiles) return locations;

    const reads = await Promise.all(
        [...consumerFiles].map(async (absPath) => {
            try {
                const raw = await fs.promises.readFile(absPath);
                const { text } = decodeFileBytes(raw);
                return { absPath, text };
            } catch {
                // eslint-disable-next-line unicorn/no-useless-undefined -- TS noImplicitReturns flags the implicit-undefined path
                return undefined;
            }
        }),
    );

    for (const read of reads) {
        if (!read) continue;
        const { absPath, text } = read;
        const refs = scanFileForReferences(text, entryNum, traExt);
        const fileUri = pathToUri(absPath);
        for (const ref of refs) {
            locations.push({
                uri: fileUri,
                range: {
                    start: { line: ref.line, character: ref.character },
                    end: { line: ref.line, character: ref.endCharacter },
                },
            });
        }
    }

    return locations;
}
