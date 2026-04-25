/**
 * Unit tests for ServerInitializingIndicator.
 *
 * Validates the timeout-driven auto-resolve path: if finishedLoadingProject
 * never fires (e.g., server crashed before LOAD_FINISHED notification),
 * the progress task must self-clear so the spinner does not persist.
 */

import { vi, describe, expect, it, beforeEach, afterEach } from "vitest";

const { withProgressMock } = vi.hoisted(() => ({
    withProgressMock: vi.fn(),
}));

vi.mock("vscode", () => {
    class FakeDisposable {}
    return {
        window: {
            get withProgress() {
                return withProgressMock;
            },
        },
        ProgressLocation: { Window: 10 },
        l10n: { t: (s: string) => s },
        Disposable: FakeDisposable,
    };
});

import { ServerInitializingIndicator } from "../src/indicator";

describe("ServerInitializingIndicator", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        withProgressMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves the progress task after the configured timeout", async () => {
        let capturedPromise: Promise<void> | undefined;
        withProgressMock.mockImplementation((_opts: unknown, task: () => Promise<void>) => {
            capturedPromise = task();
            return capturedPromise;
        });

        const indicator = new ServerInitializingIndicator(50);
        indicator.startedLoadingProject("p");

        expect(withProgressMock).toHaveBeenCalledTimes(1);
        expect(capturedPromise).toBeInstanceOf(Promise);

        let resolved = false;
        capturedPromise!.then(() => {
            resolved = true;
        });

        await vi.advanceTimersByTimeAsync(49);
        // Allow microtask flush; promise should still be pending.
        await Promise.resolve();
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(2);
        await Promise.resolve();
        expect(resolved).toBe(true);
    });

    it("clears any pending timeout when finishedLoadingProject fires", async () => {
        let capturedPromise: Promise<void> | undefined;
        withProgressMock.mockImplementation((_opts: unknown, task: () => Promise<void>) => {
            capturedPromise = task();
            return capturedPromise;
        });

        const indicator = new ServerInitializingIndicator(50);
        indicator.startedLoadingProject("p");

        let resolved = false;
        capturedPromise!.then(() => {
            resolved = true;
        });

        indicator.finishedLoadingProject("p");
        await Promise.resolve();
        expect(resolved).toBe(true);

        // Advance past the timeout — no error and no double-resolve consequences.
        await vi.advanceTimersByTimeAsync(100);
    });
});
