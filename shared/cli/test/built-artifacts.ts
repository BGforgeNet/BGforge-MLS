/**
 * Gate for suites that need a build artifact (a generated grammar wasm, node-types, the completion
 * JSON) rather than an optional external corpus.
 *
 * `describe.skipIf(!existsSync(artifact))` reads as caution but fails open: `scripts/test.sh` builds
 * only the transpile bundle, so on a tree where the grammars or `server/data` outputs have not been
 * built, whole suites vanish and the run still reports green - an omission that reads as an all-clear.
 * The absence is never an environment limit either; the artifact is one documented build away.
 *
 * So: say what was skipped and why, and make it a hard failure wherever the run is a gate
 * (`scripts/test-all.sh` and CI set MLS_REQUIRE_BUILT_ARTIFACTS=1). Suites gated on a genuinely
 * optional input - a gitignored `external/` corpus, an absent third-party binary - keep using a plain
 * existence check; those really can be unavailable, and this helper is not for them.
 */

import { existsSync } from "fs";

/** Set by the canonical gate; absence of an artifact is then a failure, not a skip. */
const STRICT_ENV = "MLS_REQUIRE_BUILT_ARTIFACTS";

/**
 * True when every path exists. Otherwise names the missing ones on stderr and returns false - or
 * throws, when the run has declared itself a gate.
 *
 * @param paths Absolute paths to the artifacts the suite reads.
 * @param buildCommand What produces them, quoted back to whoever has to run it.
 */
export function builtArtifactsPresent(paths: readonly string[], buildCommand: string): boolean {
    const missing = paths.filter((p) => !existsSync(p));
    if (missing.length === 0) return true;

    const detail = `missing build artifact(s): ${missing.join(", ")} - run \`${buildCommand}\``;
    if (process.env[STRICT_ENV] === "1") {
        throw new Error(`${detail} (${STRICT_ENV}=1)`);
    }
    console.warn(`[suite skipped] ${detail}`);
    return false;
}
