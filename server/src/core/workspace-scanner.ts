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
import { join } from "node:path";
import type { LanguageProvider } from "../language-provider";
import { conlog, findFiles, pathToUri } from "../common";

/**
 * Minimal interface required by the scanner for reloading file data.
 * Avoids a direct circular dependency on ProviderRegistry.
 */
interface WorkspaceScannerRegistryAccess {
    reloadFileData(langId: string, uri: string, text: string): void;
}

/**
 * Scan workspace for indexed files and reload them through their providers.
 * Called after providers are initialized to populate indices at startup.
 */
export async function scanWorkspaceFiles(
    providers: Iterable<LanguageProvider>,
    registry: WorkspaceScannerRegistryAccess,
    workspaceRoot: string | undefined,
): Promise<void> {
    if (!workspaceRoot) {
        return;
    }

    for (const provider of providers) {
        if (!provider.indexExtensions || !provider.reloadFileData) {
            continue;
        }

        for (const ext of provider.indexExtensions) {
            // Remove leading dot for findFiles (e.g., ".tph" -> "tph")
            const extWithoutDot = ext.startsWith(".") ? ext.slice(1) : ext;
            const files = findFiles(workspaceRoot, extWithoutDot);

            // Per-extension loop; inner Promise.allSettled already parallelizes
            // the file scan within each extension.
            // eslint-disable-next-line no-await-in-loop
            const results = await Promise.allSettled(
                files.map(async (relativePath) => {
                    const absolutePath = join(workspaceRoot, relativePath);
                    const uri = pathToUri(absolutePath);
                    const text = await readFile(absolutePath, "utf-8");
                    registry.reloadFileData(provider.id, uri, text);
                }),
            );

            const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failures.length > 0) {
                conlog(`Startup scan for ${provider.id} (${ext}) had ${failures.length} read failures`);
            }
            if (files.length > 0) {
                conlog(`Scanned ${files.length} ${ext} files for ${provider.id}`);
            }
        }
    }
}
