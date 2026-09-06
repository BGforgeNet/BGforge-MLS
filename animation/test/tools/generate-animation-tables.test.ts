/**
 * `bg2.ts`'s header promises its generated rows are re-derived from a real Enhanced Edition install rather
 * than transcribed. Nothing else runs the generator's own `--check`, so this is what backs that promise
 * when the corpus is present - gated the same way the animation package's other real-install suites already
 * gate on `BGFORGE_IE_GAME`.
 *
 * A CLASSIC install ships no animation INIs at all and would report every row as drift: point
 * `BGFORGE_IE_GAME` at an Enhanced Edition install to run this.
 */
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const EE_GAME = process.env.BGFORGE_IE_GAME;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe.skipIf(EE_GAME === undefined)("the vendored bg2 table against a real EE install", () => {
    it("carries no drift from what the install declares", () => {
        const result = spawnSync(
            "pnpm",
            [
                "exec",
                "tsx",
                "animation/test/tools/generate-animation-tables.ts",
                "--table",
                "bg2",
                "--ee",
                EE_GAME!,
                "--check",
            ],
            { cwd: REPO_ROOT, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS },
        );

        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
    });
});
