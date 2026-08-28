/**
 * The two runtime properties of the bundler that no other test here can observe, because every other
 * test runs in this repo's own process with a full PATH and whatever binding a dev machine installed.
 *
 * 1. It needs nothing on PATH. An editor ships its own runtime and may expose no `node` at all; the
 *    previous bundler could not run its wasm in-process and spawned `node <bin/esbuild>` through a bare
 *    PATH lookup, which is why `node-runtime.ts` existed to plant a shim. rolldown runs in-process, so
 *    the shim is gone - and this is what keeps it gone.
 * 2. It works through the wasm32-wasi binding. That is the only binding the VSIX ships, because a
 *    platform-neutral artifact cannot carry fifteen native ones; a dev machine installs a native
 *    binding, which rolldown's loader prefers, so the shipped path runs nowhere else in this suite.
 *    `NAPI_RS_WASI_FLAVOR` is the fail-loud form - `NAPI_RS_FORCE_WASI=true` falls back to native when
 *    the wasi binding is missing, which would make this test pass while proving nothing.
 *    `NAPI_RS_ENFORCE_VERSION_CHECK` rides along: a napi binding is ABI-locked to the version that
 *    generated it, and the binding is pinned by hand in two places (the catalog entry and the
 *    packageExtensions entry that puts it where rolldown's loader looks), neither of which any
 *    resolver keeps in step with rolldown's own version. Without the check a mismatched pair loads and
 *    works until the ABI actually moves.
 *
 * Both drive the built bundle in a child process rather than importing the source: the binding loads
 * once per process, so the choice can only be made before the process starts.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT } from "./repo-root";
import { SPAWN_TIMEOUT_MS } from "../../shared/spawn-timeout";

const BUNDLE = path.join(REPO_ROOT, "transpilers/out/index.js");
const ENTRY = path.join(REPO_ROOT, "transpilers/test/fixtures/iets-shape/main.tbaf");

/** Transpile the import-bearing fixture in a child process under `env`, and return what it emitted. */
function transpileIn(env: NodeJS.ProcessEnv): string {
    const script = `
        import * as fs from "node:fs";
        import { transpile } from ${JSON.stringify(BUNDLE)};
        const entry = ${JSON.stringify(ENTRY)};
        const { output } = await transpile(entry, fs.readFileSync(entry, "utf-8"));
        process.stdout.write(output);
    `;
    // --no-warnings silences the wasi binding's "WASI is an experimental feature" notice, which is
    // expected on that leg and would otherwise be noise in a passing run.
    return execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: SPAWN_TIMEOUT_MS,
        env,
    });
}

/**
 * A line only a real bundle of this fixture produces: the enum member comes from an externalised
 * `.d.ts` and the call from an imported module, so neither survives without cross-file resolution.
 * An empty or partial run cannot pass.
 */
const BUNDLED_MARKER = "Polymorph(MAGE_MALE_HUMAN)";

describe("the bundler's runtime requirements", () => {
    beforeAll(() => {
        if (!fs.existsSync(BUNDLE)) {
            throw new Error(`Bundle missing at ${BUNDLE}. Run: pnpm build:transpile`);
        }
    });

    it("bundles an import-bearing file with nothing on PATH", () => {
        // Everything else is dropped too, not just PATH: an inherited NAPI_RS_* or NODE_OPTIONS would
        // decide the binding, and this case is about the default one.
        const code = transpileIn({ PATH: "" });

        expect(code).toContain(BUNDLED_MARKER);
    });

    it("bundles through the wasm32-wasi binding the VSIX ships, at rolldown's own version", () => {
        const code = transpileIn({
            ...process.env,
            NAPI_RS_WASI_FLAVOR: "wasm32-wasi",
            NAPI_RS_ENFORCE_VERSION_CHECK: "1",
        });

        expect(code).toContain(BUNDLED_MARKER);
    });

    it("emits identical output whichever binding is loaded", () => {
        const native = transpileIn({ ...process.env });
        const wasi = transpileIn({ ...process.env, NAPI_RS_WASI_FLAVOR: "wasm32-wasi" });

        expect(wasi).toBe(native);
        // Positive control: two empty runs would also be equal, and would pass for the wrong reason.
        expect(native).toContain(BUNDLED_MARKER);
    });
});
