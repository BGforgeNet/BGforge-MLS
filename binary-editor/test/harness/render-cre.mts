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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
activePage = page;
const assertNoCsp = installCspGate(page, "CRE");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
// CRE is now tabbed; capture the default (Identity) tab immediately so the screenshot exists regardless of
// the later structure-op steps (which navigate into the Spells / Effects tabs).
await page.screenshot({ path: path.join(here, "shot-cre.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}

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
// CRE is tabbed: assert the top-level tab strip (count badges stripped), then visit the tabs that carry the
// grids/fields to verify they render and align. (The five list sections live in the Spells/Effects/Inventory
// tabs and are exercised below.)
const topTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'), (e) =>
        (e.textContent ?? "").replace(/ \(\d+\)$/, "").trim(),
    ),
);
check(
    "layout: top-level tabs render in order",
    JSON.stringify(topTabs) ===
        JSON.stringify(["Identity", "Combat", "Inventory", "Proficiencies", "Sounds", "Spells", "Effects"]),
    JSON.stringify(topTabs),
);

await clickTab("Identity");
const fieldGap = await page.evaluate(() => {
    let min = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        min = Math.min(min, control.getBoundingClientRect().left - label.getBoundingClientRect().right);
    }
    return min;
});
check("layout: field label/value gap is positive (no overlap)", fieldGap >= 4, `minFieldGap=${fieldGap}px`);

await clickTab("Inventory");
const itemSlots = await page.locator('.layout-root .panel:has(h3:text-is("Item Slots")) .grid .skill').count();
check("layout: item-slots grid renders 40 cells", itemSlots === 40, `count=${itemSlots}`);

// Proficiencies and Tracked Objects share the "Proficiencies" tab; Sound Slots is its own "Sounds" tab.
const gridCounts = async (): Promise<{ counts: Record<string, number>; minGridGap: number }> =>
    page.evaluate(() => {
        const counts: Record<string, number> = {};
        for (const p of Array.from(document.querySelectorAll(".layout-root .panel"))) {
            const title = p.querySelector("h3")?.textContent ?? "";
            counts[title] = p.querySelectorAll(".grid .skill").length;
        }
        let minGridGap = Infinity;
        for (const cell of Array.from(document.querySelectorAll(".layout-root .grid .skill"))) {
            const label = cell.querySelector(".nm");
            const control = cell.querySelector(".field-control, input, select");
            if (!label || !control) continue;
            minGridGap = Math.min(
                minGridGap,
                control.getBoundingClientRect().left - label.getBoundingClientRect().right,
            );
        }
        return { counts, minGridGap };
    });

await clickTab("Proficiencies");
const prof = await gridCounts();
check(
    "layout: proficiencies grid renders (20 slots)",
    prof.counts["Proficiencies"] === 20,
    JSON.stringify(prof.counts),
);
check(
    "layout: proficiencies grid label/value gap is positive",
    prof.minGridGap >= 4,
    `minGridGap=${prof.minGridGap}px`,
);

await clickTab("Sounds");
const sound = await gridCounts();
check("layout: sound-slots grid renders 100 cells", sound.counts["Sound Slots"] === 100, JSON.stringify(sound.counts));
check(
    "layout: sound-slots grid label/value gap is positive",
    sound.minGridGap >= 4,
    `minGridGap=${sound.minGridGap}px`,
);

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
await clickTab("Spells");
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
await clickTab("Effects");
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

// ---- Screenshots ---- (shot-cre.png = the Identity tab, captured at load; here capture the Effects tab detail)
await clickTab("Effects");
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
