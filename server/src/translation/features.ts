/**
 * LSP feature surface for translation references: hover, definition, find-references, and inlay
 * hints. Reads the shared `TranslationState` (entry map, consumer index) built by the loader but
 * never mutates it, except for `resolveEntry`'s callers which may trigger a reload elsewhere.
 */

import * as fs from "fs";
import * as path from "path";
import { type Hover, type InlayHint, type Location, type Range, MarkupKind } from "vscode-languageserver/node";
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

/** One message wording for a reference to an entry absent from the resolved translation file. */
export function missingEntryMessage(entryNum: string, fileKey: string): string {
    return `No translation entry ${entryNum} in ${fileKey}.`;
}

/** One message wording for a translation file that resolves but is not loaded (surfaced on hover). */
function missingFileMessage(fileKey: string): string {
    return `Translation file ${fileKey} not found.`;
}

/** Per-document translation resolution - the single oracle shared by hover, inlay, and the diagnostic. */
type TraResolution =
    | { kind: "loaded"; traExt: TraExt; fileKey: string; traFile: TraEntries }
    | { kind: "file-missing"; fileKey: string }
    | null;

/**
 * Resolve the translation file for a document once: its extension, key, and loaded entry map. `null` when
 * the document has no translation format/file for it; `file-missing` when a file resolves but is not
 * loaded. Callers apply their own policy per case (the diagnostic stays silent unless `loaded`).
 */
function resolveTraContext(state: TranslationState, filePath: string, text: string, langId: string): TraResolution {
    const traExt = getTraExt(state, langId, filePath, text);
    if (!traExt) return null;

    const fileKey = resolveTraFileKey(state, filePath, text, langId);
    if (!fileKey) return null;

    const traFile = state.data.get(fileKey);
    if (!traFile) return { kind: "file-missing", fileKey };

    return { kind: "loaded", traExt, fileKey, traFile };
}

/**
 * Resolve a single reference (a `word` under the cursor) to its entry/file/line, on top of the shared
 * document context. Used by lookupHover and lookupDefinition.
 */
