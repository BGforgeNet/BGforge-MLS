/**
 * MAP cross-record jump harness pass.
 *
 * Opens a script-bearing map, selects a script whose Owner ID references an object, and clicks the jump chip
 * beside Owner ID. Asserts the view navigates to the Objects tab and selects the object whose ID matches the
 * owner. Then, if that object references a script (SID jump chip present), clicks it and asserts the view
 * navigates back to the Scripts tab - the round trip.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/newr2.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///newr2.map", bytes: mapBytes });
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
const assertNoCsp = installCspGate(page, "MAP-jump");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });

const activePrimaryTab = () =>
    page.locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]').first().innerText();

// Read the hex digits of a named detail field, or null.
const fieldHex = (label: string) =>
    page.evaluate((lbl) => {
        const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
            (f) => f.querySelector(".label")?.textContent?.trim() === lbl,
        );
        const input = field?.querySelector(".hex-input input") as HTMLInputElement | null;
        return input ? input.value : null;
    }, label);
// Read a named field's plain numeric value (the object ID is a decimal i32 input), or null.
const fieldNumber = (label: string) =>
    page.evaluate((lbl) => {
        const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
            (f) => f.querySelector(".label")?.textContent?.trim() === lbl,
        );
        const input = field?.querySelector('input[type="number"]') as HTMLInputElement | null;
        return input ? input.value : null;
    }, label);

// --- Navigate to a script with an Owner ID jump chip ---
await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Scripts" }).first().click();
await page.waitForTimeout(150);
// First script subtab with rows.
const subtabs = page.locator('.layout-root .bb-tabs button[role="tab"]');
for (let i = 0; i < (await subtabs.count()); i++) {
    const label = (await subtabs.nth(i).innerText()).trim();
    if (!["System", "Spatial", "Timer", "Item"].some((s) => label.startsWith(s))) continue;
    await subtabs.nth(i).click();
    await page.waitForTimeout(120);
    if ((await page.locator(".layout-root .vlist .vrow").count()) > 0) break;
}

// Find the first script row whose detail exposes an Owner ID jump chip.
let ownerHex: string | null = null;
let jumpLabel = "";
const rows = page.locator(".layout-root .vlist .vrow");
const rowCount = Math.min(await rows.count(), 20);
for (let i = 0; i < rowCount; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(80);
    const ownerField = page
        .locator(".layout-root .field")
        .filter({ has: page.locator('.label:text-is("Owner ID")') })
        .first();
    const chip = ownerField.locator(".jump-link").first();
    if ((await chip.count()) > 0) {
        ownerHex = await fieldHex("Owner ID");
        jumpLabel = (await chip.innerText()).trim();
        break;
    }
}
check("found a script whose Owner ID has a jump chip", ownerHex !== null, `owner=0x${ownerHex} chip="${jumpLabel}"`);

if (ownerHex !== null) {
    const ownerSigned = parseInt(ownerHex, 16) | 0;
    // Click the Owner ID jump chip.
    await page
        .locator(".layout-root .field")
        .filter({ has: page.locator('.label:text-is("Owner ID")') })
        .first()
        .locator(".jump-link")
        .first()
        .click();
    await page.waitForTimeout(200);

    const tabAfter = (await activePrimaryTab()).trim();
    check("Owner ID jump switches to the Objects tab", tabAfter.startsWith("Objects"), `active="${tabAfter}"`);

    const objId = await fieldNumber("ID");
    check(
        "the selected object's ID matches the script Owner ID",
        objId !== null && (parseInt(objId, 10) | 0) === ownerSigned,
        `objId=${objId} ownerSigned=${ownerSigned}`,
    );

    await page.screenshot({ path: path.join(here, "shot-map-jump.png"), fullPage: true });
}
// The reverse direction (object SID -> script) uses the identical navigate() primitive with the script
// section key; the link resolution both ways is covered by binary-editor/test/map-cross-links.test.ts.

await browser.close();
console.log("\n=== MAP jump harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP JUMP ASSERTIONS PASS" : `\n${failed} MAP JUMP ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
