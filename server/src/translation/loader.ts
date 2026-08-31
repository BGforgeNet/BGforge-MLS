/**
 * Directory loading and workspace scanning for the translation subsystem: resolving the
 * configured tra directory, loading its `.tra`/`.msg` files into the entry map, and the bounded
 * consumer-index walk that maps consumer source files back to the tra/msg file they reference.
 */

import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import * as yaml from "yaml";
import { errorMessage } from "../diagnostics";
import { conlog } from "../logger";
import { CONSUMER_EXTENSIONS_MSG, CONSUMER_EXTENSIONS_TRA } from "../core/languages";
import { REGEX_TRA_COMMENT } from "../core/patterns";
import {
    findFiles,
    findFilesByExtensions,
    isDirectory,
    isSubpathResolved,
    WORKSPACE_SCAN_CONCURRENCY,
} from "../path-utils";
import { decodeFileBytes } from "./encoding";
import { consumerExtToTraExt, parseEntries, type TraData, type TraExt } from "./entries";
import { resolveRealpath, type TranslationState } from "./state";

const extensions: Array<TraExt> = ["msg", "tra"];

/** Resolve the tra directory to an absolute path, refusing values that
 *  resolve outside the workspace root.
 *
 *  Defense in depth: VSCode Workspace Trust is the primary gate against an
 *  untrusted `.bgforge.yml`, but trust can be bypassed (or absent in
 *  non-VSCode LSP clients), so the LSP layer also checks. A `directory`
 *  that escapes via `..` or names an absolute path elsewhere on disk is
 *  ignored - `loadDir` is never called against it, so unrelated `.tra`/
 *  `.msg` files outside the workspace never reach hover/inlay output.
 *
 *  The check is path-math only (no realpath): a tra directory that does
 *  not yet exist on disk but resolves inside the workspace is still
 *  accepted, matching `loadDir`'s tolerance for missing directories. */
export function resolveTraDir(state: TranslationState): string | undefined {
    let resolved: string;
    if (path.isAbsolute(state.directory)) {
        resolved = state.directory;
    } else if (state.workspaceRoot) {
        resolved = path.join(state.workspaceRoot, state.directory);
    } else {
        return undefined;
    }
    if (state.workspaceRoot) {
        const rel = path.relative(state.workspaceRoot, resolved);
        if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
            conlog(
                `Translation: ignoring tra directory '${state.directory}' - resolves outside workspace root`,
                "warn",
            );
            return undefined;
        }
    }
    return resolved;
}

/**
 * Memoised realpath of the resolved tra directory. Returns `undefined` if the
 * directory can't be resolved (missing workspace root, realpath failure).
 */
export function getResolvedTraDir(state: TranslationState): string | undefined {
    if (state.resolvedTraDirCache === null) {
        const traDir = resolveTraDir(state);
        state.resolvedTraDirCache = resolveRealpath(traDir);
    }
    return state.resolvedTraDirCache;
}

/** Loads all tra files in a directory to a map of maps of strings */
export async function loadDir(traDir: string): Promise<TraData> {
    const traData: TraData = new Map();
    if (!isDirectory(traDir)) {
        conlog(`Translation: ${traDir} is not a directory, skipping`);
        return traData;
    }

    for (const ext of extensions) {
        // Sequential per extension is intentional: later extensions can
        // override entries from earlier ones, so ordering matters.
        // eslint-disable-next-line no-await-in-loop
        const traFiles = await findFiles(traDir, ext);
        // eslint-disable-next-line no-await-in-loop
        const { results, errors } = await loadFiles(traDir, traFiles, ext);
        if (errors.length > 0) {
            conlog(
                `Translation: ${errors.length} error(s) loading *.${ext} from ${traDir}: ${errors.map((e) => errorMessage(e)).join("; ")}`,
                "warn",
            );
        }
        for (const x of results) {
            for (const [key, value] of x) {
                traData.set(key, value);
            }
        }
    }
    return traData;
}

