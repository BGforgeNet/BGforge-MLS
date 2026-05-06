/**
 * Shared file-derived ParseOptions builder.
 *
 * `ParseOptions` has two distinct axes:
 *   - **File-derived** — values that are a function of where the file sits
 *     on disk (which sibling resources exist, which mod tree it belongs to).
 *     Must agree across frontends; divergence here is always a bug.
 *   - **Frontend-preference** — values that legitimately differ per caller
 *     (`skipMapTiles` for editor render perf, `gracefulMapBoundaries` for
 *     CLI flag exposure). These stay per-frontend.
 *
 * This module owns the file-derived axis. Both the CLI and the VS Code
 * editor call `buildFileDerivedParseOptions(filePath)` and merge their own
 * preferences on top. Adding a new file-derived behavior — e.g. scanning
 * a sibling manifest for proto-search-path overrides — is a single edit
 * here that propagates to every caller.
 *
 * Today the only file-derived option is `pidResolver`, auto-loaded from
 * `<mapDir>/../proto/` (the standard Fallout 2 mod tree layout). When the
 * sibling tree exists and contains at least one matching .pro file, the
 * builder layers a filesystem resolver over the bundled vanilla defaults so
 * MAP decoding covers modded pids. Otherwise it returns empty options and
 * `parser.parse` falls back to its own bundled-table default.
 */

import * as fs from "fs";
import * as path from "path";
import { resolvePidSubType } from "./pid-resolver";
import { loadProDirResolver, composePidResolvers, type ProResolverStats } from "./pro-resolver-loader";
import type { ParseOptions } from "./types";

export interface FileDerivedDiagnostics {
    /** Absolute path of the proto/ tree that was scanned. */
    readonly protoDir: string;
    /** Stats reported by `loadProDirResolver` — files scanned, errors, duration. */
    readonly stats: ProResolverStats;
}

export interface FileDerivedParseOptions extends Pick<ParseOptions, "pidResolver"> {
    /**
     * Optional diagnostics from filesystem-touching scans (e.g. proto/ load
     * stats). Frontends use this for stderr or status-line logging; the
     * parser itself never reads it.
     */
    readonly diagnostics?: FileDerivedDiagnostics;
}

/**
 * Build the file-derived axis of ParseOptions for `filePath`. Returns
 * empty options when there is nothing on disk to enrich the parse with.
 */
export function buildFileDerivedParseOptions(filePath: string): FileDerivedParseOptions {
    if (path.extname(filePath).toLowerCase() !== ".map") {
        return {};
    }

    const protoBaseDir = path.resolve(path.dirname(filePath), "..", "proto");
    if (!fs.existsSync(protoBaseDir)) {
        return {};
    }

    const { resolver, stats } = loadProDirResolver(protoBaseDir);
    if (stats.filesScanned === 0) {
        return {};
    }

    return {
        pidResolver: composePidResolvers(resolver, resolvePidSubType),
        diagnostics: { protoDir: protoBaseDir, stats },
    };
}
