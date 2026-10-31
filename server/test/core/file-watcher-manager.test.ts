/**
 * Tests for core/file-watcher-manager.ts - reloading a watched file that changed on disk.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileChangeType } from "vscode-languageserver/node";
import type { LanguageProvider } from "../../src/language-provider";

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import { FileWatcherManager } from "../../src/core/file-watcher-manager";

describe("FileWatcherManager.handleWatchedFileChange", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "file-watcher-manager-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("decodes a changed file that is not valid UTF-8 as windows-1252", async () => {
        const filePath = join(dir, "legacy.tph");
        // "caf" then 0xE9, which is "e acute" in windows-1252 and a truncated sequence in UTF-8.
        writeFileSync(filePath, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
        const reloaded: string[] = [];
        // Only the members the watcher reads; the rest of the provider surface is irrelevant here.
        const provider = {
            id: "test",
            indexExtensions: [".tph"],
            reloadFileData: (_uri: string, text: string) => reloaded.push(text),
        } as unknown as LanguageProvider;
        const manager = new FileWatcherManager();
        manager.buildExtensionMap([provider]);

        await manager.handleWatchedFileChange(pathToFileURL(filePath).href, FileChangeType.Changed);

        expect(reloaded).toEqual(["caf\u00E9"]);
    });
});
