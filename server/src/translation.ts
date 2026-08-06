/**
 * Translation service for .tra and .msg files.
 * Self-contained service that loads translations and provides hover, inlay hints,
 * go-to-definition, and find-references for translation references.
 * Can be used by any consumer (providers, TSSL/TBAF handlers, etc.)
 *
 * This is a thin facade over the translation subsystem in `./translation/`: it owns the shared
 * `TranslationState` (entry map, consumer index) for its lifetime, does the request-guarding
 * (initialized/language/workspace-subpath checks) that is the same shape across every public
 * method, and delegates the actual work to the loader / feature / write-back modules.
 */

import { fileURLToPath } from "url";
import * as path from "path";
import {
    type Diagnostic,
    type Hover,
    type InlayHint,
    type Location,
    type Position,
    type Range,
    DiagnosticSeverity,
} from "vscode-languageserver/node";
import { conlog } from "./logger";
import { isSubpathFullyResolved, tryRealpathSync } from "./path-utils";
import { LANG_FALLOUT_SSL, TRANSLATION_FILE_LANGUAGES } from "./core/languages";
import type { ProjectTraSettings } from "./settings";
import {
    addConsumer,
    buildConsumerIndex,
    filePathToTraKey,
    loadDir,
    removeConsumer,
    resolveTraDir,
} from "./translation/loader";
import { entryAtPosition } from "./translation/entries";
import {
    collectUnresolvedRefs,
    findReferencesInConsumers,
    generateInlayHints,
    isTraRef,
    lookupDefinition,
    lookupHover,
    missingEntryMessage,
    resolveTraFileKey,
    translatableLanguages,
} from "./translation/features";
import {
    NO_WRITE,
    reloadFileLines,
    writeMessages as writeMessagesImpl,
    type WriteMessagesResult,
} from "./translation/write-back";
import { createTranslationState, type TranslationState } from "./translation/state";

export type { WriteMessagesResult } from "./translation/write-back";
export { UnsupportedEncodingCharacterError } from "./translation/encoding";

/** Languages that contain translation strings (msg/tra files) */
const languages = TRANSLATION_FILE_LANGUAGES;

export class Translation {
    private readonly state: TranslationState;
    initialized: boolean;

    constructor(settings: ProjectTraSettings, workspaceRoot: string | undefined, notifyReload?: () => void) {
        conlog("Translation: initializing");
        this.state = createTranslationState(settings, workspaceRoot, notifyReload);
        this.initialized = false;
    }

    async init(): Promise<void> {
        // Route loading through resolveTraDir so the workspace-subpath check
        // gates the load path the same way it gates the lookup path.
        const traDir = resolveTraDir(this.state);
        this.state.data = traDir ? await loadDir(traDir) : new Map();
        await buildConsumerIndex(this.state);
        this.initialized = true;
        conlog("Translation: initialized");
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * The configured tra directory as an absolute path, or undefined when unset or outside the workspace.
     * Exposed so features that need to know which language directory the workspace means - tp2 path
     * navigation, for one - read the same answer `@N` resolution uses.
     */
    directory(): string | undefined {
        return resolveTraDir(this.state);
    }

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
        return lookupHover(this.state, symbol, text, relPath, langId);
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
        return lookupDefinition(this.state, symbol, text, relPath, langId);
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
        if (this.state.data.size === 0) return [];
        return generateInlayHints(this.state, this.uriToPath(uri), text, langId, range);
    }

