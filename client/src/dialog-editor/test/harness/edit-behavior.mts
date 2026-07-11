/**
 * Selection / add / edit behavior driver: exercises the unified `select()` primitive and the shared
 * add/remove paths in the PRODUCTION webview (real App via postMessage, driven in Chromium) - the behaviors
 * that drifted before they were routed through one setter (DialogGraph.svelte). SSR can't drive these (they
 * are interaction + component state), so this is their guard. D REAL_MODEL is flat + editable; branch-scoped
 * add (if/else bundle) shares the identical `select({on: "option-edit"})` path and is exercised live on SSL.
 * e2e-tier: not part of `pnpm test`. Prereqs: Playwright + a Chromium browser on PATH.
 *
 *   pnpm exec tsx client/src/dialog-editor/test/harness/edit-behavior.mts
 */
import { chromium } from "playwright";
import { REAL_MODEL } from "./real-model";
import { harnessPaths, makeChecker } from "./driver-util";

const { appHtml } = harnessPaths(import.meta.url);

const { check, finish } = makeChecker();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));

async function fresh(): Promise<void> {
    await page.goto("file://" + appHtml);
    await page.evaluate((m) => window.postMessage({ type: "model", model: m }, "*"), REAL_MODEL);
    await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
}
const state = (): Promise<{ stsel: number; repsel: number; editing: number; rename: number; tgt: number }> =>
    page.evaluate(() => ({
        stsel: document.querySelectorAll(".st.sel").length,
        repsel: document.querySelectorAll(".rep.repsel").length,
        editing: document.querySelectorAll(".rtext.rtextedit, input.rtextedit").length,
        rename: document.querySelectorAll("input.nameedit").length,
        tgt: document.querySelectorAll(".lf.tgt").length,
    }));

await fresh();
check("inline-target options always show a target label", (await state()).tgt > 0, `tgt=${(await state()).tgt}`);

// add-child "+" selects the NEW STATE (not the connecting option).
await fresh();
const nodesBefore = await page.locator(".st[data-sid]").count();
await page.locator(".st[data-sid]").first().hover(); // reveal the hover-only add button
await page.locator('button[title^="Add a follow-up node"]').first().click({ force: true });
// Wait for the add to land: a new state node exists and it is the selected one (not an option in edit).
await page
    .waitForFunction(
        (n) =>
            document.querySelectorAll(".st[data-sid]").length === n &&
            document.querySelectorAll(".st.sel").length === 1,
        nodesBefore + 1,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const e = await state();
check(
    "add-child selects the NEW STATE, not an option in edit",
    (await page.locator(".st[data-sid]").count()) === nodesBefore + 1 && e.stsel === 1 && e.editing === 0,
    `stsel=${e.stsel} editing=${e.editing}`,
);

// context-menu "Add option" selects + edits the new option (shared add path).
await fresh();
await page.locator(".st[data-sid]").first().click({ button: "right" });
await page.waitForSelector(".ctxitem", { timeout: 5000 });
await page.locator(".ctxitem", { hasText: "Add option" }).first().click();
await page
    .waitForFunction(
        () =>
            document.querySelectorAll(".rep.repsel").length === 1 &&
            document.querySelectorAll(".rtext.rtextedit, input.rtextedit").length === 1,
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const g = await state();
check(
    "context-menu Add option selects + edits the new option",
    g.repsel === 1 && g.editing === 1,
    `repsel=${g.repsel} editing=${g.editing}`,
);

// removing the SELECTED option drops selection back to the owner state (no stale choiceId).
await fresh();
const opt = page.locator(".rep.reprow").first();
await opt.click();
await page
    .waitForFunction(() => document.querySelectorAll(".rep.repsel").length >= 1, undefined, { timeout: 5000 })
    .catch(() => undefined);
const before = await state();
await opt.hover();
await page.locator(".delopt").first().click();
await page
    .waitForFunction(() => document.querySelectorAll(".rep.repsel").length === 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
check(
    "removing the selected option leaves no stale option selection",
    before.repsel >= 1 && (await state()).repsel === 0,
    `repsel ${before.repsel}->${(await state()).repsel}`,
);

// select() clears the rename mode when selection moves to another node.
await fresh();
await page.locator(".nodeid.nodeidbtn").first().dblclick();
await page
    .waitForFunction(() => document.querySelectorAll("input.nameedit").length === 1, undefined, { timeout: 5000 })
    .catch(() => undefined);
const renaming = await state();
await page.locator(".st[data-sid]").nth(1).click();
await page
    .waitForFunction(() => document.querySelectorAll("input.nameedit").length === 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
check("starting a rename shows the rename input", renaming.rename === 1);
check("selecting another node clears the rename mode (no stale rename input)", (await state()).rename === 0);

// inline option-text edit persists via the shared writeText path.
await fresh();
await page.locator(".rep.reprow").first().dblclick();
const input = page.locator("input.rtextedit").first();
await input.waitFor({ timeout: 5000 }).catch(() => undefined);
if (await input.count()) {
    await input.fill("EDIT BEHAVIOR CHECK");
    await input.press("Enter");
    await page
        .waitForFunction(() => document.body.textContent?.includes("EDIT BEHAVIOR CHECK") ?? false, undefined, {
            timeout: 5000,
        })
        .catch(() => undefined);
    check(
        "inline option-text edit persists (writeText)",
        await page.evaluate(() => document.body.textContent?.includes("EDIT BEHAVIOR CHECK") ?? false),
    );
} else {
    check("inline option-text edit persists (writeText)", false, "no edit input appeared");
}

// An external text-side edit (host re-posts the SAME file's model through the `model` prop) is adopted IN PLACE
// and KEEPS the selection on its node - it no longer resets selection to null. Simulate it: select a state, then
// re-post the same model, and assert the state stays selected. (This is the reset effect's new same-file branch,
// the routing the live self-edit adopt shares.)
await fresh();
await page.locator(".st[data-sid]").nth(1).click();
await page
    .waitForFunction(() => document.querySelector(".st.sel") !== null, undefined, { timeout: 5000 })
    .catch(() => undefined);
const beforeRepost = await page.evaluate(() => document.querySelector(".st.sel")?.getAttribute("data-sid") ?? null);
await page.evaluate((m) => window.postMessage({ type: "model", model: m }, "*"), REAL_MODEL);
// A same-file re-post carries the identical model, so it produces no distinct DOM signal to poll for; a bounded
// settle lets the adopt effect run before we re-read the selection (a condition poll here would no-op - the
// selected node is present both before and after).
await page.waitForTimeout(300);
const afterRepost = await page.evaluate(() => document.querySelector(".st.sel")?.getAttribute("data-sid") ?? null);
check(
    "an external same-file re-post keeps the selection on its node (not reset to null)",
    beforeRepost !== null && afterRepost === beforeRepost,
    `selected ${beforeRepost} -> ${afterRepost}`,
);

await browser.close();

finish(errs);
