/**
 * Drift guard for the root `vitest.config.ts` project list.
 *
 * That config aggregates the per-package suites so `vitest run` (and `--project <name>`) works from the repo
 * root; it is additive, not what `scripts/test.sh` drives. Because nothing else reads it, a new package's
 * config is easy to forget - and the failure is silent, since a root run just executes fewer suites and still
 * reports green. `image` and `compilers/ssl` had both drifted out of it.
 *
 * So: every `vitest*.config.ts` in the repo is either listed there or named below with a reason.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

/** Configs deliberately outside the aggregate, and why. */
const EXCLUDED: Readonly<Record<string, string>> = {
    // The aggregate's own file.
    "vitest.config.ts": "the aggregate itself",
    // Stryker drives this one (stryker.conf.json `vitest.configFile`); it reruns the unit suite under mutants.
    "server/vitest.mutation.config.ts": "driven by Stryker, not a standalone suite",
    // Minutes-long corpus sweeps against committed oracles, gated to the close-out tier by scripts/test-all.sh.
    // A root `vitest run` is a dev-loop gesture and must not turn into that.
    "compilers/ssl/vitest.integration.config.ts": "close-out corpus sweep, too slow for an aggregate run",
};

// Anchored to this file, not cwd: every vitest config in the repo must run from any directory.
const root = path.resolve(__dirname, "..", "..", "..");

const configs = execSync("git ls-files -- '*vitest*.config.ts'", {
    cwd: root,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
})
    .split("\n")
    .filter(Boolean);

const listed: readonly string[] = (() => {
    const source = fs.readFileSync(path.join(root, "vitest.config.ts"), "utf8");
    return [...source.matchAll(/"([^"]*vitest[^"]*\.config\.ts)"/g)].map((m) => m[1]!);
})();

describe("root vitest.config.ts project list", () => {
    it("finds configs to check, so a broken glob cannot pass this vacuously", () => {
        expect(configs.length).toBeGreaterThan(10);
        expect(listed.length).toBeGreaterThan(10);
    });

    it.each(configs)("%s is aggregated or excluded with a reason", (config) => {
        // Every config is either aggregated by the root vitest config or carries a non-empty exclusion
        // reason. Asserted as one disjunction so both halves run on every row.
        const reason = EXCLUDED[config];
        const satisfied = reason === undefined ? listed.includes(config) : reason !== "";
        expect(satisfied, `${config}: not aggregated and no exclusion reason`).toBe(true);
    });

    it("lists no config that has been renamed or deleted", () => {
        const missing = listed.filter((config) => !fs.existsSync(path.join(root, config)));
        expect(missing).toEqual([]);
    });

    it("excludes nothing that no longer exists", () => {
        const stale = Object.keys(EXCLUDED).filter((config) => !fs.existsSync(path.join(root, config)));
        expect(stale).toEqual([]);
    });
});
