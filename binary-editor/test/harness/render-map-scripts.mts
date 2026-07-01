/**
 * MAP scripts flat-list harness pass.
 *
 * Opens a real script-bearing Fallout map (newr2 - non-empty Timer / Item script sections) in the production
 * webview, navigates to the Scripts tab, picks the first non-empty script subtab, and selects the first entry.
 * Asserts the storage-extent paging is gone (the master list is a flat "Script N" list, no "Extent" rows) and
 * the selected script's detail shows its SID as a hex value that fits its field (the writer-flagged issues).
 */

import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";

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
const assertNoCsp = installCspGate(page, "MAP-scripts");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });

// Primary tab -> Scripts.
await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Scripts" }).first().click();
await page.waitForTimeout(150);

// Pick the first script subtab that has list rows.
const subtabs = page.locator('.layout-root .bb-tabs button[role="tab"]');
const subCount = await subtabs.count();
let selected: Locator | undefined;
let subLabel = "";
for (let i = 0; i < subCount; i++) {
    const label = (await subtabs.nth(i).innerText()).trim();
    if (!["System", "Spatial", "Timer", "Item", "Critter"].some((s) => label.startsWith(s))) continue;
    await subtabs.nth(i).click();
    await page.waitForTimeout(150);
    const rows = page.locator(".layout-root .vlist .vrow");
    if ((await rows.count()) > 0) {
        selected = rows;
        subLabel = label;
        break;
    }
}

check("a non-empty script subtab is reachable", selected !== undefined, `subtab=${subLabel}`);
if (selected) {
    const rowTexts = await selected.allInnerTexts();
    check(
        `${subLabel}: master list is a flat Script list (no Extent rows)`,
        rowTexts.every((t) => !/Extent/.test(t)),
        `first rows: ${rowTexts.slice(0, 3).join(" | ")}`,
    );

    await selected.first().click();
    await page.waitForTimeout(150);

    // SID field in the selected script's detail: a hex control (`.hex-input` = static "0x" prefix + digit
    // input) whose digits are not clipped. The label is the stripped "SID" (no "Entry N" prefix).
    const sid = await page.evaluate(() => {
        const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
            (f) => f.querySelector(".label")?.textContent?.trim() === "SID",
        );
        if (!field) return null;
        const input = field.querySelector(".hex-input input") as HTMLInputElement | null;
        return {
            isHex: field.querySelector(".hex-input") !== null,
            digits: input?.value ?? "",
            clipped: input ? input.scrollWidth > input.clientWidth + 1 : false,
        };
    });
    check("selected script shows a SID field (label stripped to 'SID')", sid !== null, `sid=${JSON.stringify(sid)}`);
    if (sid) {
        check("SID renders as a hex control", sid.isHex && /^[0-9a-f]{8}$/i.test(sid.digits), `digits=${sid.digits}`);
        check("SID value fits its field (not clipped)", !sid.clipped, `digits=${sid.digits}`);
    }

    // No "Extent Length" / "Extent Next" anywhere on the page.
    const extentLabels = await page.evaluate(
        () =>
            Array.from(document.querySelectorAll(".layout-root .label")).filter((l) =>
                /Extent (Length|Next)/.test(l.textContent ?? ""),
            ).length,
    );
    check("extent paging fields are hidden", extentLabels === 0, `count=${extentLabels}`);

    await page.screenshot({ path: shotPath("shot-map-scripts.png"), fullPage: true });
}

await browser.close();
console.log("\n=== MAP scripts harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP SCRIPT ASSERTIONS PASS" : `\n${failed} MAP SCRIPT ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
