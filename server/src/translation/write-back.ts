/**
 * Write-back / persistence for the translation subsystem: `writeMessages` (the dialog editor's
 * save path) and the reload path that re-indexes a `.tra`/`.msg` file after it changes on disk.
 */

import * as fs from "fs";
import * as path from "path";
import {
    appendMsgEntries,
    appendTraEntries,
    rewriteMsgEntries,
    rewriteTraEntries,
    siblingTraCandidates,
} from "../../../shared/dialog-tra-edit";
import { conlog } from "../logger";
import { type ResolvedEncoding, atomicWriteFileSync, decodeFileBytes, encodeToResolvedEncoding } from "./encoding";
import { parseEntries, type TraExt } from "./entries";
import { ensureTraConfig, resolveAbsolutePath, resolveTraDir } from "./loader";
import { getTraExt, resolveTraFileKey } from "./features";
import type { TranslationState } from "./state";

/**
 * Where a from-scratch dialog's translation file is bootstrapped when no tra directory is configured. Fallout
 * SSL (`.msg`) uses the engine's English dialog path; WeiDU D (`.tra`) uses the plain `tra` default (the WeiDU
 * convention, same as the settings default). The editor creates the dir AND records it in `.bgforge.yml`, so the
 * loader (`resolveTraDir` -> `loadDir`) scans it on reopen and hover/inlay/the dialog editor (one path via
 * `getMessages`) all resolve `@N`. A sibling next to the source would not be scanned; these are the working
 * locations. (WeiDU D writes new text inline in the `.d` rather than allocating `@N`, so its `.tra` bootstrap is
 * rarely exercised - see dialog-tra-edit.ts - but the location stays correct when it is.)
 */
const DEFAULT_SSL_DIALOG_DIR = "data/text/english/dialog";
const DEFAULT_D_TRA_DIR = "tra";

/**
 * Result of `writeMessages`: whether the active `.tra` changed, plus any sibling-language
 * `.tra` files (a `tra/<language>/` layout) that now hold stale, pre-edit text and need
 * updating. `staleSiblingLanguages` is the list of those sibling language directory names.
 */
export interface WriteMessagesResult {
    changed: boolean;
    staleSiblingLanguages: string[];
}
export const NO_WRITE: WriteMessagesResult = { changed: false, staleSiblingLanguages: [] };

/**
 * Sibling-language `.tra` files (a `tra/<language>/<file>.tra` layout) that exist on
 * disk beside the one just written - they still hold the pre-edit text, so the save
 * path can warn that they diverged. Returns the sibling language directory names.
 * Empty for a flat / single-language layout (no same-named file in a sibling dir).
 */
