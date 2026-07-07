/**
 * Find-bar driver: exercises the tree search feature in the PRODUCTION webview (real App.svelte mounted via
 * postMessage, driven interactively in Chromium), the path unit/SSR tests can't reach - the always-visible
 * find-bar, find-as-you-type highlighting + match count, Enter/Shift+Enter navigation with wraparound, Ctrl+F
 * focusing the box, Escape clearing the query, and reveal of a collapsed match. Search is pure webview (no
 * host/LSP/save), so the harness (which has no host) covers it fully. e2e-tier: not part of `pnpm test`.
 *
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render-search.mts [out.png]
 *
 * Prereqs are environmental, not repo deps: Playwright + a Chromium browser on PATH.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { REAL_MODEL } from "./real-model";

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = path.join(here, "app.html");
const outDir = path.resolve(here, "../../../../../tmp");
mkdirSync(outDir, { recursive: true });
const shot = process.argv[2] ?? path.join(outDir, "dialog-harness-search.png");

const results: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

async function postModel(): Promise<void> {
    await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), REAL_MODEL);
}
const countText = (): Promise<string> => page.locator(".findcount").innerText();

await page.goto("file://" + appHtml);
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });

// --- 1. The find-bar is always visible in tree view; find-as-you-type highlights matches + shows a count ---
check("find-bar is present without any toggle (always visible)", (await page.locator(".findinput").count()) === 1);

// "Coran" appears in several lines/options of the real dialogue - enough to test navigation.
await page.locator(".findinput").click();
await page.locator(".findinput").pressSequentially("Coran", { delay: 20 });
await page.waitForTimeout(150);
const count1 = await countText();
const total = Number(count1.split("/")[1] ?? "0");
check(
    'typing "Coran" shows a match count with more than one match',
    /^1\/\d+$/.test(count1) && total > 1,
    `count=${count1}`,
);
// The displayed input value must stay in sync with what was typed. This caught a real bug: find-as-you-type
// moves the tree selection, and Tree's focus-follows-selection effect yanked DOM focus onto the match row, so
// every character after the first was lost (input showed "C" for "Coran"). Fixed by gating that effect with
// searchActive; this pins that focus stays in the field and the whole query registers.
const shown = await page.locator(".findinput").inputValue();
const active = await page.evaluate(() => document.activeElement?.classList.contains("findinput") ?? false);
check(
    "the input keeps focus + the full typed text (no dropped characters)",
    shown === "Coran" && active,
    `shown="${shown}" focused=${active}`,
);
const hits = await page.locator(".searchhit").count();
const current = await page.locator(".searchcurrent").count();
check(
    "all matches are highlighted (searchhit) with exactly one current (searchcurrent)",
    hits >= total && current === 1,
    `hits=${hits} current=${current} total=${total}`,
);
// Capture at match 1/N (a top row) so the amber hit-wash + current-match outline are both visible in frame.
await page.screenshot({ path: shot });

// The current match is also the selected row (selection stays coupled to the current match).
const currentIsSelected = await page.evaluate(() => {
    const el = document.querySelector(".searchcurrent");
    return Boolean(el && (el.classList.contains("sel") || el.classList.contains("repsel")));
});
check("the current match is also the selected row (focus + selection coupled)", currentIsSelected);

// --- 2. Enter advances; Shift+Enter wraps back to the last ----------------------------------------------
const keyOf = (): Promise<string | null> =>
    page.evaluate(
        () =>
            document.querySelector(".searchcurrent")?.getAttribute("data-sid") ??
            document.querySelector(".searchcurrent")?.getAttribute("data-choice") ??
            null,
    );
const firstKey = await keyOf();
await page.locator(".findinput").press("Enter");
await page.waitForTimeout(120);
const count2 = await countText();
const secondKey = await keyOf();
check(
    "Enter advances to the next match (2/N) on a different row",
    count2 === `2/${total}` && secondKey !== firstKey,
    `count=${count2}`,
);

await page.locator(".findinput").press("Shift+Enter"); // back to 1
await page.locator(".findinput").press("Shift+Enter"); // wrap to last (N)
await page.waitForTimeout(120);
const count3 = await countText();
check(
    "Shift+Enter wraps backward past the first to the last match (N/N)",
    count3 === `${total}/${total}`,
    `count=${count3}`,
);

// --- 3. Escape clears the query (the bar stays visible) --------------------------------------------------
await page.locator(".findinput").press("Escape");
await page.waitForTimeout(120);
check(
    "Escape clears the query but keeps the always-visible bar",
    (await page.locator(".findinput").inputValue()) === "" && (await page.locator(".findinput").count()) === 1,
);
check("clearing the query drops all match highlights", (await page.locator(".searchhit").count()) === 0);

// --- 4. Ctrl+F focuses the always-visible bar (webview key path, not the browser's own find) -------------
await page.goto("file://" + appHtml);
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
await page.locator('[role="treeitem"]').first().click(); // move focus into the tree first
await page.keyboard.press("Control+f");
await page.waitForTimeout(200);
check(
    "Ctrl+F focuses the find input",
    await page.evaluate(() => document.activeElement?.classList.contains("findinput") ?? false),
);

// --- 5. A collapsed match is revealed (ancestors un-collapsed) when navigated to ------------------------
// Collapse the whole tree, then search + navigate: the current match's row must render (reveal ran).
await page.getByRole("button", { name: "Collapse all" }).click();
await page.waitForTimeout(100);
await page.locator(".findinput").click();
await page.locator(".findinput").pressSequentially("Coran", { delay: 20 });
await page.waitForTimeout(150);
const revealedVisible = await page.locator(".searchcurrent").first().isVisible();
check("navigating to a match inside a collapsed subtree reveals it (row is in the DOM and visible)", revealedVisible);

await browser.close();

// --- Report ----------------------------------------------------------------------------------------------
for (const r of results) console.log(r);
if (pageErrors.length) {
    console.log("\nPAGE ERRORS:");
    for (const e of pageErrors) console.log("  " + e);
}
const failed = results.filter((r) => r.startsWith("FAIL")).length + pageErrors.length;
console.log(`\n${failed === 0 ? "OK" : "FAILED"}: ${results.length} checks, ${failed} problem(s). Screenshot: ${shot}`);
process.exit(failed === 0 ? 0 : 1);
