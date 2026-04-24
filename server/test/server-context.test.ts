/**
 * Tests for server-context.ts — async barrier pattern.
 *
 * The module uses module-level mutable state. Tests use vi.resetModules() and
 * re-import before each test so the barrier promise is fresh per test.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MLSsettings, ProjectSettings } from "../src/settings";
import type { Translation } from "../src/translation";

/** Minimal stub satisfying the ServerContext shape. */
function makeStubContext() {
    return {
        capabilities: { configuration: false, workspaceFolders: false, fileWatching: false },
        workspaceRoot: undefined,
        projectSettings: {} as ProjectSettings,
        settings: {} as MLSsettings,
        translation: {} as Translation,
    };
}

describe("server-context", () => {
    let initServerContext: (value: ReturnType<typeof makeStubContext>) => void;
    let getServerContext: () => Promise<ReturnType<typeof makeStubContext>>;
    let tryGetServerContext: () => ReturnType<typeof makeStubContext> | undefined;
    let updateServerSettings: (s: MLSsettings) => void;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import("../src/server-context");
        initServerContext = mod.initServerContext as typeof initServerContext;
        getServerContext = mod.getServerContext as typeof getServerContext;
        tryGetServerContext = mod.tryGetServerContext as typeof tryGetServerContext;
        updateServerSettings = mod.updateServerSettings;
    });

    describe("tryGetServerContext", () => {
        it("returns undefined before initServerContext is called", () => {
            expect(tryGetServerContext()).toBeUndefined();
        });

        it("returns the context after initServerContext is called", () => {
            const ctx = makeStubContext();
            initServerContext(ctx);
            expect(tryGetServerContext()).toBe(ctx);
        });
    });

    describe("getServerContext (async barrier)", () => {
        it("resolves after initServerContext is called — even when init arrives later", async () => {
            // Start waiting before init completes — simulates a request arriving
            // during the window between initialize and initialized.
            const promise = getServerContext();

            // Confirm it's still pending (a resolved promise settles microtasks, not
            // synchronously — but we can set up init *after* registering the waiter).
            const ctx = makeStubContext();
            initServerContext(ctx);

            const resolved = await promise;
            expect(resolved).toBe(ctx);
        });

        it("resolves immediately if initServerContext was already called", async () => {
            const ctx = makeStubContext();
            initServerContext(ctx);

            const resolved = await getServerContext();
            expect(resolved).toBe(ctx);
        });

        it("multiple concurrent callers all receive the same context", async () => {
            const p1 = getServerContext();
            const p2 = getServerContext();
            const p3 = getServerContext();

            const ctx = makeStubContext();
            initServerContext(ctx);

            const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
            expect(r1).toBe(ctx);
            expect(r2).toBe(ctx);
            expect(r3).toBe(ctx);
        });
    });

    describe("updateServerSettings", () => {
        it("throws if called before initServerContext", () => {
            expect(() => updateServerSettings({} as MLSsettings)).toThrow("ServerContext not initialized");
        });

        it("mutates settings on the live context after init", () => {
            const ctx = makeStubContext();
            initServerContext(ctx);

            const newSettings = { validate: "save" } as unknown as MLSsettings;
            updateServerSettings(newSettings);

            expect(tryGetServerContext()?.settings).toBe(newSettings);
        });
    });
});
