/**
 * Translation service for .tra and .msg files.
 * Self-contained service that loads translations and provides hover, inlay hints,
 * go-to-definition, and find-references for translation references.
 * Can be used by any consumer (providers, TSSL/TBAF handlers, etc.)
 */

import PromisePool from "@supercharge/promise-pool";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Hover, InlayHint, Location, MarkupContent, MarkupKind, Position, Range } from "vscode-languageserver/node";
import { conlog, findFiles, getRelPath, isDirectory, isSubpath, pathToUri } from "./common";
import {
    CONSUMER_EXTENSIONS_MSG,
    CONSUMER_EXTENSIONS_TRA,
    EXT_TBAF,
    EXT_TD,
    EXT_TSSL,
    LANG_FALLOUT_SSL,
    LANG_TYPESCRIPT,
    MSG_LANGUAGES,
    TRA_LANGUAGES,
    TRANSLATION_FILE_LANGUAGES,
} from "./core/languages";
import {
    REGEX_MSG_HOVER,
    REGEX_MSG_INLAY,
    REGEX_MSG_INLAY_FLOATER_RAND,
    REGEX_MSG_REF,
    REGEX_TRANSPILER_TRA_HOVER,
    REGEX_TRANSPILER_TRA_INLAY,
    REGEX_TRA_COMMENT,
    REGEX_TRA_COMMENT_EXT,
    REGEX_TRA_HOVER,
    REGEX_TRA_INLAY,
    REGEX_TRA_REF,
} from "./core/patterns";
import type { ProjectTraSettings } from "./settings";

interface TraEntry {
    source: string;
    hover: Hover;
    inlay: string;
    inlayTooltip?: string;
    /** 0-based line number of this entry in the translation file */
    line: number;
    /** 0-based character offset within the line */
    character: number;
    /** 0-based end line of the full match (accounts for multiline values) */
    endLine: number;
    /** 0-based end character offset within the end line */
    endCharacter: number;
}

/** Single file: index => entry */
interface TraEntries extends Map<string, TraEntry> {}
/** Relative file: path => entries */
interface TraData extends Map<string, TraEntries> {}

type TraExt = "msg" | "tra";

/** Languages that contain translation strings (msg/tra files) */
const languages = TRANSLATION_FILE_LANGUAGES;

/** Languages that can have translation references */
const translatableLanguages = [...TRA_LANGUAGES, ...MSG_LANGUAGES];

const extensions: Array<TraExt> = ["msg", "tra"];

/** Max concurrent file reads when loading translation files. */
const SCAN_CONCURRENCY = 4;

/**
 * Check if a symbol is a translation reference for the given language.
 * For typescript files, also checks file extension to determine format.
 */
