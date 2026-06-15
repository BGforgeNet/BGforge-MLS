/**
 * MAP cross-record jump harness pass.
 *
 * Opens a script-bearing map (with the PRO resolver so its script-owning objects decode), finds a script whose
 * SID links to the object that runs it, and clicks the SID jump chip. Asserts the view navigates to the Objects
 * tab, selects the object whose SID equals the script's sid (the authored binding), and scrolls it into view.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileDerivedParseOptions } from "@bgforge/binary";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/denbus1.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));
const parseOptions = buildFileDerivedParseOptions(FIXTURE);

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///denbus1.map", bytes: mapBytes, options: parseOptions });
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

// --- Find a script whose SID links to its object. Only object-owned scripts (item/critter) are referenced by
// an object, so scan each script subtab's first rows until one exposes a SID chip. ---
await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Scripts" }).first().click();
await page.waitForTimeout(150);
const sidField = () =>
    page
        .locator(".layout-root .field")
        .filter({ has: page.locator('.label:text-is("SID")') })
        .first();
let sidHex: string | null = null;
let jumpLabel = "";
const subtabs = page.locator('.layout-root .bb-tabs button[role="tab"]');
for (let s = 0; s < (await subtabs.count()) && sidHex === null; s++) {
    const label = (await subtabs.nth(s).innerText()).trim();
    if (!["System", "Spatial", "Timer", "Item", "Critter"].some((t) => label.startsWith(t))) continue;
    await subtabs.nth(s).click();
    await page.waitForTimeout(120);
    const rows = page.locator(".layout-root .vlist .vrow");
    const rowCount = Math.min(await rows.count(), 20);
    for (let i = 0; i < rowCount; i++) {
        await rows.nth(i).click();
        await page.waitForTimeout(70);
        if ((await sidField().locator(".jump-link").count()) > 0) {
            sidHex = await fieldHex("SID");
            jumpLabel = (await sidField().locator(".jump-link").first().innerText()).trim();
            break;
        }
    }
}
check("found a script whose SID links to its object", sidHex !== null, `sid=0x${sidHex} chip="${jumpLabel}"`);

if (sidHex !== null) {
    const sidVal = parseInt(sidHex, 16) | 0;
    await sidField().locator(".jump-link").first().click();
    await page.waitForTimeout(200);

    const tabAfter = (await activePrimaryTab()).trim();
    check("the script SID jump switches to the Objects tab", tabAfter.startsWith("Objects"), `active="${tabAfter}"`);

    // The landed object's SID (the script it runs, now a hex field) equals the script's own sid - the binding.
    const objSidHex = await fieldHex("SID");
    check(
        "the selected object runs this script (object SID == script SID)",
        objSidHex !== null && (parseInt(objSidHex, 16) | 0) === sidVal,
        `objSid=0x${objSidHex} scriptSid=${sidVal}`,
    );

    // The jump scrolls the selected entry into view: a .vrow.selected exists in the master list and its box
    // sits within the list viewport.
    const visible = await page.evaluate(() => {
        const sel = document.querySelector(".layout-root .master .vlist .vrow.selected");
        const list = document.querySelector(".layout-root .master .vlist");
        if (!sel || !list) return { selected: false, inView: false };
        const s = sel.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        return { selected: true, inView: s.top >= l.top - 1 && s.bottom <= l.bottom + 1 };
    });
    check(
        "the jumped-to object row is selected and scrolled into view",
        visible.selected && visible.inView,
        JSON.stringify(visible),
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