async function loadFiles(
    traDir: string,
    files: string[],
    ext: TraExt,
): Promise<{ results: TraData[]; errors: unknown[] }> {
    const limit = pLimit(WORKSPACE_SCAN_CONCURRENCY);
    const results: TraData[] = [];
    const errors: unknown[] = [];
    await Promise.all(
        files.map((relPath) =>
            limit(async () => {
                try {
                    const raw = await fs.promises.readFile(path.join(traDir, relPath));
                    const { text } = decodeFileBytes(raw);
                    const lines = parseEntries(text, ext);
                    const result: TraData = new Map([[relPath, lines]]);
                    results.push(result);
                } catch (error) {
                    // Collect per-file failures instead of failing fast - a single unreadable
                    // file shouldn't abort the whole load pass.
                    errors.push(error);
                }
            }),
        ),
    );
    return { results, errors };
}

/**
 * Convert an absolute file path of a tra/msg file to its tra file key.
 * Handles both absolute and relative tra directory settings.
 */
export function filePathToTraKey(state: TranslationState, filePath: string): string | undefined {
    const traDir = getResolvedTraDir(state);
    if (!traDir) return undefined;
    if (!isSubpathResolved(traDir, filePath)) return undefined;
    return path.relative(traDir, filePath);
}

/** Resolve a tra-directory-relative file key to an absolute path */
export function resolveAbsolutePath(state: TranslationState, fileKey: string): string | undefined {
    const traDir = resolveTraDir(state);
    if (!traDir) return undefined;
    return path.join(traDir, fileKey);
}

/** Add a file to the consumer set for a given tra file key. */
export function addConsumer(state: TranslationState, traFileKey: string, absPath: string): void {
    let consumerSet = state.consumers.get(traFileKey);
    if (!consumerSet) {
        consumerSet = new Set();
        state.consumers.set(traFileKey, consumerSet);
    }
    consumerSet.add(absPath);
    state.consumerToTraKey.set(absPath, traFileKey);
}

/** Remove a file from its current consumer set in O(1) via the reverse index. */
export function removeConsumer(state: TranslationState, absPath: string): void {
    const previousKey = state.consumerToTraKey.get(absPath);
    if (previousKey === undefined) return;
    state.consumerToTraKey.delete(absPath);
    // Leave empty traFileKey entries in `state.consumers` behind to match the
    // pre-reverse-index semantics (the old loop deleted from every set
    // unconditionally without removing keys); downstream reads handle absent
    // and empty Sets identically.
    state.consumers.get(previousKey)?.delete(absPath);
}

/**
 * Build the reverse index mapping each traFileKey to consumer file paths.
 * Walks the workspace once for the union of consumer extensions (mirroring
 * workspace-scanner.ts's single-walk startup scan), then reads each file's first line to
 * check for an @tra comment, falling back to basename matching. The read fan-out is bounded
 * by WORKSPACE_SCAN_CONCURRENCY - a real mod workspace's consumer corpus can run from
 * hundreds to thousands of files, not the "tens" this comment used to assume, and an
 * unbounded synchronous read loop blocked the event loop for the whole startup scan.
 */
export async function buildConsumerIndex(state: TranslationState): Promise<void> {
    const wsRoot = state.workspaceRoot;
    if (!wsRoot) return;

    state.consumers = new Map();
    state.consumerToTraKey = new Map();

    // Determine which extensions to scan based on loaded tra data
    const hasMsg = [...state.data.keys()].some((k) => k.endsWith(".msg"));
    const hasTra = [...state.data.keys()].some((k) => k.endsWith(".tra"));

    const extsToScan: string[] = [];
    if (hasTra) {
        extsToScan.push(...CONSUMER_EXTENSIONS_TRA);
    }
    if (hasMsg) {
        extsToScan.push(...CONSUMER_EXTENSIONS_MSG);
    }

    // Deduplicate extensions
    const uniqueExts = [...new Set(extsToScan)];
    if (uniqueExts.length === 0) return;

    // A second walk of the tree the provider scan also walks (core/workspace-scanner.ts) - on a Fallout
    // workspace both globs return the identical file set. Left duplicated on purpose: the walk measures
    // 58-68 ms against a ~5.0 s startup, and sharing one list means exposing the registry's extension union
    // and reordering onInitialize, which is a reachability change for ~1% of startup. The ~4.8 s of parsing
    // inside that scan is where the time actually is.
    const files = await findFilesByExtensions(wsRoot, uniqueExts);
    const limit = pLimit(WORKSPACE_SCAN_CONCURRENCY);
    await Promise.all(
        files.map((relFile) =>
            limit(async () => {
                const absPath = path.join(wsRoot, relFile);
                await indexConsumerFile(state, absPath, relFile);
            }),
        ),
    );

    conlog(`Translation: built consumer index with ${state.consumers.size} tra/msg file mappings`);
}

