/**
 * ITM single-page layout harness pass.
 *
 * ITM is migrated to the declarative layout: header fields in panels, then the Abilities and Effects
 * arrays as master-detail `list` blocks - both rendered at once on one page (no section tabs). This
 * driver opens a synthetic ITM (2 abilities, 3 effects) in the REAL webview bundle and:
 *   - asserts the layout resolves (variant "item", sections map with correct caps, panels, no tabs,
 *     opcode renders as a searchable combobox in the effect detail, label/value spacing is non-zero);
 *   - drives every structure op through the actual message path, scoped to each section's panel
 *     (webview posts structureOp -> hostUp -> dispatch -> changeSet reply); row counts use dispatch
 *     getChildren (Node-side ground truth);
 *   - keeps the wm_sbook.itm remove-first-effect regression (dispatch-level, DOM-independent).
 *
 * Synthetic fixture: equipping effects 0; ability0 -> 1 effect (opcode 10); ability1 -> 2 effects
 * (opcode 20, 21); 3 effects total.
 */

import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
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
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///synthetic.itm", bytes: itmBytes });
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

function sectionKids(nodeId: string): { total: number; names: string[] } {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
    return r.type === "children" ? { total: r.total, names: r.rows.map((row) => row.name) } : { total: 0, names: [] };
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
const assertNoCsp = installCspGate(page, "ITM");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
// ITM is tabbed (General / Abilities / Effects); capture the default (General) tab, then navigate per op.
await page.screenshot({ path: path.join(here, "shot-itm.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}
// Guard against the "captured the wrong tab" regression: each per-tab screenshot must be taken while that
// tab is actually the selected one. Returns the active primary tab's label (includes its count badge text).
async function activeTabLabel(): Promise<string> {
    const t = await page.locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]').first().textContent();
    return (t ?? "").trim();
}

// Panel-scoped locators: each list section is a master-detail inside the panel with the matching h3.
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
    // Delete fires immediately (no confirm step) - a single click on the Delete button removes the entry.
    await clickAction(scope, "Delete");
}
async function waitRows(scope: Locator, n: number): Promise<void> {
    await scope
        .locator(".vlist .vrow")
        .nth(n - 1)
        .waitFor({ timeout: 5000 });
}

// ============================================================
// Layout assertions
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///caps.itm", bytes: itmBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'item'", L?.variantId === "item", `variantId=${L?.variantId}`);
        check(
            "layout: Abilities canAdd+canModify+childAddSection Effects",
            L?.sections["Abilities"]?.canAdd === true &&
                L?.sections["Abilities"]?.canModify === true &&
                L?.sections["Abilities"]?.childAddSection === "Effects",
            JSON.stringify(L?.sections["Abilities"]),
        );
        check(
            "layout: Effects canAdd+canModify (section-level effect add enabled)",
            L?.sections["Effects"]?.canAdd === true && L?.sections["Effects"]?.canModify === true,
            JSON.stringify(L?.sections["Effects"]),
        );
    }
}
const dom = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent);
    const masterDetails = document.querySelectorAll(".layout-root .master-detail").length;
    const tabs = document.querySelectorAll(".bb-tabs").length;
    // "Unusable By" regroups the four usability bytes into 3 category columns (Alignment / Class / Race), each
    // a boxed subgroup. "Unusable By Kit" regroups the four kit bytes into 4 columns holding 9 base-class
    // subgroups. Collect each panel's subgroup legends (no named helpers - keepNames would inject __name,
    // undefined in the page context).
    const groupsByPanel: Record<string, string[]> = {};
    for (const p of Array.from(document.querySelectorAll(".layout-root .panel"))) {
        const title = p.querySelector("h3")?.textContent ?? "";
        const legends = Array.from(
            p.querySelectorAll(".flag-group-cols > .flag-group-col > .flag-group > legend > .flag-group-name"),
        ).map((e) => e.textContent ?? "");
        if (legends.length > 0) groupsByPanel[title] = legends;
    }
    const usabilityGroups = groupsByPanel["Unusable By"] ?? [];
    const kitGroups = groupsByPanel["Unusable By Kit"] ?? [];
    // Spacing guard: in a fields panel, the label right edge must sit clearly left of the control - a
    // zero/negative gap means labels overlap values (regression). Check the widest-label row in each panel.
    let minGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minGap) minGap = gap;
    }
    // Column-major fill guard: a multi-column fields panel fills column 1 top-to-bottom, then column 2 - so
    // the 2nd field sits directly BELOW the 1st (same left edge, greater top), not to its right. Measure the
    // Main panel's first two fields.
    let mainColMajor = false;
    const mainPanel = Array.from(document.querySelectorAll(".layout-root .panel")).find(
        (p) => p.querySelector("h3")?.textContent === "Main",
    );
    const mainFields = mainPanel ? Array.from(mainPanel.querySelectorAll(".kv.kv-multi > .field")) : [];
    if (mainFields.length >= 2) {
        const a = mainFields[0]!.getBoundingClientRect();
        const b = mainFields[1]!.getBoundingClientRect();
        mainColMajor = Math.abs(a.left - b.left) < 2 && b.top > a.top + 2;
    }
    // Equal-spacing guard: the gap between the fields grid and the adjacent Flags box must equal the gap
    // between the grid's own two columns - one uniform inter-column spacing, not a tighter inter-block one.
    // With 12 fields in 2 column-major columns, col 2 row 1 is field index 6, so its left edge minus col 1
    // row 1's right edge is the inter-column gap; the Flags box left minus the grid's right edge is the
    // inter-block gap.
    let mainColGap = -1;
    let mainBlockGap = -1;
    const kv = mainPanel?.querySelector(".kv.kv-multi");
    const flagsBox = mainPanel?.querySelector(".flag-group");
    if (kv && flagsBox && mainFields.length >= 7) {
        mainColGap = mainFields[6]!.getBoundingClientRect().left - mainFields[0]!.getBoundingClientRect().right;
        mainBlockGap = flagsBox.getBoundingClientRect().left - kv.getBoundingClientRect().right;
    }
    return { panels, masterDetails, tabs, usabilityGroups, kitGroups, minGap, mainColMajor, mainColGap, mainBlockGap };
});
check(
    "layout: General tab panels render",
    JSON.stringify(dom.panels) ===
        JSON.stringify(["Main", "Appearance", "Requirements", "Unusable By", "Unusable By Kit"]),
    JSON.stringify(dom.panels),
);
check(
    "layout: Unusable By groups by category (Alignment / Class / Race)",
    JSON.stringify(dom.usabilityGroups) === JSON.stringify(["Alignment", "Class", "Race"]),
    JSON.stringify(dom.usabilityGroups),
);
check(
    "layout: Unusable By Kit groups by base class",
    JSON.stringify(dom.kitGroups) ===
        JSON.stringify(["Cleric", "Druid", "Fighter", "Paladin", "Mage", "Ranger", "Thief", "Bard", "Other"]),
    JSON.stringify(dom.kitGroups),
);
check("layout: top-level tabs render (General / Abilities / Effects)", dom.tabs >= 1, `tabStrips=${dom.tabs}`);
check("layout: label/value gap is positive (no overlap)", dom.minGap >= 4, `minGap=${dom.minGap}px`);
check(
    "layout: multi-column fields fill top-down first (column-major), not by row",
    dom.mainColMajor,
    `mainColMajor=${dom.mainColMajor}`,
);
check(
    "layout: inter-block gap equals inter-column gap (uniform spacing)",
    dom.mainColGap > 0 && Math.abs(dom.mainColGap - dom.mainBlockGap) <= 2,
    `colGap=${dom.mainColGap}px blockGap=${dom.mainBlockGap}px`,
);