function resolveEntry(
    state: TranslationState,
    word: string,
    text: string,
    relPath: string,
    langId: string,
): ResolveResult {
    const ctx = resolveTraContext(state, relPath, text, langId);
    if (!ctx) return null;
    if (ctx.kind === "file-missing") return { kind: "file-missing", fileKey: ctx.fileKey };

    const lineKey = getLineKey(word, ctx.traExt);
    if (!lineKey) {
        conlog(`Translation: line key not found for ${word}`);
        return null;
    }

    const traEntry = ctx.traFile.get(lineKey);
    if (!traEntry) {
        return { kind: "entry-missing", fileKey: ctx.fileKey, lineKey };
    }

    return { kind: "entry", entry: traEntry, fileKey: ctx.fileKey };
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
        // No diagnostic is emitted for a missing file (that would flag every reference), so the hover is
        // the only place to explain why nothing resolves.
        return { contents: { kind: "plaintext", value: missingFileMessage(result.fileKey) } };
    }
    if (result.kind === "entry-missing") {
        // Defer to the diagnostic: VS Code already renders it in the hover popup, so returning a message
        // here would show the same line twice.
        return null;
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

/**
 * A translation reference found on one line: the entry number and the source-text span of the token.
 * The single scanner both inlay hints and the unresolved-reference diagnostic project from, so both agree
 * on exactly which references exist. The set of recognized reference patterns is the single source of
 * truth in core/patterns.ts; this only maps each match to (entryNum, start, end). Sorted by start so
 * per-line ordering is positional for both consumers.
 *
 * Works because callers split by newline first, so each line is single-line. Multiline patterns would
 * need byte-offset-to-position conversion like in weidu-tp2/rename.ts.
 */
interface LineRef {
    entryNum: string;
    start: number;
    end: number;
}

function scanLineRefs(lineText: string, traExt: TraExt, filePath: string): LineRef[] {
    const refs: LineRef[] = [];
    if (traExt === "msg") {
        for (const m of lineText.matchAll(REGEX_MSG_INLAY)) {
            const entryNum = m[2];
            if (!entryNum) continue;
            refs.push({ entryNum, start: m.index, end: m.index + m[0].length });
        }
        // floater_rand's second argument; the first is already covered by REGEX_MSG_INLAY above.
        for (const m of lineText.matchAll(REGEX_MSG_INLAY_FLOATER_RAND)) {
            const entryNum = m[2];
            if (!entryNum) continue;
            const secondStart = m.index + m[0].lastIndexOf(entryNum);
            refs.push({ entryNum, start: secondStart, end: secondStart + entryNum.length });
        }
    } else {
        // TypeScript transpiler files (.tbaf, .td, .ts) use tra(123); native WeiDU files use @123.
        const ext = path.extname(filePath).toLowerCase();
        const regex =
            ext === EXT_TBAF || ext === EXT_TD || ext === ".ts" ? REGEX_TRANSPILER_TRA_INLAY : REGEX_TRA_INLAY;
        for (const m of lineText.matchAll(regex)) {
            const entryNum = m[1];
            if (!entryNum) continue;
            refs.push({ entryNum, start: m.index, end: m.index + m[0].length });
        }
    }
    refs.sort((a, b) => a.start - b.start);
    return refs;
}

export function generateInlayHints(
    state: TranslationState,
    filePath: string,
    text: string,
    langId: string,
    range: Range,
): InlayHint[] {
    const ctx = resolveTraContext(state, filePath, text, langId);
    if (ctx?.kind !== "loaded") return [];

    const hints: InlayHint[] = [];
    const lines = blankComments(text).split("\n");
    const lastLine = Math.min(range.end.line, lines.length);
    for (let line = range.start.line; line < lastLine; line++) {
        for (const ref of scanLineRefs(lines[line]!, ctx.traExt, filePath)) {
            const entry = ctx.traFile.get(ref.entryNum);
            // A missing reference shows no preview - the diagnostic surfaces it instead (one signal, one place).
            if (!entry) continue;
            hints.push({
                position: { line, character: ref.end },
                label: entry.inlay,
                tooltip: entry.inlayTooltip
                    ? { kind: MarkupKind.Markdown, value: "```bgforge-mls-string\n" + entry.inlayTooltip + "\n```" }
                    : undefined,
                kind: 2,
                paddingLeft: true,
                paddingRight: true,
            });
        }
    }
    return hints;
}

/** An unresolved translation reference: its source-text range and the entry/file it failed to resolve to. */
export interface UnresolvedRef {
    range: Range;
    entryNum: string;
    fileKey: string;
}

/**
 * Blank out line and block comment content, replacing each comment character with a space (newlines
 * kept) so every other character keeps its exact line/column - reference ranges stay accurate. Used so
 * the diagnostic never flags a commented-out reference (commenting dialog with a line comment is
 * ubiquitous in WeiDU mods). Not string-aware: a line-comment marker inside a `~...~` string is treated
 * as a comment, acceptable here since a @N inside a string is not a real reference either.
 */
function blankComments(text: string): string {
    const out = [...text];
    let state: "code" | "line" | "block" = "code";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (state === "code") {
            if (c === "/" && next === "/") {
                state = "line";
                out[i] = " ";
                out[i + 1] = " ";
                i++;
            } else if (c === "/" && next === "*") {
                state = "block";
                out[i] = " ";
                out[i + 1] = " ";
                i++;
            }
        } else if (state === "line") {
            if (c === "\n") state = "code";
            else out[i] = " ";
        } else {
            if (c === "*" && next === "/") {
                out[i] = " ";
                out[i + 1] = " ";
                state = "code";
                i++;
            } else if (c !== "\n") {
                out[i] = " ";
            }
        }
    }
    return out.join("");
}

/**
 * Scan a consumer document for translation references whose entry is absent from the RESOLVED
 * translation file. Returns [] when no translation file resolves for the document (unconfigured, or the
 * file for this document is not loaded) - so a project with no translations never flags every
 * reference. Only the "file loaded, entry N missing" case yields results. References inside comments are
 * ignored (blanked before scanning).
 */
export function collectUnresolvedRefs(
    state: TranslationState,
    text: string,
    filePath: string,
    langId: string,
): UnresolvedRef[] {
    // Only the "file loaded" case yields results: `null`/`file-missing` -> stay silent (never flag every
    // reference in a project without translations).
    const ctx = resolveTraContext(state, filePath, text, langId);
    if (ctx?.kind !== "loaded") return [];

    const unresolved: UnresolvedRef[] = [];
    blankComments(text)
        .split("\n")
        .forEach((lineText, line) => {
            for (const ref of scanLineRefs(lineText, ctx.traExt, filePath)) {
                if (!ctx.traFile.has(ref.entryNum)) {
                    unresolved.push({
                        range: { start: { line, character: ref.start }, end: { line, character: ref.end } },
                        entryNum: ref.entryNum,
                        fileKey: ctx.fileKey,
                    });
                }
            }
        });
    return unresolved;
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
