/**
 * PRO and EFF harness pass.
 *
 * Opens one Fallout PRO (item proto) and one Infinity Engine EFF in the real webview bundle (app.html).
 * Both are migrated to the declarative layout (PRO via its per-subtype item variant, EFF via the "effect"
 * variant) and render as a single dense page through LayoutRenderer - the legacy section-tabs path is gone.
 * EFF lays out Effect / Dice & Save / Parameters / Resources / Classification / Caster / Resistance panels with the
 * ~300-entry opcode enum as a searchable combobox. Both run under the strict nonce CSP.
 *
 * Assertions:
 *   - PRO (item): opens without error, resolves an `item.*` layout variant, fields render via .layout-root,
 *     and no section tabs appear.
 *   - EFF: opens without error, resolves the "effect" layout variant, panels + fields render via
 *     .layout-root, opcode renders as a searchable combobox, and no section tabs appear.
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
// PRO renders as a single dense page via the declarative layout (every object/sub type has a variant).
await page.waitForSelector(".layout-root", { timeout: 5000 });
await page.waitForTimeout(200);

check(
    "pro: resolves an item layout variant",
    proOpen.result.layout.layout?.variantId?.startsWith("item.") === true,
    `variantId=${proOpen.result.layout.layout?.variantId}`,
);
const proDom = await page.evaluate(() => ({
    fields: document.querySelectorAll(".layout-root .field").length,
    tabs: document.querySelectorAll(".bb-tabs").length,
}));
check("pro: layout fields render (> 0)", proDom.fields > 0, `count=${proDom.fields}`);
check("pro: no section tabs (single page)", proDom.tabs === 0, `count=${proDom.tabs}`);

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
await page2.waitForSelector(".layout-root", { timeout: 5000 });
await page2.waitForTimeout(200);

check(
    "eff: resolves the 'effect' layout variant",
    effOpen.result.layout.layout?.variantId === "effect",
    `variantId=${effOpen.result.layout.layout?.variantId}`,
);
const effDom = await page2.evaluate(() => ({
    panels: Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent),
    fields: document.querySelectorAll(".layout-root .field").length,
    combobox: document.querySelectorAll(".layout-root .bb-combobox-input").length,
    selects: document.querySelectorAll(".layout-root .bb-select-trigger").length,
    flagCols: document.querySelectorAll(".layout-root .flag-columns").length,
    tabs: document.querySelectorAll(".bb-tabs").length,
}));
check(
    "eff: panels render (Effect / Dice & Save / Parameters / Resources / Classification / Caster & Projectile / Resistance)",
    JSON.stringify(effDom.panels) ===
        JSON.stringify([
            "Effect",
            "Dice & Save",
            "Parameters",
            "Resources",
            "Classification",
            "Caster & Projectile",
            "Resistance",
        ]),
    JSON.stringify(effDom.panels),
);
check("eff: layout fields render (> 20)", effDom.fields > 20, `count=${effDom.fields}`);
check("eff: opcode renders as a searchable combobox", effDom.combobox >= 1, `count=${effDom.combobox}`);
check("eff: small enums render as Select (target/timing)", effDom.selects >= 2, `count=${effDom.selects}`);
check("eff: flags render (saveType + resistance)", effDom.flagCols >= 2, `count=${effDom.flagCols}`);
check("eff: no section tabs (single page)", effDom.tabs === 0, `count=${effDom.tabs}`);

await page2.screenshot({ path: path.join(here, "shot-eff.png") });

await browser.close();

console.log("\n=== PRO+EFF harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PRO+EFF ASSERTIONS PASS" : `\n${failed} PRO+EFF ASSERTIONS FAILED`);
assertNoCsp();
assertNoCsp2();
if (failed > 0) process.exit(1);
