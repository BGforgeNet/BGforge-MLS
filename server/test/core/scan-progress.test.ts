/**
 * The startup scan's progress as LSP work-done progress. Server-initiated progress is a request, and LSP allows
 * none before the client's `initialized` - which the scan may well start ahead of.
 */

import { describe, expect, it, vi } from "vitest";
import type { Connection } from "vscode-languageserver/node";

vi.mock("../../src/logger", () => ({ conlog: vi.fn() }));

const { workDoneScanProgress } = await import("../../src/core/scan-progress");

function fakeConnection() {
    const calls: string[] = [];
    const reporter = {
        begin: (title: string, percent?: number, message?: string) =>
            calls.push(`begin ${title} ${percent} ${message}`),
        report: (percent: number, message?: string) => calls.push(`report ${percent} ${message}`),
        done: () => calls.push("done"),
    };
    const createWorkDoneProgress = vi.fn(async () => reporter);
    // The sink reads `window.createWorkDoneProgress` alone; a whole Connection cannot be built without a transport.
    const connection = { window: { createWorkDoneProgress } } as unknown as Connection;
    return { connection, calls, createWorkDoneProgress };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const settled = (): Promise<void> =>
    new Promise((resolve) => {
        setImmediate(resolve);
    });

describe("workDoneScanProgress", () => {
    it("starts at the count reached when the client became ready, and reports each percent once", async () => {
        const { connection, calls } = fakeConnection();
        const initialized = deferred();
        const progress = workDoneScanProgress(connection, initialized.promise);

        progress.report(1, 4);
        initialized.resolve();
        await settled();
        progress.report(1, 4);
        progress.report(2, 4);
        progress.report(4, 4);
        progress.done();

        expect(calls).toEqual([
            "begin Indexing workspace 25 1/4 files",
            "report 50 2/4 files",
            "report 100 4/4 files",
            "done",
        ]);
    });

    // Before the file list is in there is no total: starting at 100% would run the bar backwards.
    it("begins at zero with no count while the total is unknown", async () => {
        const { connection, calls } = fakeConnection();
        workDoneScanProgress(connection, Promise.resolve());
        await settled();

        expect(calls).toEqual(["begin Indexing workspace 0 undefined"]);
    });

    it("creates no progress for a scan that finished before the client was ready", async () => {
        const { connection, createWorkDoneProgress } = fakeConnection();
        const initialized = deferred();
        const progress = workDoneScanProgress(connection, initialized.promise);

        progress.report(3, 3);
        progress.done();
        initialized.resolve();
        await settled();

        expect(createWorkDoneProgress).not.toHaveBeenCalled();
    });
});
