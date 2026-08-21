/**
 * The ts-morph project a compile runs in, and how it is kept across compiles.
 *
 * Building one costs over a second - overwhelmingly TypeScript's own parser and binder, against which
 * lowering a script is under 2% - so a caller that compiles more than once reuses a project rather than
 * paying that again per file. What reuse costs in return is freshness: a project holds the dependencies
 * it parsed, and will not notice one of them changing on disk. `prepareEntry` is what settles that,
 * which is why every front end goes through it instead of creating its own source file.
 */

import * as fs from "fs";
import { Project, type SourceFile } from "ts-morph";
import type { InlineFunctionCache } from "./inline-functions";
import { shadowEntryPath, TSSL_COMPILER_OPTIONS, type ModuleWalkCache } from "./program-model";

/**
 * Shared state for compiling more than one file, or one file more than once.
 * Reusing a project avoids re-initializing the TypeScript compiler for each compile; the inline
 * function cache avoids re-walking shared imports (e.g. folib).
 */
export interface TranspileBatchState {
    readonly project: Project;
    readonly inlineFunctionCache: InlineFunctionCache;
    /** What each imported module contributed, so a second compile does not walk it again. */
    readonly moduleWalkCache: ModuleWalkCache;
    /** Size and mtime of each dependency as this project last read it, keyed by absolute path. */
    readonly seen: Map<string, string>;
}

/** Create a batch state for compiling multiple files, or one file repeatedly. */
export function createBatchState(): TranspileBatchState {
    return {
        project: new Project({ compilerOptions: TSSL_COMPILER_OPTIONS }),
        inlineFunctionCache: new Map(),
        moduleWalkCache: new Map(),
        seen: new Map(),
    };
}

/**
 * Re-reads any dependency whose file on disk no longer matches what the project parsed, and records
 * what every other one currently looks like.
 *
 * Recording is why this also runs AFTER the dependency closure is resolved: a file first pulled in by
 * this compile has nothing to be compared against yet, and without a baseline taken then, the compile
 * that follows would read its change as its first sighting and keep the stale parse.
 */
function syncDependencies(batch: TranspileBatchState): void {
    for (const source of batch.project.getSourceFiles()) {
        const filePath = source.getFilePath();
        let stamp: string;
        try {
            const stat = fs.statSync(filePath);
            stamp = `${stat.mtimeMs}:${stat.size}`;
        } catch {
            // Nothing on disk: the shadow entry, which `prepareEntry` overwrites anyway, or a
            // dependency that has been deleted. Either way its resolve pass settles this.
            continue;
        }
        const previous = batch.seen.get(filePath);
        batch.seen.set(filePath, stamp);
        if (previous !== undefined && previous !== stamp) {
            source.refreshFromFileSystemSync();
            batch.inlineFunctionCache.delete(filePath);
            batch.moduleWalkCache.delete(filePath);
        }
    }
}

/**
 * Installs `text` as the compilation entry and returns it, with the project's view of everything else
 * brought up to date first.
 *
 * The refresh runs BEFORE the entry is written, so a buffer holding unsaved edits cannot be replaced by
 * what is still on disk. The entry's own cache line is dropped unconditionally: its path does not change
 * between compiles, so nothing else would notice that its text did.
 */
export function prepareEntry(batch: TranspileBatchState, filePath: string, text: string): SourceFile {
    const shadowPath = shadowEntryPath(filePath);
    syncDependencies(batch);
    batch.inlineFunctionCache.delete(shadowPath);
    // The buffer's text compiles as the file at `filePath`, which is never read - the shadow name is
    // what lets the checker resolve its imports (it does not resolve from an extension it does not
    // know), and the model reports everything against the real path.
    const entry = batch.project.createSourceFile(shadowPath, text, { overwrite: true });
    // Pulls the dependency closure into the project, so imports resolve to source files.
    batch.project.resolveSourceFileDependencies();
    syncDependencies(batch);
    return entry;
}

// Skipping the dependency re-resolve on an unchanged re-compile was measured and dropped: 6 ms, and it
// loses a module outright when an entry's imports change between compiles - the resolve is what pulls
// the new one in.