function staleSiblingLanguages(absPath: string): string[] {
    const langParent = path.dirname(path.dirname(absPath));
    let subdirs: string[];
    try {
        subdirs = fs
            .readdirSync(langParent, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch (error) {
        // A missing parent is the normal flat-layout case documented above. Anything else - an unreadable
        // or permission-denied directory - would silently suppress the "other languages diverged" warning
        // on every save, so it is reported rather than folded into "no siblings".
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            conlog(`cannot scan ${langParent} for sibling translations: ${(error as Error).message}`);
        }
        return [];
    }
    return siblingTraCandidates(absPath, subdirs)
        .filter((p) => fs.existsSync(p))
        .map((p) => path.basename(path.dirname(p)));
}

/**
 * Persist edited message strings to the resolved .tra, rewriting only the
 * changed entries in place (comments, ordering, formatting, and untouched
 * entries are preserved). Returns true if the file changed. Used by the dialog
 * editor's save path; the .tra is the document of record for @N text.
 */
export function writeMessages(
    state: TranslationState,
    filePath: string,
    text: string,
    langId: string,
    messages: Record<string, string>,
): WriteMessagesResult {
    const ext = getTraExt(state, langId, filePath, text);
    const fileKey = resolveTraFileKey(state, filePath, text, langId);
    if (!ext || !fileKey) return NO_WRITE;
    // The `.msg`/`.tra` must land where `loadDir` scans (`resolveTraDir`), or nothing resolves `@N` on
    // reopen - the dialog editor, hover, and inlay are ONE path (getMessages/resolveEntry -> state.data
    // keyed by resolveTraFileKey), so a file the loader never scans is invisible to all three. Three cases:
    //  - the configured tra dir EXISTS -> write there (a real project with its tra/ or dialog dir);
    //  - from-scratch with a workspace -> bootstrap the format's convention dir (SSL .msg -> the Fallout
    //    data/text/english/dialog path; D .tra -> the plain `tra` default), create it, RECORD it in
    //    .bgforge.yml so the next session's loadDir scans it, and write there. This session resolves via the
    //    state.data.set below; the config makes it survive a reopen;
    //  - no workspace root -> a sibling of the source, so text is not silently lost (last resort).
    // (resolveTraDir returns the path even when the dir is absent, so directory EXISTENCE is the test.)
    const configured = resolveAbsolutePath(state, fileKey);
    let absPath: string;
    if (configured && fs.existsSync(path.dirname(configured))) {
        absPath = configured;
    } else if (state.workspaceRoot) {
        const relDir = ext === "msg" ? DEFAULT_SSL_DIALOG_DIR : DEFAULT_D_TRA_DIR;
        const dir = path.join(state.workspaceRoot, relDir);
        fs.mkdirSync(dir, { recursive: true });
        ensureTraConfig(state.workspaceRoot, relDir);
        absPath = path.join(dir, fileKey);
    } else {
        absPath = path.join(path.dirname(filePath), fileKey);
    }
    let original: string;
    // Encoding for a brand-new file (the ENOENT branch below) defaults to UTF-8 - there are no
    // existing bytes to resolve an encoding from.
    let sourceEncoding: ResolvedEncoding = "utf-8";
    try {
        const raw = fs.readFileSync(absPath);
        ({ text: original, encoding: sourceEncoding } = decodeFileBytes(raw));
    } catch (error) {
        // ENOENT -> the file does not exist yet, so create it (the from-scratch case: an SSL dialog's text
        // has nowhere to land until its `.msg` is written). Any OTHER read error (permissions, a directory
        // in the way) must NOT proceed to a write that could clobber an existing-but-unreadable file.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return NO_WRITE;
        original = "";
    }
    // Each format needs its own rewriter: a .tra is `@N = ~text~`, a .msg is
    // `{id}{sound}{text}`, and either rewriter is a silent no-op on the other's syntax.
    // Both rewrite existing entries then append brand-new ones: a newly-added option's or state's text
    // has no entry yet (the D-family allocator mints its `@N` at save time, like the SSL allocator does
    // for `.msg` ids), and a rewrite-only path silently drops that text from the translation file.
    const updated =
        ext === "msg"
            ? appendMsgEntries(rewriteMsgEntries(original, messages), messages)
            : appendTraEntries(rewriteTraEntries(original, messages), messages);
    if (updated === original) return NO_WRITE;
    // Re-encode to the encoding the file was read as (sourceEncoding, above) so untouched
    // entries round-trip byte-identically; encodeToResolvedEncoding throws rather than
    // silently transcoding or replacement-charing an edit the target encoding can't represent
    // - nothing below is written when that happens. Then write via a same-directory temp file
    // + rename so a crash mid-write can't truncate the document of record.
    const encoded = encodeToResolvedEncoding(updated, sourceEncoding);
    atomicWriteFileSync(absPath, encoded);
    // Refresh the cached entries that getMessages/inlay hints read for this file.
    state.data.set(fileKey, parseEntries(updated, ext));
    return { changed: true, staleSiblingLanguages: staleSiblingLanguages(absPath) };
}

/**
 * Convert a workspace-relative source path to its tra-directory-relative key
 * (the same key form `loadDir` produces), or undefined if the file is not under
 * the configured translation directory.
 *
 * Path-math only, via `resolveTraDir` and the absolute file path. A realpath-based
 * subpath check (the previous `isSubpath(this.directory, wsPath)`) resolved the
 * workspace-relative `wsPath` against the process CWD, which is not the workspace
 * root under a normally-spawned LSP server - so it rejected every file whenever the
 * server ran from any other directory, silently disabling `.tra`/`.msg` reload.
 */
function getTraPath(state: TranslationState, wsPath: string): string | undefined {
    const traDir = resolveTraDir(state);
    if (traDir === undefined || state.workspaceRoot === undefined) return undefined;
    const absFile = path.resolve(state.workspaceRoot, wsPath);
    const rel = path.relative(traDir, absFile);
    if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
        return undefined;
    }
    return rel;
}

export function reloadFileLines(state: TranslationState, wsPath: string, text: string): void {
    const traPath = getTraPath(state, wsPath);
    if (!traPath) {
        conlog(`Translation: can't detect tra path for ${wsPath}, skipping reload`);
        return;
    }
    const ext = path.parse(traPath).ext.slice(-3);
    if (ext !== "tra" && ext !== "msg") {
        conlog(`Translation: unknown extension ${ext}`);
        return;
    }
    const entries = parseEntries(text, ext as TraExt);
    state.data.set(traPath, entries);
    conlog(`Translation: reloaded ${traPath}`);
    // Open consumer documents' inlay hints were computed against the now-stale entries;
    // push a refresh so the client recomputes them against the entries just set above.
    state.notifyReload?.();
}
