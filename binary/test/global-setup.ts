/**
 * Vitest globalSetup for the binary suite.
 *
 * Live dev:web / code-server sessions open real fixtures under external/ and
 * can leave them mutated (edited bytes, or a saved .json snapshot alongside a
 * .pro/.map). A dirty fixture then fails a later round-trip test with a
 * confusing byte-mismatch assertion instead of a clear "fixtures need a
 * reset" signal. Detect drift once per run and reset it automatically,
 * mirroring what scripts/reset-external.sh already does for the whole repo.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOTS = [path.join(REPO_ROOT, "external/fallout"), path.join(REPO_ROOT, "external/infinity-engine")];

/** Mirrors reset-external.sh's own `[[ -d "$dir/.git" ]]` checkout test. */
function isGitCheckout(dir: string): boolean {
    const gitPath = path.join(dir, ".git");
    return fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory();
}

function isDirty(checkoutDir: string): boolean {
    const status = execFileSync("git", ["-C", checkoutDir, "status", "--porcelain"], { encoding: "utf-8" });
    return status.trim().length > 0;
}

export default function setup(): void {
    const roots = EXTERNAL_ROOTS.filter((root) => fs.existsSync(root));
    if (roots.length === 0) return; // external/ not fetched at all - tests already skip/fail loudly

    const checkoutDirs = roots.flatMap((root) =>
        fs
            .readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, entry.name))
            .filter((dir) => isGitCheckout(dir)),
    );

    const dirty = checkoutDirs.some((dir) => isDirty(dir));
    if (!dirty) return;

    console.log("[binary] external/ fixtures have drifted from HEAD - resetting via scripts/reset-external.sh");
    execFileSync(path.join(REPO_ROOT, "scripts", "reset-external.sh"), [], { stdio: "inherit" });
}
