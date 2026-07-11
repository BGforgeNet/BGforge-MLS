/**
 * MAP Variables tab render harness.
 *
 * Opens arcaves.map (21 global vars, 0 local vars) in the production webview, navigates to the new
 * Variables top-level tab, and asserts: the Variables parent tab shows a count badge (21), the Global
 * subtab is the default shown and renders its variable list. arcaves has no local vars so the Local subtab
 * is pruned by the renderer (absent section -> no content -> not shown), consistent with how the Objects
 * tab prunes absent non-disabled elevation tabs.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/arcaves.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: mapBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            return [{ type: "init", open: r.result }];
        }
        return [];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({ type: "getChildren", sessionId, nodeId: m.nodeId, start: m.start, end: m.end });
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const assertNoCsp = installCspGate(page, "MAP-vars");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });

// Variables tab must appear between Header and Objects in the primary strip.
const primaryTabLabels = await page.locator('.bb-tabs.primary button[role="tab"]').allInnerTexts();
const varTabBtn = page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Variables" }).first();
check("Variables primary tab exists", (await varTabBtn.count()) > 0, `tabs: ${JSON.stringify(primaryTabLabels)}`);

const headerIdx = primaryTabLabels.findIndex((l) => l.trim().startsWith("Header"));
const varIdx = primaryTabLabels.findIndex((l) => l.trim().startsWith("Variables"));
const objIdx = primaryTabLabels.findIndex((l) => l.trim().startsWith("Objects"));
check(
    "Variables tab is ordered after Header and before Objects",
    varIdx > headerIdx && varIdx < objIdx,
    `Header=${headerIdx} Variables=${varIdx} Objects=${objIdx}`,
);

await varTabBtn.click();
await page
    .waitForFunction(
        () => {
            const btn = Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]')).find((b) =>
                (b.textContent ?? "").includes("Variables"),
            );
            return btn !== undefined && /Variables\s*\(\s*21\s*\)/.test(btn.textContent ?? "");
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);

// Variables tab button should show a count badge (21 from arcaves).
const varTabLabel = await varTabBtn.innerText();
check(
    "Variables parent tab badge shows 21",
    /Variables\s*\(\s*21\s*\)/.test(varTabLabel),
    `label='${varTabLabel.trim()}'`,
);

// Global subtab should be active by default and show variable rows.
const subtabLabels = await page.locator('.layout-root .bb-tabs button[role="tab"]').allInnerTexts();
const globalTab = page.locator('.layout-root .bb-tabs button[role="tab"]').filter({ hasText: "Global" }).first();
check("Global subtab visible", (await globalTab.count()) > 0, `subtabs: ${JSON.stringify(subtabLabels)}`);

const globalLabel = await globalTab.innerText();
check("Global subtab shows count 21", /Global\s*\(\s*21\s*\)/.test(globalLabel), `label='${globalLabel.trim()}'`);

// Global subtab is active -> shows variable list rows.
const rows = page.locator(".layout-root .vlist .vrow");
const rowCount = await rows.count();
check("Global subtab shows variable list rows (>0)", rowCount > 0, `rows=${rowCount}`);

await page.screenshot({ path: shotPath("shot-map-vars.png"), fullPage: true });

await browser.close();
console.log("\n=== MAP variables tab harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP VARS ASSERTIONS PASS" : `\n${failed} MAP VARS ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
