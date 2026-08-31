/**
 * Composition guard for the dialog editor's webview bundle.
 *
 * The webview lays its graph out in a Worker built from elkjs's worker script, which the build
 * embeds as text (scripts/esbuild-elk-worker.mjs). `elkjs/lib/elk.bundled.js` carries its OWN
 * inline copy of that same engine, so importing both ships the ELK engine twice - about 3.4 MB
 * of extra JS the webview's main thread must compile before it can paint. The API-only entry
 * (`elk-api.js`, ~10 KB) is what a caller supplying its own workerFactory needs.
 *
 * Asserted against the real production plugin set rather than the checked-in bundle, so the
 * guard holds with no build step and cannot go stale against client/out.
 */

import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import path from "path";
import { stubNodeOnlyImports, webTreeSitterLoaders } from "../../scripts/esbuild-web-tree-sitter.mjs";
import { elkWorkerAsText } from "../../scripts/esbuild-elk-worker.mjs";
import { dropThirdPartyWarnings } from "../../scripts/esbuild-svelte-warnings.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** Bundle the dialog webview entry exactly as scripts/build-webviews.mjs does; return its metafile inputs. */
async function dialogBundleInputs(): Promise<string[]> {
    const result = await build({
        entryPoints: [path.join(repoRoot, "client/src/dialog-editor/webview/main.ts")],
        bundle: true,
        format: "iife",
        write: false,
        metafile: true,
        logLevel: "silent",
        outdir: path.join(repoRoot, "client/out/__bundle_guard__"),
        loader: webTreeSitterLoaders,
        plugins: [
            esbuildSvelte({ compilerOptions: { dev: false }, filterWarnings: dropThirdPartyWarnings }),
            stubNodeOnlyImports,
            elkWorkerAsText,
        ],
    });
    const output = Object.values(result.metafile.outputs).find((o) => o.entryPoint !== undefined);
    if (!output) throw new Error("no entry output in metafile");
    return Object.keys(output.inputs);
}

describe("dialog webview bundle composition", () => {
    it("ships exactly one copy of the ELK engine", async () => {
        const inputs = await dialogBundleInputs();

        // The worker script - the copy that is actually executed - must be there.
        expect(inputs.some((i) => i.includes("elk-worker.min.js"))).toBe(true);
        // elk.bundled.js is a SECOND copy of the same engine; the API shim is what belongs here.
        expect(inputs.filter((i) => i.includes("elk.bundled.js"))).toEqual([]);
    }, 60_000);
});