/**
 * Index a single consumer file into the reverse map.
 * Reads the first 256 bytes for an @tra comment (decoded UTF-8-first with a windows-1252
 * fallback, same as the tra/msg read path in loadFiles), falls back to basename matching.
 * Async, and bounded by the pLimit pool in buildConsumerIndex, so a large consumer corpus
 * neither blocks the event loop nor floods the filesystem with unbounded concurrent opens.
 */
async function indexConsumerFile(state: TranslationState, absPath: string, wsRelPath: string): Promise<void> {
    let traFileKey: string | undefined;

    // Try reading first line for @tra comment (only 256 bytes, not the whole file)
    try {
        const handle = await fs.promises.open(absPath, "r");
        let firstLine: string;
        try {
            const buf = Buffer.alloc(256);
            const { bytesRead } = await handle.read(buf, 0, 256, 0);
            firstLine = decodeFileBytes(buf.subarray(0, bytesRead)).text.split(/\r?\n/)[0] ?? "";
        } finally {
            await handle.close();
        }
        const match = REGEX_TRA_COMMENT.exec(firstLine);
        if (match && match[1]) {
            traFileKey = match[1];
        }
    } catch {
        // File might be inaccessible, skip
        return;
    }

    // Fall back to basename matching
    if (!traFileKey && state.settings.auto_tra) {
        const basename = path.parse(wsRelPath).name;
        const ext = path.extname(absPath).toLowerCase();
        const traExt = consumerExtToTraExt(ext);
        if (traExt) {
            const candidate = `${basename}.${traExt}`;
            if (state.data.has(candidate)) {
                traFileKey = candidate;
            }
        }
    }

    if (!traFileKey) return;
    if (!state.data.has(traFileKey)) return;

    addConsumer(state, traFileKey, absPath);
}

/**
 * Bootstrap `.bgforge.yml` for a from-scratch dialog so the tra directory the editor just wrote to is
 * RECORDED - the next session's `loadDir` then scans it (this session already resolves via the in-memory
 * `state.data.set` in write-back.ts). Only CREATES the file when absent - never clobbers an existing project
 * config. Fail-soft: a write failure is logged, not thrown, since the `.msg` already persisted; only
 * reopen-time resolution would be affected. Shape matches settings.ts's reader (`mls.translation.directory`).
 */
export function ensureTraConfig(workspaceRoot: string | undefined, relDir: string): void {
    if (!workspaceRoot) return;
    const configPath = path.join(workspaceRoot, ".bgforge.yml");
    try {
        // `flag: "wx"` creates the file only if it does not already exist and fails with EEXIST
        // otherwise, so an existing project config is never clobbered - atomically, with no
        // existsSync->writeFileSync TOCTOU window.
        fs.writeFileSync(configPath, yaml.stringify({ mls: { translation: { directory: relDir } } }), {
            flag: "wx",
        });
        conlog(`Translation: created .bgforge.yml (translation.directory: ${relDir})`);
    } catch (error) {
        // File already present: the config exists, nothing to create - not a failure.
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
        conlog(`Translation: could not create .bgforge.yml: ${errorMessage(error)}`, "warn");
    }
}
