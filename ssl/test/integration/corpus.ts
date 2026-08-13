/**
 * The Restoration Project script corpus, shared by the suites that sweep it.
 *
 * The size is pinned because the corpus is not stable while the test suite runs: `scripts/test-external.sh`
 * deletes every path in `external/fallout-exclude.txt` for the duration of its own run and restores them
 * from git in an EXIT trap. Forty-two of those are scripts under `scripts_src`, so anything reading the
 * corpus inside that window silently sweeps a smaller set - the counts all stay plausible and every gate
 * measured against them quietly weakens. Asserting the size turns that into a named failure.
 *
 * Raise `CORPUS_SIZE` when the pinned external checkout genuinely grows; never lower it to accommodate a
 * run that saw fewer, which is the symptom this exists to catch.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

export const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");

export const CORPUS_SIZE = 1525;

/** Every corpus script, sorted. `template` holds deliberately malformed inputs; `sfall` is a header symlink. */
export function listScripts(): string[] {
    if (!fs.existsSync(RP_SCRIPTS)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(RP_SCRIPTS)) {
        if (entry === "template" || entry === "sfall") continue;
        const dir = path.join(RP_SCRIPTS, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (file.toLowerCase().endsWith(".ssl")) out.push(path.join(dir, file));
        }
    }
    return out.sort();
}
