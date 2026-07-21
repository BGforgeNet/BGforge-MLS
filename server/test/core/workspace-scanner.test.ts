/**
 * Tests for workspace-scanner.ts - the startup indexing walk.
 *
 * The scan runs in the background behind the initialize handshake, so beyond
 * indexing correctness (covered via provider-registry tests) it must keep the
 * event loop responsive: per-file parsing is synchronous, and without an
 * explicit yield between files the whole backgrounded walk still runs as one
 * unbroken microtask cascade that starves every queued macrotask (the LSP
 * connection included) until the last file is parsed.
 */

import { describe, expect, it, vi } from "vitest";
import type { LanguageProvider } from "../../src/language-provider";
import { scanWorkspaceFiles } from "../../src/core/workspace-scanner";

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

vi.mock("../../src/path-utils", () => ({
    findFilesByExtensions: vi.fn(),
    WORKSPACE_SCAN_CONCURRENCY: 4,
}));

vi.mock("../../src/uri-utils", () => ({
    pathToUri: (p: string) => `file://${p}`,
}));

vi.mock("node:fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue("mock file content"),
}));

function scannerProvider(reload: () => void): LanguageProvider {
    return {
        id: "test",
        indexExtensions: [".tph"],
        reloadFileData: reload,
    } as unknown as LanguageProvider;
}

describe("scanWorkspaceFiles", () => {
    it("yields the event loop between per-file parses", async () => {
        const files = Array.from({ length: 8 }, (_, i) => `lib/f${i}.tph`);
        const { findFilesByExtensions } = await import("../../src/path-utils");
        vi.mocked(findFilesByExtensions).mockResolvedValue(files);

        // Interleaving oracle: a macrotask chain started before the scan must get
        // turns BETWEEN file parses. Without the per-file yield the scan's await
        // chain is pure microtasks, so the first tick only runs after the last
        // file - deterministic ordering, no timing involved.
        const order: string[] = [];
        let scanning = true;
        const tick = (): void => {
            order.push("tick");
            if (scanning) {
                setImmediate(tick);
            }
        };
        setImmediate(tick);

        const registry = { reloadFileData: () => order.push("file") };
        await scanWorkspaceFiles([scannerProvider(() => undefined)], registry, "/root");
        scanning = false;

        const firstTick = order.indexOf("tick");
        const lastFile = order.lastIndexOf("file");
        expect(order.filter((e) => e === "file")).toHaveLength(files.length);
        expect(firstTick).toBeGreaterThanOrEqual(0);
        expect(firstTick).toBeLessThan(lastFile);
    });
});
