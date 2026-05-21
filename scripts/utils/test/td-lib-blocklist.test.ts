/**
 * CI guard for the TD plugin's ES lib blocklist. The blocklist hides ES
 * built-in globals from completion in .td files; it must stay aligned with
 * the project's pinned TypeScript so new globals introduced by a TS bump
 * don't silently leak through.
 *
 * Runs the generator in --check mode. If the committed blocklist diverges
 * from what the current TypeScript lib produces, the test fails with a
 * pointer to `pnpm regen:td-blocklist`.
 */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("ES_LIB_BLOCKLIST", () => {
    it("matches the current TypeScript lib (run pnpm regen:td-blocklist if this fails)", () => {
        const result = spawnSync(
            "pnpm",
            ["exec", "tsx", "scripts/utils/src/generate-td-lib-blocklist.ts", "--check"],
            { cwd: process.cwd(), encoding: "utf8" },
        );
        if (result.status !== 0) {
            const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
            throw new Error(out.trim() || "generate-td-lib-blocklist --check failed without output");
        }
        expect(result.status).toBe(0);
    }, 60_000);
});