// Bulk select/deselect on the "Unusable By" panel: clicking the buttons must drive the real edit pipeline
// (editField -> changeSet) across all the byte fields the block spans, so every checkbox flips together.
const unusablePanel = page
    .locator(".panel")
    .filter({ has: page.locator("h3", { hasText: "Unusable By" }) })
    .first();
const boxCounts = async (): Promise<{ total: number; checked: number }> => ({
    total: await unusablePanel.locator('[role="checkbox"]').count(),
    checked: await unusablePanel.locator('[role="checkbox"][aria-checked="true"]').count(),
});
await unusablePanel.getByRole("button", { name: "Select all", exact: true }).click();
await page.waitForTimeout(150);
const afterSelect = await boxCounts();
check(
    "bulk: Select all checks every flag in the panel",
    afterSelect.total > 0 && afterSelect.checked === afterSelect.total,
    `${afterSelect.checked}/${afterSelect.total}`,
);
await unusablePanel.getByRole("button", { name: "Deselect all", exact: true }).click();
await page.waitForTimeout(150);
const afterDeselect = await boxCounts();
check(
    "bulk: Deselect all clears every flag in the panel",
    afterDeselect.checked === 0,
    `checked=${afterDeselect.checked}`,
);

// Per-group bulk: each subgroup has its own select/deselect icon buttons (located by aria-label, since the
// codicon glyph needs the editor's icon font absent from the harness). From the all-clear state above,
// "Select all Alignment" must check exactly the Alignment subgroup's boxes and leave the rest clear.
const alignmentGroup = unusablePanel
    .locator(".flag-group")
    .filter({ has: page.locator(".flag-group-name", { hasText: "Alignment" }) });
