/**
 * MAP objects master-detail harness pass.
 *
 * Opens a clean Fallout MAP (cave6.map, whose objects fully decode - no opaque
 * tail) in the REAL webview bundle (app.html) and drives the new per-elevation
 * object structure ops through the actual webview message path
 * (webview posts structureOp -> hostUp -> dispatch -> changeSet reply). Row
 * counts use dispatch getChildren (Node-side ground truth).
 *
 * This is the only webview-layer coverage of the projection seam: MAP objects
 * are lifted by projectDisplayRoot into top-level "Elevation N Objects" list
 * sections plus a read-only "Objects" counts form. Unit/integration tests cover
 * the byte builders and the dispatch routing against a mock host; this pins the
 * real App.svelte render + RowActions dispatch for the lifted sections.
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const FIXTURE = path.join(repo, "external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));

const OBJ_SECTION = "Elevation 0 Objects";

let sessionId = "";
let objNodeId = "";
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({
            type: "open",
            uri: "file:///cave6.map",
            bytes: mapBytes,
            options: { gracefulMapBoundaries: true },
        });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            objNodeId = r.result.layout.sections.find((s) => s.title === OBJ_SECTION)?.nodeId ?? "";
            return [{ type: "init", open: r.result }];
        }
        return [];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({ type: "getChildren", sessionId, nodeId: m.nodeId, start: m.start, end: m.end });
        if (r.type === "children") {
            return [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }];
        }
        return [];
    }
    if (m.type === "structureOp") {
        const r = dispatch({ type: "structureOp", sessionId, op: m.op });
        if (r.type === "structure") {
            return [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }];
        }
        return [];
    }
    return [];
}

function sectionTotal(nodeId: string): number {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 1 });
    return r.type === "children" ? r.total : -1;
}

async function doUndo(): Promise<void> {
    dispatch({ type: "undo", sessionId });
    postToWebview({ type: "invalidated" });
    await activePage?.waitForTimeout(150);
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- master-detail helpers (mirrors render-itm.mts) ----
async function goToSection(p: Page, tabLabel: string | RegExp, expectedRows: number): Promise<void> {
    await p.locator(".bb-tabs.primary [role='tab']", { hasText: tabLabel }).first().click();
    await p.waitForTimeout(200);
    await p.waitForFunction((n) => document.querySelectorAll(".vlist .vrow").length >= n, expectedRows, {
        timeout: 5000,
    });
}
async function selectRow(p: Page, idx: number): Promise<void> {
    await p.locator(".vlist .vrow").nth(idx).click();
    await p.waitForSelector(".row-actions", { timeout: 3000 });
    await p.waitForTimeout(100);
}
async function clickAction(p: Page, ariaLabel: string): Promise<void> {
    await p.locator(`.row-actions button[aria-label="${ariaLabel}"]`).first().click();
    await p.waitForTimeout(200);
}
async function clickDelete(p: Page): Promise<void> {
    await clickAction(p, "Delete");
    await p.locator(`.row-actions button[aria-label="Confirm delete"]`).first().click();
    await p.waitForTimeout(200);
}

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
activePage = page;
const assertNoCsp = installCspGate(page, "MAP-OBJECTS");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".bb-tabs.primary [role='tab']", { timeout: 5000 });

// ---- Layout / caps assertions (fresh open so the browser session is untouched) ----
{
    const r = dispatch({
        type: "open",
        uri: "file:///cave6-caps.map",
        bytes: mapBytes,
        options: { gracefulMapBoundaries: true },
    });
    if (r.type === "opened") {
        const secs = r.result.layout.sections;
        const obj = secs.find((s) => s.title === OBJ_SECTION);
        check("layout: object section is lifted to top level", obj !== undefined, `found=${obj !== undefined}`);
        check("layout: object section canAdd=true", obj?.canAdd === true, `canAdd=${obj?.canAdd}`);
        check("layout: object section canModify=true", obj?.canModify === true, `canModify=${obj?.canModify}`);
        check("layout: object section render=master-detail", obj?.render === "master-detail", `render=${obj?.render}`);
        // Tiles collapsed to a non-editable placeholder (tile editing intentionally dropped).
        const tiles = secs.find((s) => s.title === "Tiles");
        check(
            "layout: Tiles present and not addable",
            tiles !== undefined && tiles.canAdd === false,
            `canAdd=${tiles?.canAdd}`,
        );
        // Read-only counts form: every field editable=false.
        const counts = secs.find((s) => s.title === "Objects");
        check("layout: read-only Objects counts form present", counts !== undefined, `found=${counts !== undefined}`);
        if (counts) {
            const ch = dispatch({
                type: "getChildren",
                sessionId: r.result.sessionId,
                nodeId: counts.nodeId,
                start: 0,
                end: 10,
            });
            const rows = ch.type === "children" ? ch.rows : [];
            const allLocked = rows.length > 0 && rows.every((row) => row.editable === false);
            check(
                "counts form: all count fields are read-only (editable=false)",
                allLocked,
                `fields=${rows.length} allLocked=${allLocked}`,
            );
            check(
                "counts form: Total Objects present",
                rows.some((row) => row.name === "Total Objects"),
                `names=${rows.map((row) => row.name).join(",")}`,
            );
        }
    } else {
        check("layout: caps-check open succeeded", false, `type=${r.type}`);
    }
}

const base = sectionTotal(objNodeId);
check("baseline: elevation 0 object count > 1", base > 1, `total=${base}`);

await goToSection(page, OBJ_SECTION, 5);

// --- add (toolbar "+") ---
await page.locator(".master .toolbar button").first().click();
await page.waitForTimeout(200);
check("objects: add (toolbar +): count +1", sectionTotal(objNodeId) === base + 1, `total=${sectionTotal(objNodeId)}`);
await doUndo();

// --- insert before row 0 ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickAction(page, "Add above");
check(
    "objects: insert-before row0: count +1",
    sectionTotal(objNodeId) === base + 1,
    `total=${sectionTotal(objNodeId)}`,
);
await doUndo();

// --- insert after row 0 ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickAction(page, "Add below");
check("objects: insert-after row0: count +1", sectionTotal(objNodeId) === base + 1, `total=${sectionTotal(objNodeId)}`);
await doUndo();

// --- reorder down row 0 ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickAction(page, "Move down");
check(
    "objects: reorder-down row0: count unchanged",
    sectionTotal(objNodeId) === base,
    `total=${sectionTotal(objNodeId)}`,
);
await doUndo();

// --- reorder up row 1 ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 1);
await clickAction(page, "Move up");
check(
    "objects: reorder-up row1: count unchanged",
    sectionTotal(objNodeId) === base,
    `total=${sectionTotal(objNodeId)}`,
);
await doUndo();

// --- duplicate row 0 ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickAction(page, "Duplicate");
check("objects: duplicate row0: count +1", sectionTotal(objNodeId) === base + 1, `total=${sectionTotal(objNodeId)}`);
await doUndo();

// --- delete single-click must NOT remove (confirm-required gate) ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickAction(page, "Delete");
check(
    "objects: delete single-click does NOT remove (confirm pending)",
    sectionTotal(objNodeId) === base,
    `total=${sectionTotal(objNodeId)}`,
);
await page.locator(`.row-actions button[aria-label="Cancel delete"]`).first().click();
await page.waitForTimeout(100);

// --- remove row 0 (two-step confirm) ---
await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await clickDelete(page);
check("objects: remove row0: count -1", sectionTotal(objNodeId) === base - 1, `total=${sectionTotal(objNodeId)}`);
await doUndo();
check("objects: undo restores baseline", sectionTotal(objNodeId) === base, `total=${sectionTotal(objNodeId)}`);

// --- read-only counts form renders with no editable input in the webview ---
// Exact name match: "Objects" is a prefix of "Elevation N Objects", so anchor on the accessible name.
await page.locator(".bb-tabs.primary").getByRole("tab", { name: "Objects", exact: true }).first().click();
await page.waitForTimeout(250);
await page.waitForSelector(".form .field", { timeout: 3000 });
const countFields = await page.locator(".form .field").count();
const enabledInputs = await page.locator(".form .field input:not([disabled]):not([readonly])").count();
check("counts form (webview): fields render", countFields >= 4, `fields=${countFields}`);
check("counts form (webview): no editable input", enabledInputs === 0, `enabledInputs=${enabledInputs}`);

await goToSection(page, OBJ_SECTION, 5);
await selectRow(page, 0);
await page.screenshot({ path: path.join(here, "shot-map-objects.png") });

await browser.close();

console.log("\n=== MAP objects harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP-OBJECTS OPS PASS" : `\n${failed} MAP-OBJECTS OPS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
