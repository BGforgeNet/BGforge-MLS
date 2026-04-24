/**
 * FileWatcherManager - manages file extension routing and workspace file change events.
 *
 * Responsible for:
 * - Building the extension -> provider map from registered providers
 * - Generating LSP watch patterns for client registration
 * - Routing watched-file change events to the correct provider
 * - Cleaning up per-document data on document close
 *
 * The registry (or a minimal interface of it) is passed to handler methods
 * rather than stored, to avoid circular ownership.
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileChangeType, WatchKind } from "vscode-languageserver/node";
import type { LanguageProvider } from "../language-provider";
import { conlog } from "../common";
import { normalizeUri } from "./normalized-uri";

/**
 * Minimal interface required by the file watcher for provider access.
 * Avoids a direct circular dependency on ProviderRegistry.
 */
interface FileWatcherRegistryAccess {
    get(langId: string): LanguageProvider | undefined;
}

export class FileWatcherManager {
    /** Maps indexed file extensions (lowercased, with dot) to their provider. */
    private extensionToProvider: Map<string, LanguageProvider> = new Map();

    /**
     * Build the extension -> provider map from all providers' indexExtensions.
     * Must be called after providers are registered and initialized.
     */
    buildExtensionMap(providers: Iterable<LanguageProvider>): void {
        this.extensionToProvider.clear();
        for (const provider of providers) {
            if (!provider.indexExtensions) continue;
            for (const ext of provider.indexExtensions) {
                this.extensionToProvider.set(ext.toLowerCase(), provider);
            }
        }
        conlog(`Built extension map with ${this.extensionToProvider.size} extensions`);
    }

    /**
     * Get watch patterns for LSP registration.
     * Collects all indexed extensions and converts to glob patterns.
     */
    getWatchPatterns(providers: Iterable<LanguageProvider>): { globPattern: string; kind: number }[] {
        const patterns: { globPattern: string; kind: number }[] = [];
        const watchAll = WatchKind.Create | WatchKind.Change | WatchKind.Delete;

        for (const provider of providers) {
            if (!provider.indexExtensions) continue;
            for (const ext of provider.indexExtensions) {
                patterns.push({
                    globPattern: `**/*${ext}`,
                    kind: watchAll,
                });
            }
        }
        return patterns;
    }

    /**
     * Handle a file change event from the workspace.
     * Routes to the appropriate provider based on file extension.
     */
    handleWatchedFileChange(uri: string, changeType: FileChangeType): void {
        const normUri = normalizeUri(uri);
        const filePath = fileURLToPath(normUri);
        const ext = extname(filePath).toLowerCase();
        const provider = this.extensionToProvider.get(ext);

        if (!provider) {
            return;
        }

        if (changeType === FileChangeType.Deleted) {
            if (provider.onWatchedFileDeleted) {
                provider.onWatchedFileDeleted(normUri);
                conlog(`File deleted, cleared from index: ${filePath}`);
            }
        } else {
            // Created or Changed - reload the file data
            try {
                const text = readFileSync(filePath, "utf-8");
                if (provider.reloadFileData) {
                    provider.reloadFileData(normUri, text);
                    conlog(
                        `File ${changeType === FileChangeType.Created ? "created" : "changed"}, reloaded: ${filePath}`,
                    );
                }
            } catch (error) {
                conlog(`Failed to read file ${filePath}: ${error}`);
            }
        }
    }

    /**
     * Handle document close event.
     * Clears per-document cached data (self maps) to avoid memory leaks.
     */
    handleDocumentClosed(langId: string, uri: string, registry: FileWatcherRegistryAccess): void {
        const normUri = normalizeUri(uri);
        const provider = registry.get(langId);
        if (provider?.onDocumentClosed) {
            provider.onDocumentClosed(normUri);
        }
    }
}