function isTraRef(word: string, langId: string, filePath?: string): boolean {
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

export class Translation {
    private directory: string;
    private data: TraData;
    /** Reverse index: traFileKey → set of absolute consumer file paths */
    private consumers: Map<string, Set<string>>;
    private settings: ProjectTraSettings;
    private workspaceRoot: string | undefined;
    initialized: boolean;

    constructor(settings: ProjectTraSettings, workspaceRoot: string | undefined) {
        conlog("Translation: initializing");
        this.settings = settings;
        this.directory = settings.directory;
        this.workspaceRoot = workspaceRoot;
        this.initialized = false;
        this.data = new Map();
        this.consumers = new Map();
    }

    async init(): Promise<void> {
        this.data = await this.loadDir(this.settings.directory);
        this.buildConsumerIndex();
        this.initialized = true;
        conlog("Translation: initialized");
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Get hover for a translation reference.
     * @param uri - Document URI
     * @param langId - Language ID
     * @param symbol - The symbol under cursor (e.g., "@123" or "NOption(123")
     * @param text - Full document text
     * @returns Hover or null if not a translation reference
     */
    getHover(uri: string, langId: string, symbol: string, text: string): Hover | null {
        const relPath = this.resolveRelPath(uri, langId, symbol);
        if (!relPath) return null;
        return this.lookupHover(symbol, text, relPath, langId);
    }

    /**
     * Get definition location for a translation reference.
     * @param uri - Document URI
     * @param langId - Language ID
     * @param symbol - The symbol under cursor (e.g., "@123" or "mstr(100")
     * @param text - Full document text
     * @returns Location or null if not a translation reference
     */
    getDefinition(uri: string, langId: string, symbol: string, text: string): Location | null {
        const relPath = this.resolveRelPath(uri, langId, symbol);
        if (!relPath) return null;
        return this.lookupDefinition(symbol, text, relPath, langId);
    }

    /**
     * Get inlay hints for translation references in visible range.
     * @param uri - Document URI
     * @param langId - Language ID
     * @param text - Full document text
     * @param range - Visible range to generate hints for
     * @returns Array of inlay hints
     */
    getInlayHints(uri: string, langId: string, text: string, range: Range): InlayHint[] {
        if (!this.initialized) return [];
        if (this.data.size === 0) return [];

        const filePath = this.uriToPath(uri);
        const traFileKey = this.resolveTraFileKey(filePath, text, langId);
        if (!traFileKey) return [];

        const traEntries = this.data.get(traFileKey);
        if (!traEntries) return [];

        const traExt = this.getTraExt(langId, filePath, text);
        if (!traExt) return [];

        return this.generateInlayHints(traFileKey, traEntries, traExt, text, range, filePath);
    }

    /**
     * Reload translation data if the file is a translation file.
     * Call this on document open/save for translation files.
     * @param uri - Document URI
     * @param langId - Language ID
     * @param text - Full document text
     */
    reloadFile(uri: string, langId: string, text: string): void {
        if (!this.initialized) return;
        if (!languages.includes(langId)) return;

        const filePath = this.uriToPath(uri);
        const wsRoot = this.workspaceRoot;
        if (wsRoot === undefined || !isSubpath(wsRoot, filePath)) return;

        const wsPath = getRelPath(wsRoot, filePath);
        this.reloadFileLines(wsPath, text);
    }

    /**
     * Find all references to a translation entry from a .tra or .msg file.
     * Cursor can be on the entry number (@123, {123}) or anywhere in the value.
     * @param uri - Document URI of the .tra or .msg file
     * @param langId - Language ID (weidu-tra or fallout-msg)
     * @param position - Cursor position
     * @param includeDeclaration - Whether to include the definition itself
     * @returns Locations of all references, or empty array if not on a valid entry
     */
    getReferences(uri: string, langId: string, position: Position, includeDeclaration: boolean): Location[] {
        if (!this.initialized) return [];
        if (!languages.includes(langId)) return [];

        const filePath = this.uriToPath(uri);

        // Derive the tra file key: the file's path relative to the tra directory.
        const traFileKey = this.filePathToTraKey(filePath);
        if (!traFileKey) return [];

        const traEntries = this.data.get(traFileKey);
        if (!traEntries) return [];

        // Find which entry the cursor is on
        const entryNum = this.entryAtPosition(traEntries, position);
        if (entryNum === undefined) return [];

        const traExt = traFileKey.endsWith(".msg") ? "msg" : "tra";
        return this.findReferencesInConsumers(traFileKey, entryNum, traExt, filePath, includeDeclaration);
    }

    /**
     * Update the consumer reverse index for a single file.
     * Call this when a consumer file (ssl, baf, d, tp2, tssl, tbaf, td) is opened, saved, or changed.
     * Determines which tra/msg file the consumer references and updates the reverse index.
     * @param uri - Document URI of the consumer file
     * @param text - Full document text
     * @param langId - Language ID
     */
    reloadConsumer(uri: string, text: string, langId: string): void {
        if (!this.initialized) return;
        if (!translatableLanguages.includes(langId)) return;

        const filePath = this.uriToPath(uri);
        const wsRoot = this.workspaceRoot;
        if (wsRoot === undefined || !isSubpath(wsRoot, filePath)) return;

        const wsRelPath = getRelPath(wsRoot, filePath);

        // Remove this file from any existing consumer sets
        for (const consumerSet of this.consumers.values()) {
            consumerSet.delete(filePath);
        }

        // Resolve which tra/msg file this consumer maps to
        const traFileKey = this.resolveTraFileKey(wsRelPath, text, langId);
        if (!traFileKey) return;
        if (!this.data.has(traFileKey)) return;

        this.addConsumer(traFileKey, filePath);
    }

    /**
     * Get all message texts for a file (used for dialog parsing).
     * @param uri - Document URI
     * @param text - Full document text
     * @param langId - Language ID (determines .msg vs .tra resolution)
     * @returns Map of message ID to message text
     */
    getMessages(uri: string, text: string, langId: string = LANG_FALLOUT_SSL): Record<string, string> {
        const messages: Record<string, string> = {};
        if (!this.initialized) return messages;

        const filePath = this.uriToPath(uri);
        const traFileKey = this.resolveTraFileKey(filePath, text, langId);
        if (!traFileKey) return messages;

        const traEntries = this.data.get(traFileKey);
        if (!traEntries) return messages;

        for (const [id, entry] of traEntries) {
            messages[id] = entry.source;
        }
        return messages;
    }

    // =========================================================================
    // Internal methods
    // =========================================================================

    private uriToPath(uri: string): string {
        return uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    }

    /**
     * Shared guard + path resolution for getHover/getDefinition.
     * Returns workspace-relative path, or null if the request should be skipped.
     */
    private resolveRelPath(uri: string, langId: string, symbol: string): string | null {
        if (!this.initialized) return null;
        if (this.data.size === 0) return null;
        if (!translatableLanguages.includes(langId)) return null;

        const filePath = this.uriToPath(uri);
        const wsRoot = this.workspaceRoot;
        if (wsRoot === undefined || !isSubpath(wsRoot, filePath)) return null;
        if (!isTraRef(symbol, langId, filePath)) return null;

        return getRelPath(wsRoot, filePath);
    }

    /**
     * Determine translation file extension based on language and file path.
     * For typescript files, checks .tssl (msg) vs .tbaf (tra) extension.
     * For regular .ts files, infers from @tra comment or loaded translation files.
     */
    private getTraExt(langId: string, filePath?: string, text?: string): TraExt | undefined {
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
                const traFileExt = this.getTraFileExtFromComment(text);
                if (traFileExt) {
                    return traFileExt;
                }
            }
            // No @tra comment - infer from loaded translation files (msg and tra are never mixed)
            for (const key of this.data.keys()) {
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
    private getTraFileExtFromComment(text: string): TraExt | undefined {
        const firstLine = text.split(/\r?\n/g)[0];
        if (!firstLine) return undefined;

        const match = REGEX_TRA_COMMENT_EXT.exec(firstLine);
        if (match && match[1]) {
            return match[1] as TraExt;
        }
        return undefined;
    }

    /** Loads all tra files in a directory to a map of maps of strings */
    private async loadDir(traDir: string): Promise<TraData> {
        const traData: TraData = new Map();
        if (!isDirectory(traDir)) {
            conlog(`Translation: ${traDir} is not a directory, skipping`);
            return traData;
        }

        for (const ext of extensions) {
            const traFiles = findFiles(traDir, ext);
            // Sequential per extension is intentional: later extensions can
            // override entries from earlier ones, so ordering matters.
            // eslint-disable-next-line no-await-in-loop
            const { results, errors } = await this.loadFiles(traDir, traFiles, ext);
            if (errors.length > 0) {
                conlog(errors);
            }
            for (const x of results) {
                for (const [key, value] of x) {
                    traData.set(key, value);
                }
            }
        }
        return traData;
    }

    private async loadFiles(traDir: string, files: string[], ext: TraExt) {
        const { results, errors } = await PromisePool.withConcurrency(SCAN_CONCURRENCY)
            .for(files)
            .process(async (relPath) => {
                const result: TraData = new Map();
                const text = await fs.promises.readFile(path.join(traDir, relPath), "utf8");
                const lines = this.parseEntries(text, ext);
                result.set(relPath, lines);
                return result;
            });
        return { results, errors };
    }

    /** Parses text and returns a map of index => entry */
    private parseEntries(text: string, traType: TraExt): TraEntries {
        let regex: RegExp;
        if (traType === "tra") {
            regex = /@(\d+)\s*=\s*~([^~]*)~/gm;
        } else {
            regex = /{(\d+)}\s*{\w*}\s*{([^}]*)}/gm;
        }
        const entries: TraEntries = new Map();
        let currentLine = 0;
        let lineStartIndex = 0;
        let match = regex.exec(text);
        while (match !== null) {
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            const num = match[1];
            const str = match[2];
            // Check undefined only -- empty string is a valid translation entry (e.g., @0 = ~~)
            if (num === undefined || str === undefined) {
                match = regex.exec(text);
                continue;
            }

            // Track line/character position by scanning newlines up to match start.
            // This loop and the end-position loop below scan disjoint ranges
            // (lineStartIndex..match.index and match.index..matchEnd) so newlines
            // are never double-counted, even for multiline values.
            for (let i = lineStartIndex; i < match.index; i++) {
                if (text[i] === "\n") {
                    currentLine++;
                    lineStartIndex = i + 1;
                }
            }
            const startLine = currentLine;
            const character = match.index - lineStartIndex;

            // Compute end position by scanning newlines through the full match.
            // This also advances currentLine/lineStartIndex past multiline values
            // so the next iteration starts from the correct position.
            const matchEnd = match.index + match[0].length;
            for (let i = match.index; i < matchEnd; i++) {
                if (text[i] === "\n") {
                    currentLine++;
                    lineStartIndex = i + 1;
                }
            }
            const endLine = currentLine;
            const endCharacter = matchEnd - lineStartIndex;

            const hover: Hover = {
                contents: {
                    kind: "markdown",
                    value: `\`\`\`bgforge-mls-string\n${str}\n\`\`\``,
                },
            };
            const inlay = this.stringToInlay(str);

            const entry: TraEntry = {
                source: str,
                hover,
                inlay,
                line: startLine,
                character,
                endLine,
                endCharacter,
            };
            if (`/* ${str} */` !== inlay) {
                entry.inlayTooltip = str;
            }
            entries.set(num, entry);
            match = regex.exec(text);
        }
        return entries;
    }

    private reloadFileLines(wsPath: string, text: string): void {
        const traPath = this.getTraPath(wsPath);
        if (!traPath) {
            conlog(`Translation: can't detect tra path for ${wsPath}, skipping reload`);
            return;
        }
        const ext = path.parse(traPath).ext.slice(-3);
        if (ext !== "tra" && ext !== "msg") {
            conlog(`Translation: unknown extension ${ext}`);
            return;
        }
        const entries = this.parseEntries(text, ext as TraExt);
        this.data.set(traPath, entries);
        conlog(`Translation: reloaded ${traPath}`);
    }

    /** Convert workspace-relative path to tra-directory-relative path */
    private getTraPath(wsPath: string): string | undefined {
        if (isDirectory(this.directory)) {
            if (isSubpath(this.directory, wsPath)) {
                return getRelPath(this.directory, wsPath);
            }
        }
        return undefined;
    }

    /**
     * Resolve the translation file key for a source file.
     * Checks for @tra comment first, falls back to auto-matching by basename.
     */
    private resolveTraFileKey(filePath: string, fullText: string, langId: string): string | undefined {
        const firstLine = fullText.split(/\r?\n/g)[0];
        if (!firstLine) return undefined;

        const match = REGEX_TRA_COMMENT.exec(firstLine);
        if (match && match[1]) {
            return match[1];
        }
        if (this.settings.auto_tra) {
            const traExt = this.getTraExt(langId, filePath, fullText);
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
    private resolveEntry(word: string, text: string, relPath: string, langId: string): ResolveResult {
        const ext = this.getTraExt(langId, relPath, text);
        if (!ext) return null;

        const fileKey = this.resolveTraFileKey(relPath, text, langId);
        if (!fileKey) return null;

        const traFile = this.data.get(fileKey);
        if (!traFile) {
            return { kind: "file-missing", fileKey };
        }

        const lineKey = this.getLineKey(word, ext);
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

    private lookupHover(word: string, text: string, relPath: string, langId: string): Hover | null {
        const result = this.resolveEntry(word, text, relPath, langId);
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

    private lookupDefinition(word: string, text: string, relPath: string, langId: string): Location | null {
        const result = this.resolveEntry(word, text, relPath, langId);
        if (!result || result.kind !== "entry") return null;

        const absolutePath = this.resolveAbsolutePath(result.fileKey);
        if (!absolutePath) return null;

        return {
            uri: pathToUri(absolutePath),
            range: {
                start: { line: result.entry.line, character: result.entry.character },
                end: { line: result.entry.line, character: result.entry.character },
            },
        };
    }

    /** Resolve a tra-directory-relative file key to an absolute path */
    private resolveAbsolutePath(fileKey: string): string | undefined {
        const traDir = this.resolveTraDir();
        if (!traDir) return undefined;
        return path.join(traDir, fileKey);
    }

    private getLineKey(word: string, ext: TraExt): string | undefined {
        if (ext === "msg") {
            const match = REGEX_MSG_HOVER.exec(word);
            if (match) {
                return match[2];
            }
        }
        if (ext === "tra") {
            // Check for transpiler tra(123) format (TBAF/TD)
            const traMatch = REGEX_TRANSPILER_TRA_HOVER.exec(word);
            if (traMatch) {
                return traMatch[1];
            }
            // Standard @123 format
            return word.substring(1);
        }
        return undefined;
    }

    private generateInlayHints(
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
            const hintValue = this.getHintValue(traEntries, traFileKey, lineKey);
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

                for (const match of lineText.matchAll(new RegExp(REGEX_MSG_INLAY.source, "g"))) {
                    const lineKey = match[2];
                    if (!lineKey) {
                        continue;
                    }
                    lineHints.push({
                        character: match.index! + match[0].length,
                        lineKey,
                    });
                }

                for (const match of lineText.matchAll(new RegExp(REGEX_MSG_INLAY_FLOATER_RAND.source, "g"))) {
                    const secondKey = match[2];
                    if (!secondKey) {
                        continue;
                    }
                    const secondStart = match[0].lastIndexOf(secondKey);
                    lineHints.push({
                        character: match.index! + secondStart + secondKey.length,
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
                regex = new RegExp(REGEX_TRANSPILER_TRA_INLAY.source, "g");
            } else {
                regex = new RegExp(REGEX_TRA_INLAY.source, "g");
            }
            keyIndex = 1;
        }

        // NOTE: This works because we split by newlines first, so each line element is
        // guaranteed single-line. If future patterns need multiline matching, this would
        // need byte-offset-to-position conversion like in weidu-tp2/rename.ts.
        lines.forEach((l, i) => {
            const matches = l.matchAll(regex);
            for (const m of matches) {
                // matchAll always provides index for each match
                const char_end = m.index! + m[0].length;
                const lineKey = m[keyIndex];
                if (!lineKey) continue;
                pushHint(range.start.line + i, char_end, lineKey);
            }
        });
        return hints;
    }

    private getHintValue(
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

    private stringToInlay(text: string): string {
        let line = text.replaceAll("\r", "");
        line = line.replaceAll("\n", "\\n");
        // Escape */ to prevent breaking the inlay comment syntax
        line = line.replaceAll("*/", "*\\/");
        if (line.length > 30) {
            line = line.slice(0, 27) + "...";
        }
        return `/* ${line} */`;
    }

    // =========================================================================
    // Find References helpers
    // =========================================================================

    /**
     * Build the reverse index mapping each traFileKey to consumer file paths.
     * Scans the workspace for files with consumer extensions, reads first line
     * to check for @tra comment, falls back to basename matching.
     */
    private buildConsumerIndex(): void {
        const wsRoot = this.workspaceRoot;
        if (!wsRoot) return;

        this.consumers = new Map();

        // Determine which extensions to scan based on loaded tra data
        const hasMsg = [...this.data.keys()].some((k) => k.endsWith(".msg"));
        const hasTra = [...this.data.keys()].some((k) => k.endsWith(".tra"));

        const extsToScan: string[] = [];
        if (hasTra) {
            extsToScan.push(...CONSUMER_EXTENSIONS_TRA);
        }
        if (hasMsg) {
            extsToScan.push(...CONSUMER_EXTENSIONS_MSG);
        }

        // Deduplicate extensions
        const uniqueExts = [...new Set(extsToScan)];

        for (const ext of uniqueExts) {
            const files = findFiles(wsRoot, ext);
            for (const relFile of files) {
                const absPath = path.join(wsRoot, relFile);
                this.indexConsumerFile(absPath, relFile);
            }
        }

        conlog(`Translation: built consumer index with ${this.consumers.size} tra/msg file mappings`);
    }

    /**
     * Index a single consumer file into the reverse map.
     * Reads the first line for @tra comment, falls back to basename matching.
     * Uses synchronous I/O: this runs during init() after async tra loading completes,
     * only reads 256 bytes per file, and typical mod projects have tens of consumer files.
     */
    private indexConsumerFile(absPath: string, wsRelPath: string): void {
        let traFileKey: string | undefined;

        // Try reading first line for @tra comment (only 256 bytes, not the whole file)
        try {
            const fd = fs.openSync(absPath, "r");
            const buf = Buffer.alloc(256);
            const bytesRead = fs.readSync(fd, buf, 0, 256, 0);
            fs.closeSync(fd);
            const firstLine = buf.subarray(0, bytesRead).toString("utf8").split(/\r?\n/)[0] ?? "";
            const match = REGEX_TRA_COMMENT.exec(firstLine);
            if (match && match[1]) {
                traFileKey = match[1];
            }
        } catch {
            // File might be inaccessible, skip
            return;
        }

        // Fall back to basename matching
        if (!traFileKey && this.settings.auto_tra) {
            const basename = path.parse(wsRelPath).name;
            const ext = path.extname(absPath).toLowerCase();
            const traExt = this.consumerExtToTraExt(ext);
            if (traExt) {
                const candidate = `${basename}.${traExt}`;
                if (this.data.has(candidate)) {
                    traFileKey = candidate;
                }
            }
        }

        if (!traFileKey) return;
        if (!this.data.has(traFileKey)) return;

        this.addConsumer(traFileKey, absPath);
    }

    /** Add a file to the consumer set for a given tra file key. */
    private addConsumer(traFileKey: string, absPath: string): void {
        let consumerSet = this.consumers.get(traFileKey);
        if (!consumerSet) {
            consumerSet = new Set();
            this.consumers.set(traFileKey, consumerSet);
        }
        consumerSet.add(absPath);
    }

    /**
     * Convert an absolute file path of a tra/msg file to its tra file key.
     * Handles both absolute and relative tra directory settings.
     */
    private filePathToTraKey(filePath: string): string | undefined {
        const traDir = this.resolveTraDir();
        if (!traDir) return undefined;
        if (!isSubpath(traDir, filePath)) return undefined;
        return getRelPath(traDir, filePath);
    }

    /** Resolve the tra directory to an absolute path. */
    private resolveTraDir(): string | undefined {
        if (path.isAbsolute(this.directory)) {
            return this.directory;
        }
        if (!this.workspaceRoot) return undefined;
        return path.join(this.workspaceRoot, this.directory);
    }

    /**
     * Map a consumer file extension to its corresponding translation extension.
     * Derived from CONSUMER_EXTENSIONS_TRA/MSG to maintain a single source of truth.
     */
    private consumerExtToTraExt(ext: string): TraExt | undefined {
        const bare = ext.startsWith(".") ? ext.slice(1).toLowerCase() : ext.toLowerCase();
        if (CONSUMER_EXTENSIONS_TRA.includes(bare as (typeof CONSUMER_EXTENSIONS_TRA)[number])) {
            return "tra";
        }
        if (CONSUMER_EXTENSIONS_MSG.includes(bare as (typeof CONSUMER_EXTENSIONS_MSG)[number])) {
            return "msg";
        }
        return undefined;
    }

    /**
     * Find which entry number the cursor is on in a tra/msg file.
     * Matches both the entry number/header and the value span (including multiline).
     */
    private entryAtPosition(entries: TraEntries, position: Position): string | undefined {
        for (const [num, entry] of entries) {
            // Check if position falls within this entry's range (start to end, inclusive)
            if (position.line < entry.line) continue;
            if (position.line > entry.endLine) continue;
            if (position.line === entry.line && position.character < entry.character) continue;
            if (position.line === entry.endLine && position.character > entry.endCharacter) continue;
            return num;
        }
        return undefined;
    }

    /**
     * Find all references to a specific entry number across consumer files.
     * Uses synchronous file reads: LSP references requests are synchronous by protocol,
     * and typical mod projects have a small number of consumer files per tra/msg entry.
     */
    private findReferencesInConsumers(
        traFileKey: string,
        entryNum: string,
        traExt: TraExt,
        traAbsPath: string,
        includeDeclaration: boolean,
    ): Location[] {
        const locations: Location[] = [];

        // Optionally include the declaration itself
        if (includeDeclaration) {
            const entry = this.data.get(traFileKey)?.get(entryNum);
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

        const consumerFiles = this.consumers.get(traFileKey);
        if (!consumerFiles) return locations;

        for (const absPath of consumerFiles) {
            let text: string;
            try {
                text = fs.readFileSync(absPath, "utf8");
            } catch {
                continue;
            }
            const refs = this.scanFileForReferences(text, entryNum, traExt);
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

    /**
     * Scan a file's text for references to a specific entry number.
     * Returns line/character positions for each match.
     */
    private scanFileForReferences(
        text: string,
        entryNum: string,
        traExt: TraExt,
    ): Array<{ line: number; character: number; endCharacter: number }> {
        const results: Array<{ line: number; character: number; endCharacter: number }> = [];
        const lines = text.split("\n");

        if (traExt === "tra") {
            const regex = REGEX_TRA_REF(entryNum);
            for (let i = 0; i < lines.length; i++) {
                const lineText = lines[i]!;
                for (const match of lineText.matchAll(regex)) {
                    results.push({
                        line: i,
                        character: match.index!,
                        endCharacter: match.index! + match[0].length,
                    });
                }
            }
        } else {
            // MSG references: mstr(num), NOption(num), floater_rand(x, num), etc.
            // Single combined regex handles both first-arg and floater_rand second-arg patterns.
            const regex = REGEX_MSG_REF(entryNum);
            for (let i = 0; i < lines.length; i++) {
                const lineText = lines[i]!;
                for (const match of lineText.matchAll(regex)) {
                    results.push({
                        line: i,
                        character: match.index!,
                        endCharacter: match.index! + match[0].length,
                    });
                }
            }
        }

        return results;
    }
}
