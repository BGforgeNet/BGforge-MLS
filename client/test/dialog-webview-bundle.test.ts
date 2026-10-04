/**
 * Composition guard for the dialog editor's webview bundle.
 *
 * The webview lays its graph out in a Worker built from elkjs's worker script, which the host posts to it
 * after "ready" along with the regex engine's wasm (webview/dialog-assets.ts): compiled into the bundle, the
 * two cost the panel about half its boot. `elkjs/lib/elk.bundled.js` carries a further inline copy of the
 * engine; the API-only entry (`elk-api.js`, ~10 KB) is what a caller supplying its own workerFactory needs.
 *
 * Asserted against the real production plugin set rather than the checked-in bundle, so the
 * guard holds with no build step and cannot go stale against client/out.
 */

import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "fs";
import path from "path";
import { stubNodeOnlyImports, webTreeSitterLoaders } from "../../scripts/esbuild-web-tree-sitter.mjs";
import { elkWorkerAsText } from "../../scripts/esbuild-elk-worker.mjs";
import { dropThirdPartyWarnings } from "../../scripts/esbuild-svelte-warnings.mjs";
import { DIALOG_ASSET_DIR, DIALOG_ASSET_FILES } from "../src/dialog-editor/dialog-asset-files";

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
    it("embeds neither the ELK engine nor the regex wasm, only the ELK API", async () => {
        const inputs = await dialogBundleInputs();

        expect(inputs.filter((i) => /elk-worker|elk\.bundled|onig\.wasm/.test(i))).toEqual([]);
        expect(inputs.some((i) => i.includes("elk-api.js"))).toBe(true);
    }, 60_000);

    // The host reads these files from where the build copies them; neither side can import the other's list.
    it("copies each posted asset to the name the host reads", () => {
        const script = fs.readFileSync(path.join(repoRoot, "scripts/build-webviews.mjs"), "utf8");
        for (const { from, to } of Object.values(DIALOG_ASSET_FILES)) {
            expect(script).toContain(`fromClient.resolve("${from}"), "${DIALOG_ASSET_DIR}/${to}"`);
        }
    });
});
