/**
 * PRO and EFF harness pass.
 *
 * Opens one Fallout PRO (item proto) and one Infinity Engine EFF in the real webview bundle
 * (app.html). Both formats are form-only (no list sections), so this pass confirms the
 * generic FormSection render path handles them without errors under the strict nonce CSP.
 *
 * No structure-op exercises are performed - PRO and EFF have no canModify list sections.
 * The phantom-format driver (render-form.mts) and the static generic-renderer guard already
 * cover the generic rendering guarantee; this driver adds real-fixture smoke coverage.
 *
 * Assertions:
 *   - PRO: opens without error, layout has at least one section, form fields render (.form .field).
 *   - EFF: opens without error, layout has at least one section, form fields render (.form .field).
 *   - CSP: no Content-Security-Policy violations in either page.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { WebviewToHost, HostToWebview } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const PRO_FIXTURE = path.join(repo, "client/testFixture/proto/items/00000031.pro");
const EFF_FIXTURE = path.join(repo, "external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff");

const proBytes = new Uint8Array(fs.readFileSync(PRO_FIXTURE));
const effBytes = new Uint8Array(fs.readFileSync(EFF_FIXTURE));

// ---- Verify parsers can open both formats before launching the browser ----
const proOpen = dispatch({ type: "open", uri: "file:///00000031.pro", bytes: proBytes });
if (proOpen.type !== "opened" || proOpen.result.errors.length > 0) {
    console.log("PRO open failed:", proOpen.type === "opened" ? proOpen.result.errors : proOpen);
    process.exit(1);
}
const effOpen = dispatch({ type: "open", uri: "file:///balth01b.eff", bytes: effBytes });
if (effOpen.type !== "opened" || effOpen.result.errors.length > 0) {
    console.log("EFF open failed:", effOpen.type === "opened" ? effOpen.result.errors : effOpen);
    process.exit(1);
}

// Store open results for hostUp callbacks.
let currentOpenResult = proOpen.result;

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        return [{ type: "init", open: currentOpenResult }];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({
            type: "getChildren",
            sessionId: currentOpenResult.sessionId,
            nodeId: m.nodeId,
            start: m.start,
            end: m.end,
        });
        if (r.type === "children") {
            return [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }];
        }
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const assertNoCsp = installCspGate(page, "PRO+EFF");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

// ---- PRO pass ----
currentOpenResult = proOpen.result;
await page.goto("file://" + path.join(here, "app.html"));
// PRO is a form-only format (header + subtype-conditional groups). Wait for at least one section tab or field.
await page.waitForSelector(".form, .bb-tabs.primary [role='tab']", { timeout: 5000 });
await page.waitForTimeout(200);

const proSections = proOpen.result.layout.sections.length;
check("pro: layout has sections (>= 1)", proSections >= 1, `count=${proSections}`);
const proFields = await page.locator(".form .field").count();
check("pro: form fields render (> 0)", proFields > 0, `count=${proFields}`);

await page.screenshot({ path: path.join(here, "shot-pro.png") });

// ---- EFF pass: reload the same page with a fresh hostUp binding pointing at effOpen ----
// We need to rebind __hostUp before navigating. The easiest way in Playwright is to expose a new page,
// but exposeFunction can only be called once per name. Instead, post the new open result via a fresh
// page load (the page re-registers __hostUp from scratch on navigation).
//
// We create a second page so the first page's exposeFunction binding does not interfere.
const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const assertNoCsp2 = installCspGate(page2, "EFF");
currentOpenResult = effOpen.result;

await page2.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page2.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page2.goto("file://" + path.join(here, "app.html"));
await page2.waitForSelector(".form, .bb-tabs.primary [role='tab']", { timeout: 5000 });
await page2.waitForTimeout(200);

const effSections = effOpen.result.layout.sections.length;
check("eff: layout has sections (>= 1)", effSections >= 1, `count=${effSections}`);
const effFields = await page2.locator(".form .field").count();
check("eff: form fields render (> 0)", effFields > 0, `count=${effFields}`);

await page2.screenshot({ path: path.join(here, "shot-eff.png") });

await browser.close();

console.log("\n=== PRO+EFF harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PRO+EFF ASSERTIONS PASS" : `\n${failed} PRO+EFF ASSERTIONS FAILED`);
assertNoCsp();
assertNoCsp2();
if (failed > 0) process.exit(1);
