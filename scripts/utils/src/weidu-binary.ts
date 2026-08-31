/**
 * Resolving the WeiDU binary the differential suites drive.
 *
 * Lives here rather than beside any one of them because its callers span packages - server integration
 * tests and compilers/bcs - and a copy per package would drift the moment one learned about a new way to
 * find the binary. Same reason `vitest-coverage-config.ts` sits in this directory.
 *
 * There is no skip path, deliberately. A gate that passes by never running is the one failure mode a
 * gate must not have - the whole reason scripts/ensure-weidu.sh exists - so an absent binary is
 * provisioned rather than treated as a reason to report green.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/** Root of the project repository - mirrors test-helpers.ts, which keeps its copy private. */
const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");

/**
 * Bound for a single `--parse-check` spawn. A wedged child cannot be interrupted by vitest's own timeout,
 * which is enforced from an event loop execFileSync never yields to. A caller whose spawn does more than
 * parse one file (compiling a whole directory) sets its own.
 */
export const WEIDU_TIMEOUT_MS = 15000;

/** Provisioning may download and unpack an archive, so it gets a longer bound than a parse-check. */
const ENSURE_TIMEOUT_MS = 120000;

/** True when the given binary answers --version. */
function canRun(bin: string): boolean {
    try {
        execFileSync(bin, ["--version"], { timeout: WEIDU_TIMEOUT_MS, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * The binary to drive. scripts/test.sh, test-all.sh and CI all export WEIDU_BIN before this runs; a bare
 * vitest invocation falls back to PATH and then to provisioning the pinned, checksum-verified binary.
 * Throwing here fails the suite, which is the intent - see the file header.
 */
export function resolveWeidu(): string {
    const configured = process.env.WEIDU_BIN;
    if (configured && canRun(configured)) return configured;
    if (canRun("weidu")) return "weidu";

    const printed = execFileSync(path.join(ROOT_DIR, "scripts/ensure-weidu.sh"), {
        timeout: ENSURE_TIMEOUT_MS,
        encoding: "utf8",
    });
    // The script may print progress before the path, so the path is the last non-empty line.
    const lines = printed.split("\n").filter((line) => line.trim() !== "");
    const resolved = lines.at(-1)?.trim() ?? "";
    if (!canRun(resolved)) {
        throw new Error(`ensure-weidu.sh returned "${resolved}", which does not answer --version`);
    }
    return resolved;
}

/** Exit status off a thrown execFileSync error, narrowed rather than cast - `catch` binds `unknown`. */
export function exitStatus(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
    return typeof error.status === "number" ? error.status : undefined;
}
