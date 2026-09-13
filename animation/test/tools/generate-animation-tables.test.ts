/**
 * `bg2.ts`'s header promises its generated rows are re-derived from a real Enhanced Edition install rather
 * than transcribed. Nothing else runs the generator's own `--check`, so this is what backs that promise
 * when the corpus is present - gated the same way the animation package's other real-install suites already
 * gate on `BGFORGE_IE_GAME`.
 *
 * Gated on the install's FAMILY, not merely on it being an Enhanced Edition. A classic install ships no
 * animation INIs and would report every row as drift; a BG:EE one ships INIs for the same ids under its own
 * answers, so it reports drift on exactly the rows where the two games disagree - two of them, which read as
 * a defect in the table rather than as the wrong install. Both were misreadings this gate handed out before
 * it asked which game it was pointed at.
 */
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";
import { tsxCommand } from "../../../shared/tsx-command.ts";

const EE_GAME = process.env.BGFORGE_IE_GAME;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
/** The Enhanced Editions of the family `bg2.ts` is the table for - the only installs that can judge it. */
const BG2_FAMILY = new Set(["bg2ee", "eet"]);
const FLAVOUR = EE_GAME === undefined ? undefined : openGame(EE_GAME).identity.flavour;

describe.skipIf(FLAVOUR === undefined || !BG2_FAMILY.has(FLAVOUR))(
    "the vendored bg2 table against a real EE install of its own family",
    () => {
        it("carries no drift from what the install declares", () => {
            const { file, args } = tsxCommand("animation/test/tools/generate-animation-tables.ts", [
                "--table",
                "bg2",
                "--ee",
                EE_GAME!,
                "--check",
            ]);
            const result = spawnSync(file, args, { cwd: REPO_ROOT, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });

            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
        });
    },
);