await unusablePanel.getByRole("button", { name: "Select all Alignment", exact: true }).click();
await page.waitForTimeout(150);
const alignTotal = await alignmentGroup.locator('[role="checkbox"]').count();
const alignChecked = await alignmentGroup.locator('[role="checkbox"][aria-checked="true"]').count();
const panelChecked = (await boxCounts()).checked;
check(
    "bulk: per-group Select all checks only that group",
    alignTotal > 0 && alignChecked === alignTotal && panelChecked === alignTotal,
    `align=${alignChecked}/${alignTotal} panel=${panelChecked}`,
);

// ============================================================
// Baseline
// ============================================================
check("baseline: 2 abilities", sectionKids(abilitiesNodeId).total === 2, `total=${sectionKids(abilitiesNodeId).total}`);
check("baseline: 3 effects", sectionKids(effectsNodeId).total === 3, `total=${sectionKids(effectsNodeId).total}`);

// ============================================================
// ABILITIES ops (scoped to the Abilities panel)
// ============================================================
await clickTab("Abilities");
await waitRows(abilitiesPanel, 2);

await abilitiesPanel.locator(".master .toolbar button").first().click();
await page.waitForTimeout(200);
check(
    "abilities: add: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Add above");
check(
    "abilities: insert-before row0: +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Add below");
check(
    "abilities: insert-after row0: +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Move down");
