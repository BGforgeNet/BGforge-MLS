// Regression: editing a source SSL file must not crash the dialog editor's tree, and the tree must keep
// re-rendering as the file is edited (never wedge until the panel is reopened).
//
// The bug (Tree.svelte): the conversation tree renders a reply's target node inline via a recursive
// `stateBlock`. On a live re-parse the model is replaced wholesale; a reply keyed only by `r.id` was REUSED
// even when its target flipped shape (e.g. `state` -> `external` because the destination node vanished from a
// mid-edit parse). Svelte then re-ran the reused child block's deriveds against the now-stale `r.target.node`
// (undefined), threw `Cannot read properties of undefined (reading 'id')`, and aborted the whole reactive
// flush - so the tree stayed frozen on the error until the editor was closed and reopened. The fix keys reply
// and block rows on the target's identity so a target-flip forces a teardown+rebuild instead of a stale reuse.
//
// This only reproduces in a real reactive flush (a browserless projection of the same models does NOT throw -
// the tree builder never emits an absent node; the fault is Svelte block reuse), and only on a dialog complex
// enough to nest/share subtrees, so it lives here and drives a real corpus dialog. Corpus-gated: skips cleanly
// when external/ is not checked out (the Harness CI job runs reset-external.sh first, so it guards there).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { parseDialog } from "../../../../../server/src/dialog";
import { modelFromSSL } from "../../../../../shared/dialog-model";
import { harnessPaths, makeChecker } from "./driver-util";

const { appHtml } = harnessPaths(import.meta.url);
const { check, finish } = makeChecker();

// A few real, complex RP dialogs; the first that is checked out is used. Small dialogs do not reproduce the
// crash (it needs enough nesting/back-references for the reused-block transient to occur), so these are large.
const CORPUS = path.resolve(appHtml, "../../../../../../external/fallout/Fallout2_Restoration_Project/scripts_src");
const CANDIDATES = ["sanfran/fcdaveh.ssl", "prmtribe/tribec1.ssl", "newreno/ncsalvat.ssl", "main/vclynett.ssl"];
const file = CANDIDATES.map((c) => path.join(CORPUS, c)).find((p) => fs.existsSync(p));

if (!file) {
    check("reparse-crash regression (skipped: external/ corpus not checked out - run scripts/reset-external.sh)", true);
    finish();
}

const full = fs.readFileSync(file!, "utf8");
const model = async (src: string) => ({
    ...modelFromSSL(await parseDialog(src)),
    sourceName: "dialog.ssl",
    sourceLang: "ssl" as const,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 850 } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.stack ?? String(e)));

await page.goto("file://" + appHtml);
await page.evaluate(
    (m) => window.postMessage({ type: "model", model: m }, "*"),
    (await model(full)) as unknown as Record<string, unknown>,
);
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
// A node is typically selected while the writer edits the source.
await page
    .locator('[role="treeitem"]')
    .first()
    .click({ timeout: 2000 })
    .catch(() => undefined);

// Simulate the source being edited: post a series of progressively-truncated re-parses (each drops trailing
// nodes, flipping earlier options' targets from `state` to `external`), the way the host posts a model on
// every external text-side edit.
for (const cut of [0.97, 0.9, 0.8, 0.65, 0.5, 0.35, 0.2, 0.08]) {
    await page.evaluate(
        (m) => window.postMessage({ type: "model", model: m }, "*"),
        (await model(full.slice(0, Math.floor(full.length * cut)))) as unknown as Record<string, unknown>,
    );
    await new Promise((r) => setTimeout(r, 200));
}
// The writer fixes the syntax and saves: the full, valid model is posted again.
await page.evaluate(
    (m) => window.postMessage({ type: "model", model: m }, "*"),
    (await model(full)) as unknown as Record<string, unknown>,
);
await new Promise((r) => setTimeout(r, 400));
const recoveredTreeitems = await page.locator('[role="treeitem"]').count();

check(
    "no crash during a sequence of source edits (reused reply blocks never deref a stale target node)",
    pageErrors.length === 0,
    `${pageErrors.length} page error(s)`,
);
check(
    "the tree re-renders after the edit is fixed (never wedged until reopen)",
    recoveredTreeitems > 0,
    `treeitems=${recoveredTreeitems}`,
);

await browser.close();
finish(pageErrors, `corpus: ${path.basename(file!)}`);
