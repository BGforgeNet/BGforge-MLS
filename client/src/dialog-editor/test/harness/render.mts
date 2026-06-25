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
import { REAL_MODEL } from "./real-model";

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = path.join(here, "app.html");
const shot = process.argv[2] ?? path.join(here, "shot.png");

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

await page.goto("file://" + appHtml);

// Before any message arrives, App shows the loading state (not an error, not a graph).
const loadingText = (await page.locator("#app").textContent())?.trim() ?? "";
check("initial state is the loading placeholder", /Parsing dialog/i.test(loadingText), JSON.stringify(loadingText));

// Deliver the model through the real channel App listens on. App wraps it in $state and
// hands the proxy to DialogGraph.cloneModel ($state.snapshot) - the path that crashed.
await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), REAL_MODEL);
await page.waitForSelector(".svelte-flow__node", { timeout: 10_000 });
const nodeCount = await page.locator(".svelte-flow__node").count();
check("model posted via postMessage renders the graph", nodeCount > 0, `nodes=${nodeCount}`);
const afterModelText = (await page.locator("#app").textContent()) ?? "";
check("loading placeholder is gone once the model renders", !/Parsing dialog/i.test(afterModelText));

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

await page.screenshot({ path: shot });

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
