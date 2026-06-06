/**
 * CRE single-page layout harness pass.
 *
 * CRE is migrated to the declarative layout: the 105-field header is curated into panels (Identity / Stats /
 * Combat / Resistances / Skills / Colors / Scripts / References), the two flag words render as flag columns,
 * the 40 equipped-item slots as a grid, and the five variable-length sections (Known Spells, Spell
 * Memorization Info, Memorized Spells, Effects, Items) as master-detail `list` blocks - all on one page (no
 * section tabs). This driver opens a real BG2 mage CRE in the REAL webview bundle and:
 *   - asserts the layout resolves (variant "creature", sections map with correct caps, all header/grid panels,
 *     no tabs, the opcode renders as a searchable combobox in the effect detail, label/value spacing is
 *     non-zero in both the field panels and the item-slots grid);
 *   - drives a representative structure op on two sections (Known Spells add/undo, Effects insert/remove/undo)
 *     through the actual message path (webview posts structureOp -> hostUp -> dispatch -> changeSet reply);
 *   - keeps a dispatch-level round-trip regression (open -> serialize -> byte-identical).
 *
 * Fixture: a real vendored CRE (edwin6 - a BG2 mage with known/memorized spells, effects, and items).
 */

import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { creParser } from "../../../binary/src/cre/index";

const here = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.join(here, "../../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const creBytes = new Uint8Array(fs.readFileSync(FIXTURE));
{
    const parsed = creParser.parse(creBytes);
    if (parsed.errors) throw new Error("fixture parse errors: " + parsed.errors.join(", "));
}

// ---- Session state shared between browser page and Node ----
let sessionId = "";
const sectionNodeId: Record<string, string> = {};
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///edwin6.cre", bytes: creBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            const sections = r.result.layout.layout?.sections ?? {};
            for (const [name, s] of Object.entries(sections)) sectionNodeId[name] = s.nodeId;
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

function sectionCount(nodeId: string): number {
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

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
activePage = page;
const assertNoCsp = installCspGate(page, "CRE");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root", { timeout: 5000 });
// All five list sections render at once (no tabs); wait for the master-detail panes.
await page.waitForFunction(() => document.querySelectorAll(".layout-root .master-detail").length >= 5, undefined, {
    timeout: 5000,
});
await page.waitForTimeout(150);

const knownSpellsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: "Known Spells" }) });
const effectsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: /^Effects$/ }) });

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

// ============================================================
// Layout assertions
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///caps.cre", bytes: creBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'creature'", L?.variantId === "creature", `variantId=${L?.variantId}`);
        check(
            "layout: Known Spells canAdd+canModify",
            L?.sections["Known Spells"]?.canAdd === true && L?.sections["Known Spells"]?.canModify === true,
            JSON.stringify(L?.sections["Known Spells"]),
        );
        check(
            "layout: Effects canAdd+canModify",
            L?.sections["Effects"]?.canAdd === true && L?.sections["Effects"]?.canModify === true,
            JSON.stringify(L?.sections["Effects"]),
        );
        check(
            "layout: Memorized Spells canModify, not canAdd (slice section)",
            L?.sections["Memorized Spells"]?.canAdd === false && L?.sections["Memorized Spells"]?.canModify === true,
            JSON.stringify(L?.sections["Memorized Spells"]),
        );
    }
}
const dom = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent);
    const masterDetails = document.querySelectorAll(".layout-root .master-detail").length;
    const tabs = document.querySelectorAll(".bb-tabs").length;
    const gridCells = document.querySelectorAll(".layout-root .grid .skill").length;
    // Spacing guard: in any fields panel, the label right edge must sit clearly left of the control.
    let minFieldGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minFieldGap) minFieldGap = gap;
    }
    // Spacing guard for the item-slots grid: each grid cell's label must not overlap its value.
    let minGridGap = Infinity;
    for (const cell of Array.from(document.querySelectorAll(".layout-root .grid .skill"))) {
        const label = cell.querySelector(".nm");
        const control = cell.querySelector(".field-control, input, select");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minGridGap) minGridGap = gap;
    }
    return { panels, masterDetails, tabs, gridCells, minFieldGap, minGridGap };
});
const expectedPanels = [
    "Identity",
    "Creature Flags",
    "Status Flags",
    "Class & Alignment",
    "Attributes",
    "Morale",
    "Combat",
    "Health & XP",
    "Saving Throws",
    "Resistances",
    "Skills",
    "Colors",
    "Scripts",
    "References",
    "Item Slots",
    "Known Spells",
    "Spell Memorization Info",
    "Memorized Spells",
    "Effects",
    "Items",
];
check(
    "layout: all header + grid + list panels render in order",
    JSON.stringify(dom.panels) === JSON.stringify(expectedPanels),
    JSON.stringify(dom.panels),
);
check("layout: five master-detail list sections render", dom.masterDetails === 5, `count=${dom.masterDetails}`);
check("layout: no section tabs (single page)", dom.tabs === 0, `count=${dom.tabs}`);
check("layout: item-slots grid renders 40 cells", dom.gridCells === 40, `count=${dom.gridCells}`);
check(
    "layout: field label/value gap is positive (no overlap)",
    dom.minFieldGap >= 4,
    `minFieldGap=${dom.minFieldGap}px`,
);
check("layout: grid label/value gap is positive (no overlap)", dom.minGridGap >= 4, `minGridGap=${dom.minGridGap}px`);