check(
    "abilities: reorder-down row0: unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

await selectRow(abilitiesPanel, 1);
await clickAction(abilitiesPanel, "Move up");
check(
    "abilities: reorder-up row1: unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

await selectRow(abilitiesPanel, 0);
await clickAction(abilitiesPanel, "Duplicate");
check(
    "abilities: duplicate row0: +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// Delete fires immediately - a single Delete click removes the entry (removal is undoable).
await selectRow(abilitiesPanel, 1);
await clickDelete(abilitiesPanel);
check(
    "abilities: single Delete click removes immediately",
    sectionKids(abilitiesNodeId).total === 1,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();
check(
    "abilities: undo restores the removed entry",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);

// ============================================================
// EFFECTS ops (scoped to the Effects panel)
// ============================================================
await clickTab("Effects");
await waitRows(effectsPanel, 3);

await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Add above");
check(
    "effects: insert-before row0: +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

await selectRow(effectsPanel, 1);
await clickAction(effectsPanel, "Move down");
check(
    "effects: reorder-down row1 (same owner): unchanged",
    sectionKids(effectsNodeId).total === 3,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

await selectRow(effectsPanel, 1);
await clickAction(effectsPanel, "Duplicate");
check(
    "effects: duplicate row1: +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

await selectRow(effectsPanel, 1);
await clickDelete(effectsPanel);
check("effects: remove row1: -1", sectionKids(effectsNodeId).total === 2, `total=${sectionKids(effectsNodeId).total}`);
await doUndo();

// ============================================================
// Effect detail: an ITM effect renders through the SHARED feature-block fragment (parallel panels to the EFF
// v2 body and to CRE effects), not a generic auto-form - so the detail shows `.layout-root` panels, and the
// opcode renders as a searchable combobox (spec searchableEnum).
// ============================================================
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
// The shared feature-block fragment renders through LayoutRenderer (`.detail .layout-root`), not the generic
// auto-form (which has no `.layout-root`) - so layout fields are the shared-fragment signal. The fragment is
// one untitled wire-byte-order panel: no semantic panel `h3` titles (the Resistance / Save Type flag boxes
// carry their own legends, not panel titles).
const itmEffectFields = await effectsPanel.locator(".detail .layout-root .field").count();
const itmEffectPanelTitles = await effectsPanel.locator(".detail .layout-root .panel > h3").count();
check(
    "effects: ITM effect detail renders the shared feature-block fragment in wire byte order (no semantic panel titles)",
    itmEffectFields > 10 && itmEffectPanelTitles === 0,
    `fields=${itmEffectFields} panelTitles=${itmEffectPanelTitles}`,
);
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("effects: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

// ============================================================
// REGRESSION: wm_sbook.itm remove-first-effect (equipping count 0). Dispatch-level, DOM-independent.
// ============================================================
{
    const wmBytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const wmR = dispatch({ type: "open", uri: "file:///wm_sbook.itm", bytes: wmBytes });
    if (wmR.type !== "opened") {
        check("regression: wm_sbook open succeeded", false, `type=${wmR.type}`);
    } else {
        const wmSession = wmR.result.sessionId;
        const wmEffectsNodeId = wmR.result.layout.layout?.sections["Effects"]?.nodeId ?? "";
        const wmBefore = dispatch({
            type: "getChildren",
            sessionId: wmSession,
            nodeId: wmEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: wm_sbook has 1 effect before remove",
            (wmBefore.type === "children" ? wmBefore.total : -1) === 1,
            `count=${wmBefore.type === "children" ? wmBefore.total : -1}`,
        );
        const firstEffectId = wmBefore.type === "children" ? (wmBefore.rows[0]?.id ?? "") : "";
        const removeR = dispatch({
            type: "structureOp",
            sessionId: wmSession,
            op: { op: "remove", entryId: firstEffectId },
        });
        check("regression: remove-first-effect did not error", removeR.type !== "error", `type=${removeR.type}`);
        const wmAfter = dispatch({
            type: "getChildren",
            sessionId: wmSession,
            nodeId: wmEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: effect count dropped to 0",
            (wmAfter.type === "children" ? wmAfter.total : -1) === 0,
            `count=${wmAfter.type === "children" ? wmAfter.total : -1}`,
        );
    }
}

// ---- Screenshots: each tab captured on the tab it names, with a row selected so the detail pane renders.
// (Regression: both were previously captured while the Effects tab was active, producing duplicate images.)
await clickTab("Abilities");
await waitRows(abilitiesPanel, 2);
await selectRow(abilitiesPanel, 0);
// An ITM ability renders through the SHARED ability fragment (curated panels parallel to SPL abilities and
// consistent with the effects beside it), not a generic auto-form: the detail shows `.layout-root` panels.
await abilitiesPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
const itmAbilityPanels = (await abilitiesPanel.locator(".detail .layout-root .panel h3").allInnerTexts()).map((t) =>
    t.toUpperCase(),
);
check(
    "abilities: ITM ability detail renders the shared panels (Ability/Damage/Projectile/Charges/Flags)",
    ["ABILITY", "DAMAGE", "PROJECTILE", "CHARGES", "FLAGS"].every((p) => itmAbilityPanels.includes(p)),
    JSON.stringify(itmAbilityPanels),
);
const itmAbilityDetailText = await abilitiesPanel.locator(".detail .layout-root").first().innerText();
check(
    "abilities: Melee Animation renders all three distinct slots (distinct slot-key fix)",
    ["Overhand", "Backhand", "Thrust"].every((s) => itmAbilityDetailText.includes(s)),
    JSON.stringify(["Overhand", "Backhand", "Thrust"].filter((s) => itmAbilityDetailText.includes(s))),
);
check(
    "abilities: serializer-managed feature-block pointers omitted from the detail",
    !itmAbilityDetailText.includes("Feature Block"),
    `hasFeatureBlock=${itmAbilityDetailText.includes("Feature Block")}`,
);
check(
    "screenshot: Abilities tab active for shot-itm-abilities",
    (await activeTabLabel()).includes("Abilities"),
    await activeTabLabel(),
);
await page.screenshot({ path: path.join(here, "shot-itm-abilities.png"), fullPage: true });

await clickTab("Effects");
await waitRows(effectsPanel, 3);
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
check(
    "screenshot: Effects tab active for shot-itm-effects",
    (await activeTabLabel()).includes("Effects"),
    await activeTabLabel(),
);
await page.screenshot({ path: path.join(here, "shot-itm-effects.png"), fullPage: true });

// ---- Dropdown never-clip guard (UI-GUIDELINES: a dropdown is sized to its LONGEST option label so changing
// the selection never clips). The risk is invisible at the default selection - the current value may be short
// while a longer option clips - so drive Timing to its longest option ("Instant/Permanent (after Death)") and
// assert the trigger label is not ellipsis-truncated (scrollWidth <= clientWidth). Measures the real rendered
// width, not a char-count estimate, since valueTier maps char counts to fixed ch tiers.
const timingTrigger = effectsPanel.locator('.detail .bb-select-trigger[aria-label="Timing"]');
await timingTrigger.click();
await page.locator(".bb-select-item", { hasText: "after Death" }).first().click();
const timingLabel = effectsPanel.locator('.detail .bb-select-trigger[aria-label="Timing"] .bb-select-label');
await timingLabel.filter({ hasText: "after Death" }).waitFor({ timeout: 3000 });
const timingClip = await timingLabel.evaluate((el) => ({
    text: el.textContent ?? "",
    clipped: el.scrollWidth > el.clientWidth + 1,
}));
check(
    "dropdown: longest Timing option fits the trigger without clipping",
    !timingClip.clipped,
    `label="${timingClip.text}" clipped=${timingClip.clipped}`,
);

await browser.close();

console.log("\n=== ITM layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL ITM ASSERTIONS PASS" : `\n${failed} ITM ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
