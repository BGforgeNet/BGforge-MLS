/**
 * SPL single-page layout harness pass.
 *
 * SPL is migrated to the declarative layout (same Header / Abilities / Effects shape as ITM): header
 * fields in panels, then the Abilities and Effects arrays as master-detail `list` blocks, all on one page
 * (no tabs). Opens a synthetic SPL (2 abilities, 3 effects) in the REAL webview bundle and:
 *   - asserts the layout resolves (variant "spell", sections map with correct caps, panels, no tabs,
 *     opcode searchable combobox in the effect detail, positive label/value spacing);
 *   - drives the structure-op matrix through the real message path, scoped to each section's panel;
 *   - keeps the casting-free SPL remove-first-effect regression (dispatch-level, DOM-independent).
 */

import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
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

// ---- Session state ----
let sessionId = "";
let abilitiesNodeId = "";
let effectsNodeId = "";
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///synthetic.spl", bytes: splBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            const sections = r.result.layout.layout?.sections ?? {};
            abilitiesNodeId = sections["Abilities"]?.nodeId ?? "";
            effectsNodeId = sections["Effects"]?.nodeId ?? "";
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

function sectionKids(nodeId: string): number {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
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

// ---- Browser ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
activePage = page;
const assertNoCsp = installCspGate(page, "SPL");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
// SPL is tabbed (General / Abilities / Effects); capture the default (General) tab, then navigate per op.
await page.screenshot({ path: path.join(here, "shot-spl.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}

const abilitiesPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: "Abilities" }) });
const effectsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: "Effects" }) });

async function selectRow(scope: Locator, idx: number): Promise<void> {
    await scope.locator(".vlist .vrow").nth(idx).click();
    await scope.locator(".row-actions").first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(100);
}
async function clickAction(scope: Locator, ariaLabel: string): Promise<void> {
    await scope.locator(`.row-actions button[aria-label="${ariaLabel}"]`).first().click();
    await page.waitForTimeout(200);
}
async function clickDelete(scope: Locator): Promise<void> {
    await clickAction(scope, "Delete");
    await scope.locator(`.row-actions button[aria-label="Confirm delete"]`).first().click();
    await page.waitForTimeout(200);
}
async function waitRows(scope: Locator, n: number): Promise<void> {
    await scope
        .locator(".vlist .vrow")
        .nth(n - 1)
        .waitFor({ timeout: 5000 });
}

// ---- Layout assertions ----
{
    const r = dispatch({ type: "open", uri: "file:///caps.spl", bytes: splBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'spell'", L?.variantId === "spell", `variantId=${L?.variantId}`);
        check(
            "layout: Abilities canAdd+canModify",
            L?.sections["Abilities"]?.canAdd === true && L?.sections["Abilities"]?.canModify === true,
            JSON.stringify(L?.sections["Abilities"]),
        );
        check(
            "layout: Effects canModify, not canAdd",
            L?.sections["Effects"]?.canAdd === false && L?.sections["Effects"]?.canModify === true,
            JSON.stringify(L?.sections["Effects"]),
        );
    }
}
const dom = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent);
    const masterDetails = document.querySelectorAll(".layout-root .master-detail").length;
    const tabs = document.querySelectorAll(".bb-tabs").length;
    let minGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minGap) minGap = gap;
    }
    return { panels, masterDetails, tabs, minGap };
});
check(
    "layout: General tab panels render (Spell / Flags / Exclusion)",
    JSON.stringify(dom.panels) === JSON.stringify(["Spell", "Flags", "Exclusion"]),
    JSON.stringify(dom.panels),
);
check("layout: top-level tabs render (General / Abilities / Effects)", dom.tabs >= 1, `tabStrips=${dom.tabs}`);
check("layout: label/value gap is positive (no overlap)", dom.minGap >= 4, `minGap=${dom.minGap}px`);

