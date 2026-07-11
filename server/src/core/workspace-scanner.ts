/**
 * WorkspaceScanner - scans workspace files at startup and indexes them via providers.
 *
 * Finds files matching each provider's indexExtensions and calls reloadFileData
 * so providers have a populated index before the first user request.
 *
 * This keeps startup indexing, file-watching reloads, and delete cleanup on the
 * same contract (all go through reloadFileData / onWatchedFileDeleted).
 */

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import pLimit from "p-limit";
import type { LanguageProvider } from "../language-provider";
import { conlog } from "../logger";
import { findFilesByExtensions, WORKSPACE_SCAN_CONCURRENCY } from "../path-utils";
import { pathToUri } from "../uri-utils";

/**
 * Minimal interface required by the scanner for reloading file data.
 * Avoids a direct circular dependency on ProviderRegistry.
 */
interface WorkspaceScannerRegistryAccess {
    reloadFileData(langId: string, uri: string, text: string): void;
}

/** Normalize a provider index extension (or a discovered path's extension) to lowercase, no leading dot. */
function normalizeExt(ext: string): string {
    return (ext.startsWith(".") ? ext.slice(1) : ext).toLowerCase();
}

/**
 * Scan workspace for indexed files and reload them through their providers.
 * Called after providers are initialized to populate indices at startup.
 *
 * Walks the workspace tree ONCE for the union of all providers' extensions, then
 * dispatches each hit to its provider by extension. The previous per-(provider,
 * extension) loop re-walked the whole tree N times and read every match with
 * unbounded concurrency; both are the confirmed cause of multi-GB RSS on large
 * mod workspaces. The single walk applies `WORKSPACE_SCAN_IGNORE` (via
 * `findFilesByExtensions`) and the read fan-out is bounded by the shared
 * `WORKSPACE_SCAN_CONCURRENCY`.
 */
export async function scanWorkspaceFiles(
    providers: Iterable<LanguageProvider>,
    registry: WorkspaceScannerRegistryAccess,
    workspaceRoot: string | undefined,
): Promise<void> {
    if (!workspaceRoot) {
        return;
    }

    const extToProvider = new Map<string, LanguageProvider>();
    for (const provider of providers) {
        if (!provider.indexExtensions || !provider.reloadFileData) {
            continue;
        }
        for (const ext of provider.indexExtensions) {
            extToProvider.set(normalizeExt(ext), provider);
        }
    }
    if (extToProvider.size === 0) {
        return;
    }

    const files = await findFilesByExtensions(workspaceRoot, [...extToProvider.keys()]);

    const limit = pLimit(WORKSPACE_SCAN_CONCURRENCY);
    const scanned = new Map<string, number>();
    const failed = new Map<string, number>();

    await Promise.all(
        files.map((relativePath) =>
            limit(async () => {
                const ext = normalizeExt(extname(relativePath));
                const provider = extToProvider.get(ext);
                if (!provider) {
                    return;
                }
                scanned.set(ext, (scanned.get(ext) ?? 0) + 1);
                try {
                    const absolutePath = join(workspaceRoot, relativePath);
                    const uri = pathToUri(absolutePath);
                    const text = await readFile(absolutePath, "utf-8");
                    registry.reloadFileData(provider.id, uri, text);
                } catch {
                    failed.set(ext, (failed.get(ext) ?? 0) + 1);
                }
            }),
        ),
    );

    for (const [ext, count] of scanned) {
        const providerId = extToProvider.get(ext)?.id;
        const failures = failed.get(ext) ?? 0;
        if (failures > 0) {
            conlog(`Startup scan for ${providerId} (.${ext}) had ${failures} read failures`);
        }
        if (count > 0) {
            conlog(`Scanned ${count} .${ext} files for ${providerId}`);
        }
    }
}
