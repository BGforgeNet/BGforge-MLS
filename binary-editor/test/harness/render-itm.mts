/**
 * ITM master-detail harness pass.
 *
 * Opens a synthetic ITM (2 abilities, 3 effects) in the REAL webview bundle
 * (app.html), then drives every structure op through the actual message path
 * the webview uses (webview posts structureOp -> hostUp -> dispatch ->
 * changeSet reply). Row assertions use dispatch getChildren (Node-side ground
 * truth). Layout/caps are asserted from the open result.
 *
 * Regression target: removing the first (only) effect of wm_sbook.itm
 * (equipping count 0) through the dispatch structureOp path, which previously
 * threw due to an unclamped negative equipping-range shift.
 *
 * Synthetic fixture layout:
 *   equipping effects: 0
 *   ability 0 ("Ability 1"): 1 effect, opcode 10
 *   ability 1 ("Ability 2"): 2 effects, opcode 20 + 21
 *   Total effects: 3
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { itmParser } from "../../../binary/src/itm/index";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../../../binary/src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../../../binary/src/itm/canonical-writer";
import { defaultItmAbility, defaultItmEffect } from "../../../binary/src/itm/entity-ops";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Build synthetic ITM bytes ----
const FIXTURE = path.join(here, "../../../external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const baseParsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
if (baseParsed.errors) throw new Error("fixture parse errors: " + baseParsed.errors.join(", "));
const baseDoc = getItmCanonicalDocument(baseParsed) ?? rebuildItmCanonicalDocument(baseParsed);
if (!baseDoc) throw new Error("no canonical doc from fixture");

const mkEffect = (opcode: number) => ({ ...defaultItmEffect(), opcode });
const syntheticDoc = {
    ...baseDoc,
    header: { ...baseDoc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
    abilities: [
        { ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 1 },
        { ...defaultItmAbility(), featureBlockIndex: 1, featureBlockCount: 2 },
    ],
    effects: [mkEffect(10), mkEffect(20), mkEffect(21)],
};
const itmBytes = serializeItmCanonicalDocument(syntheticDoc);

// ---- Session state shared between browser page and Node ----
let sessionId = "";
let abilitiesNodeId = "";
let effectsNodeId = "";
// Reference to the page so that undo/redo can post an invalidated message.
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) {
        activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
    }
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///synthetic.itm", bytes: itmBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            abilitiesNodeId = r.result.layout.sections.find((s) => s.title === "Abilities")?.nodeId ?? "";
            effectsNodeId = r.result.layout.sections.find((s) => s.title === "Effects")?.nodeId ?? "";
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

// Node-side ground truth for a section.
function sectionKids(nodeId: string): { total: number; names: string[] } {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
    return r.type === "children" ? { total: r.total, names: r.rows.map((row) => row.name) } : { total: 0, names: [] };
}

// Undo via dispatch, then tell the webview to invalidate so VirtualList re-fetches.
async function doUndo(): Promise<void> {
    dispatch({ type: "undo", sessionId });
    postToWebview({ type: "invalidated" });
    await activePage?.waitForTimeout(150);
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
activePage = page;
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));

// Wait for the ITM to open and tabs to appear.
await page.waitForSelector(".tabs button", { timeout: 5000 });

// ---- Layout / caps assertions ----
// A second open on the same bytes gives us a fresh layout to inspect caps without
// disturbing the browser session's sessionId.
{
    const r = dispatch({ type: "open", uri: "file:///synthetic-caps-check.itm", bytes: itmBytes });
    if (r.type === "opened") {
        const abs = r.result.layout.sections.find((s) => s.title === "Abilities");
        const efx = r.result.layout.sections.find((s) => s.title === "Effects");
        check("layout: Abilities canAdd=true", abs?.canAdd === true, `canAdd=${abs?.canAdd}`);
        check("layout: Abilities canModify=true", abs?.canModify === true, `canModify=${abs?.canModify}`);
        check("layout: Effects canAdd=false", efx?.canAdd === false, `canAdd=${efx?.canAdd}`);
        check("layout: Effects canModify=true", efx?.canModify === true, `canModify=${efx?.canModify}`);
        check("layout: Abilities render=master-detail", abs?.render === "master-detail", `render=${abs?.render}`);
        check("layout: Effects render=master-detail", efx?.render === "master-detail", `render=${efx?.render}`);
    } else {
        check("layout: caps-check open succeeded", false, `type=${r.type}`);
    }
}

// ---- Baseline ----
check("baseline: 2 abilities", sectionKids(abilitiesNodeId).total === 2, `total=${sectionKids(abilitiesNodeId).total}`);
check("baseline: 3 effects", sectionKids(effectsNodeId).total === 3, `total=${sectionKids(effectsNodeId).total}`);

// ---- Helper: navigate to a section tab and wait for rows ----
async function goToSection(p: Page, tabLabel: string, expectedRows: number): Promise<void> {
    await p.locator(".tabs button", { hasText: tabLabel }).first().click();
    await p.waitForTimeout(200);
    // Wait for VirtualList to render at least expectedRows .vrow elements.
    await p.waitForFunction((n) => document.querySelectorAll(".vlist .vrow").length >= n, expectedRows, {
        timeout: 5000,
    });
}

// ---- Helper: click a .vrow to select it and wait for RowActions ----
async function selectRow(p: Page, idx: number): Promise<void> {
    await p.locator(".vlist .vrow").nth(idx).click();
    await p.waitForSelector(".row-actions", { timeout: 3000 });
    await p.waitForTimeout(100);
}

// ---- Helper: click a RowActions button ----
async function clickAction(p: Page, label: string): Promise<void> {
    await p.locator(".row-actions button", { hasText: label }).first().click();
    await p.waitForTimeout(200);
}

// ============================================================
// ABILITIES section
// ============================================================

await goToSection(page, "Abilities", 2);

// --- Ability: add (toolbar "+" button) ---
await page.locator(".master .toolbar button").first().click();
await page.waitForTimeout(200);
check(
    "abilities: add: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: insert before row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "+before");
check(
    "abilities: insert-before row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: insert after row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "+after");
check(
    "abilities: insert-after row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: reorder down row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "v");
check(
    "abilities: reorder-down row0: count unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: reorder up row 1 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);
await clickAction(page, "^");
check(
    "abilities: reorder-up row1: count unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: duplicate row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "dup");
check(
    "abilities: duplicate row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: remove row 1 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);
await clickAction(page, "del");
check(
    "abilities: remove row1: count -1",
    sectionKids(abilitiesNodeId).total === 1,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// ============================================================
// EFFECTS section
// ============================================================

await goToSection(page, "Effects", 3);

// --- Effect: insert before row 0 ---
await selectRow(page, 0);
await clickAction(page, "+before");
check(
    "effects: insert-before row0: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: insert after row 0 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 0);
await clickAction(page, "+after");
check(
    "effects: insert-after row0: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: reorder down row 1 (ability1 owns effects[1,2] - valid same-owner swap) ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickAction(page, "v");
check(
    "effects: reorder-down row1 (same owner): count unchanged",
    sectionKids(effectsNodeId).total === 3,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: reorder up row 2 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 2);
await clickAction(page, "^");
check(
    "effects: reorder-up row2 (same owner): count unchanged",
    sectionKids(effectsNodeId).total === 3,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: duplicate row 1 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickAction(page, "dup");
check(
    "effects: duplicate row1: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: remove row 1 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickAction(page, "del");
check(
    "effects: remove row1: count -1",
    sectionKids(effectsNodeId).total === 2,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// ============================================================
// REGRESSION: wm_sbook.itm - remove first (only) effect of an
// item with equipping count 0. Previously threw due to an
// unclamped negative equipping-range start shift (commit db749e07).
// Exercised via dispatch - the same code path the webview triggers.
// ============================================================
{
    const wmBytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const wmR = dispatch({ type: "open", uri: "file:///wm_sbook.itm", bytes: wmBytes });
    if (wmR.type !== "opened") {
        check("regression: wm_sbook open succeeded", false, `type=${wmR.type}`);
    } else {
        const wmSession = wmR.result.sessionId;
        const wmEffectsNodeId = wmR.result.layout.sections.find((s) => s.title === "Effects")?.nodeId ?? "";
        const wmBefore = dispatch({
            type: "getChildren",
            sessionId: wmSession,
            nodeId: wmEffectsNodeId,
            start: 0,
            end: 10,
        });
        const beforeCount = wmBefore.type === "children" ? wmBefore.total : -1;
        check("regression: wm_sbook has 1 effect before remove", beforeCount === 1, `count=${beforeCount}`);

        const removeR = dispatch({
            type: "structureOp",
            sessionId: wmSession,
            op: { op: "remove", entryPath: ["Effects", "Effect 1"] },
        });
        check("regression: remove-first-effect did not return error", removeR.type !== "error", `type=${removeR.type}`);

        if (removeR.type === "error") {
            check("regression: (error message)", false, `message=${(removeR as { message: string }).message}`);
        }

        const wmAfter = dispatch({
            type: "getChildren",
            sessionId: wmSession,
            nodeId: wmEffectsNodeId,
            start: 0,
            end: 10,
        });
        const afterCount = wmAfter.type === "children" ? wmAfter.total : -1;
        check("regression: effect count dropped to 0", afterCount === 0, `count=${afterCount}`);
    }
}

// ---- Screenshots ----
await goToSection(page, "Abilities", 2);
await page.screenshot({ path: path.join(here, "shot-itm-abilities.png") });
await goToSection(page, "Effects", 3);
await page.screenshot({ path: path.join(here, "shot-itm-effects.png") });

await browser.close();

// ============================================================
// Report
// ============================================================
console.log("\n=== ITM harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL ITM OPS PASS" : `\n${failed} ITM OPS FAILED`);
if (failed > 0) process.exit(1);