// ---- Baseline ----
check("baseline: 2 abilities", sectionKids(abilitiesNodeId) === 2, `total=${sectionKids(abilitiesNodeId)}`);
check("baseline: 3 effects", sectionKids(effectsNodeId) === 3, `total=${sectionKids(effectsNodeId)}`);

// ---- Abilities ops ----
await clickTab("Abilities");
await waitRows(abilitiesPanel, 2);
await abilitiesPanel.locator(".master .toolbar button").first().click();
await page.waitForTimeout(200);
check("abilities: add: +1", sectionKids(abilitiesNodeId) === 3, `total=${sectionKids(abilitiesNodeId)}`);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Add below");
check("abilities: insert-after row0: +1", sectionKids(abilitiesNodeId) === 3, `total=${sectionKids(abilitiesNodeId)}`);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Move down");
check(
    "abilities: reorder-down row0: unchanged",
    sectionKids(abilitiesNodeId) === 2,
    `total=${sectionKids(abilitiesNodeId)}`,
);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Duplicate");
check("abilities: duplicate row0: +1", sectionKids(abilitiesNodeId) === 3, `total=${sectionKids(abilitiesNodeId)}`);
await doUndo();

await selectRow(abilitiesPanel, 1);
await clickDelete(abilitiesPanel);
check("abilities: remove row1: -1", sectionKids(abilitiesNodeId) === 1, `total=${sectionKids(abilitiesNodeId)}`);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Delete");
const armedA = await abilitiesPanel.locator(`.row-actions button[aria-label="Confirm delete"]`).count();
check("abilities: confirm armed on entry A", armedA === 1, `count=${armedA}`);
await selectRow(abilitiesPanel, 1);
const armedB = await abilitiesPanel.locator(`.row-actions button[aria-label="Confirm delete"]`).count();
check("abilities: switching entry clears pending confirm", armedB === 0, `count=${armedB}`);

// ---- Effects ops ----
await clickTab("Effects");
await waitRows(effectsPanel, 3);
await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Add above");
check("effects: insert-before row0: +1", sectionKids(effectsNodeId) === 4, `total=${sectionKids(effectsNodeId)}`);
await doUndo();

await selectRow(effectsPanel, 1);
await clickAction(effectsPanel, "Move down");
check(
    "effects: reorder-down row1 (same owner): unchanged",
    sectionKids(effectsNodeId) === 3,
    `total=${sectionKids(effectsNodeId)}`,
);
await doUndo();

await selectRow(effectsPanel, 1);
await clickDelete(effectsPanel);
check("effects: remove row1: -1", sectionKids(effectsNodeId) === 2, `total=${sectionKids(effectsNodeId)}`);
await doUndo();

await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .form .field").first().waitFor({ timeout: 3000 });
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("effects: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

// ---- Regression: casting-free SPL remove-first-effect (dispatch-level) ----
{
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
        const regrEffectsNodeId = regrR.result.layout.layout?.sections["Effects"]?.nodeId ?? "";
        const before = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: casting-free spl has 1 effect",
            (before.type === "children" ? before.total : -1) === 1,
            `count=${before.type === "children" ? before.total : -1}`,
        );
        const firstEffectId = before.type === "children" ? (before.rows[0]?.id ?? "") : "";
        const removeR = dispatch({
            type: "structureOp",
            sessionId: regrSession,
            op: { op: "remove", entryId: firstEffectId },
        });
        check("regression: remove-first-effect did not error", removeR.type !== "error", `type=${removeR.type}`);
        const after = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: effect count dropped to 0",
            (after.type === "children" ? after.total : -1) === 0,
            `count=${after.type === "children" ? after.total : -1}`,
        );
    }
}

// ---- Screenshots ----
await page.screenshot({ path: path.join(here, "shot-spl-abilities.png"), fullPage: true });
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .form .field").first().waitFor({ timeout: 3000 });
await page.screenshot({ path: path.join(here, "shot-spl-effects.png"), fullPage: true });

await browser.close();

console.log("\n=== SPL layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL SPL ASSERTIONS PASS" : `\n${failed} SPL ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
