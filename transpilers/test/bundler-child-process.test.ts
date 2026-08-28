/**
 * The bundler runs in-process - it needs no `node` on PATH and installs no shim to guarantee one.
 *
 * esbuild-wasm's Node build cannot run its wasm in-process, so it spawns `node <bin/esbuild>` through a
 * bare PATH lookup. `node-runtime.ts` exists solely to make that lookup safe: it writes a `node` shim
 * pointing at `process.execPath` into a temp dir and prepends that dir to PATH, because an editor ships
 * its own runtime and PATH's `node` may be absent or a broken shim. The workaround is sound, but the
 * dependency is real and invisible to every other test here, which all run where `node` is on PATH.
 *
 * The PATH mutation is the observable, not a spied `spawn`: mocking `child_process` does not reach a
 * dependency vitest loads outside the transformed graph, and a test built on that mock passes whether
 * or not the spawn happens. This asserts a side effect the bundler really leaves behind.
 *
 * Its own file so the bundler's one-time init happens here rather than in an earlier test's process.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { bundle } from "../common/bundle";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "transpilers/test/fixtures/iets-shape");
const ENTRY = path.join(FIXTURE, "main.tbaf");

/** The isolated dir `ensureNodeOnPath` creates, identified by the prefix it mkdtemps with. */
function nodeShimDirsOnPath(): string[] {
    return (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.includes("bgforge-node-"));
}

describe("the bundler's runtime dependencies", () => {
    it("bundles an import-bearing file without installing a node shim on PATH", async () => {
        expect(nodeShimDirsOnPath()).toEqual([]);

        const { code } = await bundle(ENTRY, fs.readFileSync(ENTRY, "utf-8"));

        // Positive control: a bundle that produced nothing would also install nothing, and would pass
        // the real assertion for the wrong reason.
        expect(code).toContain("ObjectRef = class");
        expect(nodeShimDirsOnPath()).toEqual([]);
    });
});
