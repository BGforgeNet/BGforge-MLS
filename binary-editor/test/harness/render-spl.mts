/**
 * SPL master-detail harness pass.
 *
 * Opens a synthetic SPL (2 abilities, 3 effects) in the REAL webview bundle
 * (app.html), then drives every structure op through the actual message path
 * the webview uses (webview posts structureOp -> hostUp -> dispatch ->
 * changeSet reply). Row assertions use dispatch getChildren (Node-side ground
 * truth). Layout/caps are asserted from the open result.
 *
 * Regression target: removing the only effect of a casting-free spell
 * (castingFeatureBlocksCount = 0) via the dispatch structureOp path, which
 * exercises the same equipping-range clamp fix that was applied to ITM
 * (commit db749e07) and is shared with SPL through the IE structure-op core.
 *
 * Synthetic fixture layout:
 *   casting effects: 0
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
import { splParser } from "../../../binary/src/spl/index";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "../../../binary/src/spl/canonical-reader";
import { serializeSplCanonicalDocument } from "../../../binary/src/spl/canonical-writer";
import { defaultSplAbility } from "../../../binary/src/spl/entity-ops";
import { defaultIeEffect } from "../../../binary/src/ie-common/structure-ops";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Build synthetic SPL bytes ----
const FIXTURE = path.join(here, "../../../external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl");
const baseParsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
if (baseParsed.errors) throw new Error("fixture parse errors: " + baseParsed.errors.join(", "));
const baseDoc = getSplCanonicalDocument(baseParsed) ?? rebuildSplCanonicalDocument(baseParsed);
if (!baseDoc) throw new Error("no canonical doc from fixture");

const mkEffect = (opcode: number) => ({ ...defaultIeEffect(), opcode });
const syntheticDoc = {
    ...baseDoc,
    header: { ...baseDoc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
    abilities: [
        { ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 },
        { ...defaultSplAbility(), featureBlocksOffset: 1, featureBlocksCount: 2 },
    ],
    effects: [mkEffect(10), mkEffect(20), mkEffect(21)],
};
const splBytes = serializeSplCanonicalDocument(syntheticDoc);

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
        const r = dispatch({ type: "open", uri: "file:///synthetic.spl", bytes: splBytes });
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

const cspMessages: string[] = [];
const isCspViolation = (text: string): boolean => /Content Security Policy/i.test(text) || /Refused to/i.test(text);
page.on("console", (msg) => {
    const text = msg.text();
    if (isCspViolation(text)) cspMessages.push("[console:" + msg.type() + "] " + text);
});
page.on("pageerror", (e) => {
    if (isCspViolation(e.message)) cspMessages.push("[pageerror] " + e.message);
    else console.log("[pageerror]", e.message);
});

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));

// Wait for the SPL to open and tabs to appear.
await page.waitForSelector(".tabs button", { timeout: 5000 });

// ---- Layout / caps assertions ----
// A second open on the same bytes gives us a fresh layout to inspect caps without
// disturbing the browser session's sessionId.
{
    const r = dispatch({ type: "open", uri: "file:///synthetic-caps-check.spl", bytes: splBytes });
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
// REGRESSION: casting-free spell - remove the only effect of a spell
// with castingFeatureBlocksCount = 0 and one ability owning one effect.
// Exercises the same equipping-range clamp that was fixed in ITM
// (commit db749e07) via the shared IE structure-op core.
// Exercised via dispatch - the same code path the webview triggers.
// ============================================================
{
    // Build a synthetic SPL: castingFeatureBlocksCount=0, 1 ability owning 1 effect.
    const regrDoc = {
        ...baseDoc,
        header: { ...baseDoc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
        abilities: [{ ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 }],
        effects: [mkEffect(99)],
    };
    const regrBytes = serializeSplCanonicalDocument(regrDoc);

    const regrR = dispatch({ type: "open", uri: "file:///spl-regr.spl", bytes: regrBytes });
    if (regrR.type !== "opened") {
        check("regression: casting-free spl open succeeded", false, `type=${regrR.type}`);
    } else {
        const regrSession = regrR.result.sessionId;
        const regrEffectsNodeId = regrR.result.layout.sections.find((s) => s.title === "Effects")?.nodeId ?? "";
        const regrBefore = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        const beforeCount = regrBefore.type === "children" ? regrBefore.total : -1;
        check("regression: casting-free spl has 1 effect before remove", beforeCount === 1, `count=${beforeCount}`);

        const removeR = dispatch({
            type: "structureOp",
            sessionId: regrSession,
            op: { op: "remove", entryPath: ["Effects", "Effect 1"] },
        });
        check("regression: remove-first-effect did not return error", removeR.type !== "error", `type=${removeR.type}`);

        if (removeR.type === "error") {
            check("regression: (error message)", false, `message=${(removeR as { message: string }).message}`);
        }

        const regrAfter = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        const afterCount = regrAfter.type === "children" ? regrAfter.total : -1;
        check("regression: effect count dropped to 0", afterCount === 0, `count=${afterCount}`);
    }
}

// ---- Screenshots ----
await goToSection(page, "Abilities", 2);
await page.screenshot({ path: path.join(here, "shot-spl-abilities.png") });
await goToSection(page, "Effects", 3);
await page.screenshot({ path: path.join(here, "shot-spl-effects.png") });

await browser.close();

// ============================================================
// Report
// ============================================================
console.log("\n=== SPL harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL SPL OPS PASS" : `\n${failed} SPL OPS FAILED`);
if (cspMessages.length > 0) {
    console.log("\nCSP VIOLATION(S) detected:");
    for (const m of cspMessages) console.log("  " + m);
    console.log("\nSPL CSP FAILED");
    process.exit(1);
}
console.log("CSP: no violations");
if (failed > 0) process.exit(1);