    /**
     * Diagnose translation references (@N / tra(N) / mstr(N) ...) that point at an entry missing from
     * the RESOLVED translation file. Info severity. Emits nothing unless a translation file resolves for
     * the document AND is loaded, so a project without translations is never flagged.
     * @param uri - Document URI
     * @param langId - Language ID
     * @param text - Full document text
     * @returns Info diagnostics for unresolved references, or [] when suppressed
     */
    getDiagnostics(uri: string, langId: string, text: string): Diagnostic[] {
        if (!this.initialized) return [];
        if (this.state.data.size === 0) return [];
        if (!translatableLanguages.has(langId)) return [];

        const filePath = this.uriToPath(uri);
        return collectUnresolvedRefs(this.state, text, filePath, langId).map((ref) => ({
            severity: DiagnosticSeverity.Information,
            range: ref.range,
            message: missingEntryMessage(ref.entryNum, ref.fileKey),
            source: "BGforge MLS (translation)",
        }));
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

        const wsRoot = this.state.resolvedWsRoot;
        if (wsRoot === undefined) return;
        const filePath = this.uriToPath(uri);
        const resolvedFilePath = tryRealpathSync(filePath);
        if (resolvedFilePath === undefined) return;
        if (!isSubpathFullyResolved(wsRoot, resolvedFilePath)) return;

        const wsPath = path.relative(wsRoot, filePath);
        reloadFileLines(this.state, wsPath, text);
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
    async getReferences(
        uri: string,
        langId: string,
        position: Position,
        includeDeclaration: boolean,
    ): Promise<Location[]> {
        if (!this.initialized) return [];
        if (!languages.includes(langId)) return [];

        const filePath = this.uriToPath(uri);

        // Derive the tra file key: the file's path relative to the tra directory.
        const traFileKey = filePathToTraKey(this.state, filePath);
        if (!traFileKey) return [];

        const traEntries = this.state.data.get(traFileKey);
        if (!traEntries) return [];

        // Find which entry the cursor is on
        const entryNum = entryAtPosition(traEntries, position);
        if (entryNum === undefined) return [];

        const traExt = traFileKey.endsWith(".msg") ? "msg" : "tra";
        return findReferencesInConsumers(this.state, traFileKey, entryNum, traExt, filePath, includeDeclaration);
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
        if (!translatableLanguages.has(langId)) return;

        const wsRoot = this.state.resolvedWsRoot;
        if (wsRoot === undefined) return;
        const filePath = this.uriToPath(uri);
        const resolvedFilePath = tryRealpathSync(filePath);
        if (resolvedFilePath === undefined) return;
        if (!isSubpathFullyResolved(wsRoot, resolvedFilePath)) return;

        const wsRelPath = path.relative(wsRoot, filePath);

        // Remove this file from its previous consumer set in O(1) via the reverse index.
        removeConsumer(this.state, filePath);

        // Resolve which tra/msg file this consumer maps to
        const traFileKey = resolveTraFileKey(this.state, wsRelPath, text, langId);
        if (!traFileKey) return;
        if (!this.state.data.has(traFileKey)) return;

        addConsumer(this.state, traFileKey, filePath);
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
        const traFileKey = resolveTraFileKey(this.state, filePath, text, langId);
        if (!traFileKey) return messages;

        const traEntries = this.state.data.get(traFileKey);
        if (!traEntries) return messages;

        for (const [id, entry] of traEntries) {
            messages[id] = entry.source;
        }
        return messages;
    }

    /**
     * Persist edited message strings to the resolved .tra, rewriting only the
     * changed entries in place (comments, ordering, formatting, and untouched
     * entries are preserved). Returns true if the file changed. Used by the dialog
     * editor's save path; the .tra is the document of record for @N text.
     */
    writeMessages(uri: string, text: string, langId: string, messages: Record<string, string>): WriteMessagesResult {
        if (!this.initialized) return NO_WRITE;
        const filePath = this.uriToPath(uri);
        return writeMessagesImpl(this.state, filePath, text, langId, messages);
    }

    // =========================================================================
    // Internal methods
    // =========================================================================

    // Tolerates a value that is already a plain filesystem path by returning it
    // unchanged; the shared uri-utils.uriToPath assumes a file:// URI and throws
    // on a bare path. Kept local for that reason.
    private uriToPath(uri: string): string {
        return uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    }

    /**
     * Shared guard + path resolution for getHover/getDefinition.
     * Returns workspace-relative path, or null if the request should be skipped.
     */
    private resolveRelPath(uri: string, langId: string, symbol: string): string | null {
        if (!this.initialized) return null;
        if (this.state.data.size === 0) return null;
        if (!translatableLanguages.has(langId)) return null;

        const wsRoot = this.state.resolvedWsRoot;
        if (wsRoot === undefined) return null;
        const filePath = this.uriToPath(uri);
        if (!isTraRef(symbol, langId, filePath)) return null;
        const resolvedFilePath = tryRealpathSync(filePath);
        if (resolvedFilePath === undefined) return null;
        if (!isSubpathFullyResolved(wsRoot, resolvedFilePath)) return null;

        return path.relative(wsRoot, filePath);
    }
}
