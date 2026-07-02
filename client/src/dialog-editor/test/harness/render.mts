/**
 * Production-path render driver for the dialog editor webview.
 *
 * Loads the real App.svelte root (app.html, built by build.mts) in Chromium and drives it
 * through the SAME channel the live webview uses: the host's messages arrive via
 * `window.postMessage`, App holds the model in a Svelte $state proxy, and passes that proxy
 * to DialogGraph. This is the path that hid three bugs behind a green DialogGraph-only
 * harness (external <script> blanking the panel, structuredClone($state) DataCloneError,
 * silent hang). The driver asserts the panel actually renders, a structural edit
 * (Duplicate state - which deep-clones a $state proxy) works, and the fail-loud error
 * state surfaces. A page error (e.g. a re-introduced DataCloneError) or a CSP violation
 * fails the run.
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts   # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render.mts  # this driver
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { REAL_MODEL } from "./real-model";

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = path.join(here, "app.html");
// Runtime artefacts go under the repo-level tmp/, never the source tree (project convention).
const outDir = path.resolve(here, "../../../../../tmp");
mkdirSync(outDir, { recursive: true });
const shot = process.argv[2] ?? path.join(outDir, "dialog-harness-shot.png");

const results: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

// Fail-loud gates: an uncaught page error (a re-introduced DataCloneError lands here) or a
// CSP violation must fail the run, not be swallowed.
const pageErrors: string[] = [];
const cspViolations: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) || /Refused to/i.test(t)) cspViolations.push(t);
});

// The default view is now Tree; most assertions below drive the node graph, so this posts the model and
// then switches to the Graph tab. A fresh page.goto() resets to the Tree default, so every reload block
// that needs the graph calls showGraph() after posting.
async function postModel(): Promise<void> {
    await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), REAL_MODEL);
}
async function showGraph(): Promise<void> {
    await page.getByRole("tab", { name: "Graph" }).click();
    await page.waitForSelector(".svelte-flow__node", { timeout: 10_000 });
}

await page.goto("file://" + appHtml);

// Before any message arrives, App shows the loading state (not an error, not a graph).
const loadingText = (await page.locator("#app").textContent())?.trim() ?? "";
check("initial state is the loading placeholder", /Parsing dialog/i.test(loadingText), JSON.stringify(loadingText));

// Deliver the model through the real channel App listens on. App wraps it in $state and
// hands the proxy to DialogGraph.cloneModel ($state.snapshot) - the path that crashed.
await postModel();
// Default view is Tree: the model first renders the tree outline.
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const treeItems = await page.locator('[role="treeitem"]').count();
check("model posted via postMessage renders the default (tree) view", treeItems > 0, `items=${treeItems}`);
const afterModelText = (await page.locator("#app").textContent()) ?? "";
check("loading placeholder is gone once the model renders", !/Parsing dialog/i.test(afterModelText));
// Switch to Graph for the node-graph assertions below.
await showGraph();
const nodeCount = await page.locator(".svelte-flow__node").count();
check("switching to Graph renders the node graph", nodeCount > 0, `nodes=${nodeCount}`);

// Exercise a structural edit that deep-clones a $state proxy: select a card, Duplicate it.
// duplicateState uses JSON.parse(JSON.stringify(...)) precisely because structuredClone
// throws on the proxy; this drives that path end to end.
await page.locator(".svelte-flow__node").first().click();
const dupBtn = page.getByRole("button", { name: "Duplicate state" });
await dupBtn.waitFor({ timeout: 5000 });
const before = await page.locator(".svelte-flow__node").count();
await dupBtn.click();
await page.waitForTimeout(400);
const after = await page.locator(".svelte-flow__node").count();
check(
    "Duplicate state adds a node (deep-clones the $state proxy)",
    after === before + 1,
    `before=${before} after=${after}`,
);

// Spotlight overlay (1B): toggling it dims fully-authored cards (no badge) while the
// flagged ones stay fully opaque - the author's "which parts are projections?" lens.
await page.getByRole("button", { name: "Spotlight" }).click();
await page.waitForTimeout(250);
const spot = await page.evaluate(() => {
    // No named inner functions here: tsx/esbuild keepNames would inject a __name helper
    // that is undefined in the page context. Inline the opacity read instead.
    const cards = Array.from(document.querySelectorAll(".card"));
    const flagged = cards.filter((c) => c.classList.contains("flagged"));
    const trusted = cards.filter((c) => !c.classList.contains("flagged"));
    return {
        flaggedCount: flagged.length,
        trustedCount: trusted.length,
        flaggedAllOpaque: flagged.every((c) => parseFloat(getComputedStyle(c).opacity) > 0.9),
        someTrustedDimmed: trusted.some((c) => parseFloat(getComputedStyle(c).opacity) < 0.5),
    };
});
check(
    "spotlight dims trusted cards and keeps flagged ones opaque",
    spot.flaggedCount > 0 && spot.trustedCount > 0 && spot.flaggedAllOpaque && spot.someTrustedDimmed,
    JSON.stringify(spot),
);

await page.screenshot({ path: shot });

// Panel layout - render-STATE coverage (testing.md) at the PRODUCTION container's real width.
// The live dialog editor is a webview that shares the VS Code window (a side/split panel), so it is
// far narrower than a standalone harness - realistically ~270-540px. The busiest graph frame has the
// selection inspector + Source + Issues overlays open at once, sharing the canvas with the fixed
// minimap and zoom controls; overlay/floating panels collide only when the container is narrow, so a
// harness rendered wide is a false green (this exact miss shipped as commit 312cf03c). Drive the busy
// state at the real min (~300px) and a mid (~520px) width and assert no two overlays collide at either.
async function measureCollisionsAt(width: number): Promise<string[]> {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("file://" + appHtml); // fresh load so earlier interactions don't bleed in
    await postModel();
    await showGraph();
    await page.locator(".svelte-flow__node").first().click({ force: true }); // show the inspector
    for (const name of ["Source", "Issues"]) {
        const b = page.getByRole("button", { name: new RegExp("^" + name) });
        // force: a floating overlay may intercept the button at narrow width - that is the very
        // collision under test, so open the panels regardless and let the box-check report it.
        if (await b.count()) await b.first().click({ force: true });
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, `dialog-harness-${width}.png`) });
    return page.evaluate(() => {
        // Inline only (no named fns): tsx/esbuild keepNames would inject an undefined __name in the page.
        const sels = [
            ".dialogtoolbar", // shared docked toolbar header
            ".inspector",
            ".svelte-flow__minimap",
            ".svelte-flow__controls",
            ".dsource", // D source preview
            ".issues",
        ];
        const boxes = sels
            .map((s) => {
                const el = document.querySelector(s);
                return el ? { s, r: el.getBoundingClientRect() } : null;
            })
            .filter((x) => x !== null);
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]!.r,
                    b = boxes[j]!.r;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1)
                    hits.push(`${boxes[i]!.s} x ${boxes[j]!.s} (${Math.round(ox)}x${Math.round(oy)})`);
            }
        return hits;
    });
}
// 300/520 are the narrow real webview widths (minimap hidden); 900 is a wide case where the minimap
// IS shown, so the minimap-vs-controls placement is exercised too rather than skipped.
for (const width of [300, 520, 900]) {
    const panelCollisions = await measureCollisionsAt(width);
    check(
        `no dialog graph overlays collide at ${width}px (inspector + source + issues + minimap + controls)`,
        panelCollisions.length === 0,
        panelCollisions.join("; "),
    );
}

// Delete confirmation: deleting a referenced state used to SILENTLY redirect its inbound
// transitions to EXIT. Selecting a referenced state and deleting must now pop a confirm naming the
// redirect, cancel must keep the node, and only confirm removes it.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 1000, height: 700 });
await postModel();
await showGraph();
const beforeDel = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.getByRole("button", { name: "Delete state" }).click();
const confirmMsg = (await page.locator(".confirm .confirmmsg").textContent()) ?? "";
check(
    "deleting a referenced state confirms and names the EXIT redirect",
    (await page.locator(".confirm").isVisible()) && /redirected to\s+EXIT/i.test(confirmMsg),
    JSON.stringify(confirmMsg.trim().slice(0, 120)),
);
await page.locator(".confirm .toolbtn:not(.confirmdel)").click(); // Cancel
const afterCancel = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.getByRole("button", { name: "Delete state" }).click();
await page.locator(".confirm .confirmdel").click(); // confirm Delete
await page.waitForTimeout(300);
const afterDel = await page.locator(".svelte-flow__node").count();
const returnBrielGone = (await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).count()) === 0;
check(
    "cancel keeps the graph; confirm removes the state",
    // Cancel is a no-op; confirm removes returnBriel (and may prune a now-orphaned external stub too,
    // so assert the graph shrank and the target node itself is gone rather than an exact delta).
    afterCancel === beforeDel && afterDel < beforeDel && returnBrielGone,
    `before=${beforeDel} afterCancel=${afterCancel} afterDel=${afterDel} gone=${returnBrielGone}`,
);

// Keyboard delete goes through the SAME guarded path: svelte-flow's built-in delete key is disabled
// (deleteKey={null}), so selecting a referenced node and pressing Backspace must pop the confirm, not
// silently drop the node and leave dangling GOTOs (the live-review bug).
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 1000, height: 700 });
await postModel();
await showGraph();
const beforeKbd = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
const kbdConfirm = await page.locator(".confirm").isVisible();
const afterKbdNoConfirm = await page.locator(".svelte-flow__node").count();
check(
    "Backspace on a selected referenced node confirms (does not silently delete)",
    kbdConfirm && afterKbdNoConfirm === beforeKbd,
    `confirm=${kbdConfirm} before=${beforeKbd} after=${afterKbdNoConfirm}`,
);

// Tree-view keyboard a11y: state rows are treeitems with roving tabindex; the expand caret is out of
// the tab order (one focusable per row, not two), and ArrowDown roves focus between rows. Before this,
// each row was a focusable div wrapping a focusable caret button and the arrow keys did nothing.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 900, height: 700 });
await postModel();
// Tree is the default view now, so no tab switch is needed.
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const treeA11y = await page.evaluate(() => ({
    trees: document.querySelectorAll('[role="tree"]').length,
    items: document.querySelectorAll('[role="treeitem"]').length,
    // Carets must be out of the tab order so each row is a single tab stop.
    tabbableCarets: Array.from(document.querySelectorAll(".caret")).filter((c) => (c as HTMLElement).tabIndex >= 0)
        .length,
}));
const firstItem = page.locator('[role="treeitem"]').first();
await firstItem.focus();
const firstSid = await firstItem.getAttribute("data-sid");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(80);
const focusedSid = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-sid"));
check(
    "tree has tree/treeitem roles, no tabbable carets, and ArrowDown roves focus",
    treeA11y.trees === 1 &&
        treeA11y.items > 1 &&
        treeA11y.tabbableCarets === 0 &&
        !!focusedSid &&
        focusedSid !== firstSid,
    JSON.stringify({ ...treeA11y, firstSid, focusedSid }),
);

// Fail-loud error state: a fresh App that receives {type:"error"} shows the message, not a
// perpetual spinner.
await page.goto("file://" + appHtml);
await page.evaluate(() => window.postMessage({ type: "error", message: "PARSE BOOM 42" }, "*"));
await page.waitForTimeout(150);
const errText = (await page.locator("#app").textContent()) ?? "";
check(
    "an error message renders the fail-loud error state",
    errText.includes("PARSE BOOM 42"),
    JSON.stringify(errText.slice(0, 80)),
);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("no CSP violations", cspViolations.length === 0, cspViolations.join(" | "));

await browser.close();

console.log("wrote " + shot);
console.log("\n=== dialog production-path harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL DIALOG PRODUCTION-PATH ASSERTIONS PASS" : `\n${failed} ASSERTION(S) FAILED`);
if (failed > 0) process.exit(1);