// ============================================================
// Baseline counts (Node-side ground truth)
// ============================================================
const baseKnown = sectionCount(sectionNodeId["Known Spells"]!);
const baseEffects = sectionCount(sectionNodeId["Effects"]!);
check("baseline: known spells count >= 0", baseKnown >= 0, `count=${baseKnown}`);
check("baseline: effects count >= 1", baseEffects >= 1, `count=${baseEffects}`);

// ============================================================
// KNOWN SPELLS: add via section toolbar, then undo
// ============================================================
await knownSpellsPanel.locator(".master .toolbar button").first().click();
await page.waitForTimeout(200);
check(
    "known spells: add: count +1",
    sectionCount(sectionNodeId["Known Spells"]!) === baseKnown + 1,
    `count=${sectionCount(sectionNodeId["Known Spells"]!)}`,
);
await doUndo();
check(
    "known spells: undo: back to baseline",
    sectionCount(sectionNodeId["Known Spells"]!) === baseKnown,
    `count=${sectionCount(sectionNodeId["Known Spells"]!)}`,
);

// ============================================================
// EFFECTS: insert-before / duplicate / remove, each undone
// ============================================================
await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Add above");
check(
    "effects: insert-before row0: +1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects + 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Duplicate");
check(
    "effects: duplicate row0: +1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects + 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

await selectRow(effectsPanel, 0);
await clickDelete(effectsPanel);
check(
    "effects: remove row0: -1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects - 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

// ============================================================
// Effect detail: opcode renders as a searchable combobox (spec searchableEnum) in the list-detail form.
// ============================================================
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .form .field").first().waitFor({ timeout: 3000 });
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("effects: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

// ============================================================
// REGRESSION: open -> serialize round-trips byte-identical (dispatch-level, DOM-independent).
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///roundtrip.cre", bytes: creBytes });
    if (r.type !== "opened") {
        check("regression: roundtrip open succeeded", false, `type=${r.type}`);
    } else {
        const s = dispatch({ type: "serialize", sessionId: r.result.sessionId });
        const out = s.type === "serialized" ? s.bytes : new Uint8Array();
        const identical = out.length === creBytes.length && out.every((b, i) => b === creBytes[i]);
        check(
            "regression: save round-trips byte-identical",
            identical,
            `outLen=${out.length} srcLen=${creBytes.length}`,
        );
    }
}

// ---- Screenshots ----
await page.screenshot({ path: path.join(here, "shot-cre.png"), fullPage: true });
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .form .field").first().waitFor({ timeout: 3000 });
await page.screenshot({ path: path.join(here, "shot-cre-effects.png"), fullPage: true });

await browser.close();

console.log("\n=== CRE layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL CRE ASSERTIONS PASS" : `\n${failed} CRE ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
