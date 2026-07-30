/**
 * MAP elevation-tab disable harness pass.
 *
 * Opens a single-elevation Fallout map (artemple - header mapFlags 0xc, SkipElevation1Tiles |
 * SkipElevation2Tiles) in the production webview, navigates to the Objects tab, and asserts the Elevation 1 /
 * Elevation 2 subtabs render disabled (greyed, non-selectable) while Elevation 0 stays active.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/artemple.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///artemple.map", bytes: mapBytes });
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
const assertPageClean = installPageGate(page, "MAP-elevations");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Objects" }).first().click();
await page
    .waitForFunction(
        () => document.querySelectorAll('.layout-root .bb-tabs.secondary button[role="tab"]').length >= 3,
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);

// Read the elevation subtab strip: label + disabled state.
const subs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.layout-root .bb-tabs.secondary button[role="tab"]')).map((b) => ({
        label: (b.textContent ?? "").trim(),
        disabled: (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true",
    })),
);

const byLabel = (needle: string) => subs.find((s) => s.label.startsWith(needle));
check("elevation subtabs render", subs.length >= 3, JSON.stringify(subs.map((s) => s.label)));
check("Elevation 0 is enabled", byLabel("Elevation 0")?.disabled === false, JSON.stringify(byLabel("Elevation 0")));
check(
    "Elevation 1 is disabled (skip flag set)",
    byLabel("Elevation 1")?.disabled === true,
    JSON.stringify(byLabel("Elevation 1")),
);
check(
    "Elevation 2 is disabled (skip flag set)",
    byLabel("Elevation 2")?.disabled === true,
    JSON.stringify(byLabel("Elevation 2")),
);

await page.screenshot({ path: shotPath("shot-map-elevations.png"), fullPage: true });
await browser.close();

console.log("\n=== MAP elevation-tab harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP ELEVATION ASSERTIONS PASS" : `\n${failed} MAP ELEVATION ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
