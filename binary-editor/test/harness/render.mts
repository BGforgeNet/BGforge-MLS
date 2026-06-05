import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const mapBytes = new Uint8Array(fs.readFileSync(path.join(repo, "client/testFixture/maps/arcaves.map")));
let sessionId = "";
let gvNodeId = "";

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: mapBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            gvNodeId = r.result.layout.sections.find((s) => s.title === "Global Variables")?.nodeId ?? "";
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
    if (m.type === "editField") {
        const r = dispatch({ type: "editField", sessionId, nodeId: m.nodeId, value: m.value });
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
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

// Node-side ground truth for Global Variables (total + per-row display values).
function gv(): { total: number; values: (string | undefined)[] } {
    const r = dispatch({ type: "getChildren", sessionId, nodeId: gvNodeId, start: 0, end: 400 });
    return r.type === "children"
        ? { total: r.total, values: r.rows.map((row) => row.displayValue) }
        : { total: 0, values: [] };
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// Virtual index of the currently-active row, read from its absolute top (scroll-independent).
async function activeIdx(page: Page): Promise<number> {
    return page.evaluate(() => {
        const a = document.querySelector(".row-actions")?.closest(".vrow.inline") as HTMLElement | null;
        return a ? Math.round(parseInt(a.style.top, 10) / 34) : -1;
    });
}
async function clickAction(page: Page, label: string): Promise<void> {
    await page.locator(".row-actions button", { hasText: label }).first().click();
    await page.waitForTimeout(150);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".bb-tabs.primary [role='tab']", { timeout: 5000 });
await page.locator(".bb-tabs.primary [role='tab']", { hasText: "Global Variables" }).first().click();
await page.waitForSelector(".vrow.inline", { timeout: 5000 });

const base = gv().total;
check("baseline total", base === 21, `total=${base}`);

// --- reorder on a DISTINCT adjacent pair (original data) so the value swap is non-vacuous ---
const v0 = gv().values;
let j = v0.findIndex((val, i) => i + 1 < v0.length && val !== v0[i + 1]);
if (j < 0) j = 0; // fallback: all equal (swap still valid, just not distinctive)
const pairBefore = v0.slice(j, j + 2);
await page.locator(".vrow.inline").nth(j).click();
await page.waitForTimeout(120);
check(
    `activate row ${j} (distinct pair ${pairBefore.join()})`,
    (await activeIdx(page)) === j,
    `activeIdx=${await activeIdx(page)}`,
);

await clickAction(page, "v"); // reorder down
const pairDown = gv().values.slice(j, j + 2);
check(
    "reorder down: swaps values",
    pairDown[0] === pairBefore[1] && pairDown[1] === pairBefore[0],
    `${pairBefore.join()} -> ${pairDown.join()}`,
);
check("reorder down: selects idx j+1", (await activeIdx(page)) === j + 1, `activeIdx=${await activeIdx(page)}`);

await clickAction(page, "^"); // reorder up - restores
const pairUp = gv().values.slice(j, j + 2);
check("reorder up: restores values", pairUp[0] === pairBefore[0] && pairUp[1] === pairBefore[1], `-> ${pairUp.join()}`);
check("reorder up: selects idx j", (await activeIdx(page)) === j, `activeIdx=${await activeIdx(page)}`);

// --- insert / delete / duplicate + selection, operating at idx 3 ---
await page.locator(".vrow.inline").nth(3).click();
await page.waitForTimeout(120);
check("activate row 3", (await activeIdx(page)) === 3, `activeIdx=${await activeIdx(page)}`);

await clickAction(page, "+after"); // insert after idx 3 -> new entry at idx 4
check("insert after: total+1", gv().total === base + 1, `total=${gv().total}`);
check("insert after: selects idx 4", (await activeIdx(page)) === 4, `activeIdx=${await activeIdx(page)}`);

await clickAction(page, "+before"); // insert before active idx 4 -> inserted occupies idx 4
check("insert before: total+1", gv().total === base + 2, `total=${gv().total}`);
check("insert before: selects idx 4", (await activeIdx(page)) === 4, `activeIdx=${await activeIdx(page)}`);

await clickAction(page, "del"); // delete idx 4 -> neighbor at idx 4
check("delete: total-1", gv().total === base + 1, `total=${gv().total}`);
check("delete: selects neighbor idx 4", (await activeIdx(page)) === 4, `activeIdx=${await activeIdx(page)}`);

await clickAction(page, "dup"); // duplicate idx 4 -> copy at idx 5
check("duplicate: total+1", gv().total === base + 2, `total=${gv().total}`);
check("duplicate: selects copy idx 5", (await activeIdx(page)) === 5, `activeIdx=${await activeIdx(page)}`);
await page.screenshot({ path: path.join(here, "shot-ops-final.png") });

// undo/redo: VSCode-command path (no webview button), driven at the host. 6 structural ops were applied.
let undoTotal = 0;
for (let i = 0; i < 6; i++) {
    dispatch({ type: "undo", sessionId });
    undoTotal = gv().total;
}
check("undo x6 restores baseline", undoTotal === base, `total=${undoTotal}`);
let redoTotal = 0;
for (let i = 0; i < 6; i++) {
    dispatch({ type: "redo", sessionId });
    redoTotal = gv().total;
}
check("redo x6 reapplies", redoTotal === base + 2, `total=${redoTotal}`);

await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL OPS PASS" : `\n${failed} FAILED`);
