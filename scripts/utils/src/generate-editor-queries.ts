/**
 * Emit per-editor highlight queries from each grammar's canonical `queries/highlights.scm`.
 *
 * The canonical file is written to Neovim conventions, so it ships unchanged at
 * `<grammar>/queries/highlights.scm`; Helix and Zed get rewritten copies under
 * `<grammar>/queries/<editor>/highlights.scm`. See editor-captures.ts for why the names differ.
 *
 * Output is generated into the grammar bundle at package time rather than committed: it derives
 * entirely from the canonical file plus a mapping table, and the repo keeps generated artifacts out
 * of the tree where it can.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-editor-queries.ts --bundle-dir <dir>
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CANONICAL_EDITOR, mapQuery, type Editor } from "./editor-captures.ts";

const EDITORS: readonly Editor[] = ["neovim", "helix", "zed"];

function main(): void {
    const { values } = parseArgs({ options: { "bundle-dir": { type: "string" } } });
    const bundleDir = values["bundle-dir"];
    if (bundleDir === undefined) {
        console.error("generate-editor-queries: --bundle-dir <dir> is required");
        process.exit(1);
    }

    let written = 0;
    for (const grammar of fs.readdirSync(bundleDir, { withFileTypes: true })) {
        if (!grammar.isDirectory()) continue;
        const canonical = path.join(bundleDir, grammar.name, "queries", "highlights.scm");
        if (!fs.existsSync(canonical)) continue;

        const source = fs.readFileSync(canonical, "utf-8");
        for (const editor of EDITORS) {
            // The canonical file already IS the Neovim flavour and stays at queries/highlights.scm,
            // which is where the Neovim guide points; a duplicate copy would just drift.
            if (editor === CANONICAL_EDITOR) continue;
            const outDir = path.join(bundleDir, grammar.name, "queries", editor);
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "highlights.scm"), mapQuery(editor, source), "utf-8");
            written++;
        }
    }

    if (written === 0) {
        console.error(`generate-editor-queries: no grammars with queries/highlights.scm under ${bundleDir}`);
        process.exit(1);
    }
    console.log(`generate-editor-queries: wrote ${written} per-editor query files`);
}

main();
