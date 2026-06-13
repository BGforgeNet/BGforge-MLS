/**
 * ITM single-page layout harness pass.
 *
 * ITM renders a General tab plus a single "Abilities & Effects" TREE tab (the flat Abilities / Effects
 * master-detail tabs were replaced by the tree: effects nested under their owning ability, equipping effects
 * under "Global"). This driver opens a synthetic ITM (2 abilities, 3 effects) in the REAL webview bundle and:
 *   - asserts the General tab layout resolves (variant "item", panels, regrouped usability flags, spacing,
 *     column-major fill);
 *   - asserts the tree tab renders Global + per-ability groups with nested effects, and that selecting an
 *     effect / ability renders the SHARED detail fragment (opcode searchable combobox, folded Level cell,
 *     value columns stable across opcodes; the ability panels);
 *   - keeps the wm_sbook.itm remove-first-effect regression (dispatch-level, DOM-independent).
 *
 * Structure ops (add/remove/reorder) left the UI with the old tabs; they remain covered by the entity-ops
 * unit tests and are re-exercised end-to-end here only via the wm_sbook regression.
 *
 * Synthetic fixture: equipping effects 0; ability0 -> 1 effect (opcode 10); ability1 -> 2 effects
 * (opcode 20, 21); 3 effects total.
 */

import { chromium, type Page } from "playwright";
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

/** Resolve a depth-0 group's node id by name (the layout no longer exposes Abilities/Effects as `sections`,
 *  since the tree joins them internally - so the dispatch-level checks find the groups via the root window). */
function groupNodeId(name: string): string {
    const r = dispatch({ type: "getChildren", sessionId, nodeId: null, start: 0, end: 50 });
    return r.type === "children" ? (r.rows.find((row) => row.name === name)?.id ?? "") : "";
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///synthetic.itm", bytes: itmBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            abilitiesNodeId = groupNodeId("Abilities");
            effectsNodeId = groupNodeId("Effects");
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
    if (m.type === "requestEffectTree") {
        const r = dispatch({ type: "getEffectTree", sessionId });
        return r.type === "effectTree" ? [{ type: "effectTree", requestId: m.requestId, view: r.view }] : [];
    }
    if (m.type === "editField") {
        const r = dispatch({ type: "editField", sessionId, nodeId: m.nodeId, value: m.value });
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
    }
    if (m.type === "structureOp") {
        const r = dispatch({ type: "structureOp", sessionId, op: m.op });
        return r.type === "structure"
            ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }]
            : [];
    }
    return [];
}

function sectionKids(nodeId: string): { total: number; names: string[] } {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
    return r.type === "children" ? { total: r.total, names: r.rows.map((row) => row.name) } : { total: 0, names: [] };
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "ITM");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
// Default tab is General; capture it, then navigate to the tree tab below.
await page.screenshot({ path: path.join(here, "shot-itm.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}
// Undo a structure op and refresh the webview (the host pushes the op onto the undo stack; "invalidated"
// makes the tree re-fetch), so each op test runs from the same baseline.
async function doUndo(): Promise<void> {
    dispatch({ type: "undo", sessionId });
    await page.evaluate((rr) => window.postMessage(rr, "*"), { type: "invalidated" } as HostToWebview);
    await page.waitForTimeout(200);
}

// ============================================================
// Layout assertions (General tab - the default)
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///caps.itm", bytes: itmBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'item'", L?.variantId === "item", `variantId=${L?.variantId}`);
        const tabIds = (L?.tabs ?? []).map((t) => t.id);
        check(
            "layout: tabs are General + Abilities & Effects tree (flat Abilities/Effects tabs dropped)",
            JSON.stringify(tabIds) === JSON.stringify(["general", "tree"]),
            JSON.stringify(tabIds),
        );
    }
}
const dom = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent);
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
    let minGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minGap) minGap = gap;
    }
    // Column-major fill guard on the Main panel's first two fields (col 1 fills top-down before col 2).
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
    let mainColGap = -1;
    let mainBlockGap = -1;
    const kv = mainPanel?.querySelector(".kv.kv-multi");
    const flagsBox = mainPanel?.querySelector(".flag-group");
    if (kv && flagsBox && mainFields.length >= 7) {
        mainColGap = mainFields[6]!.getBoundingClientRect().left - mainFields[0]!.getBoundingClientRect().right;
        mainBlockGap = flagsBox.getBoundingClientRect().left - kv.getBoundingClientRect().right;
    }
    return { panels, usabilityGroups, kitGroups, minGap, mainColMajor, mainColGap, mainBlockGap };
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
check("layout: label/value gap is positive (no overlap)", dom.minGap >= 4, `minGap=${dom.minGap}px`);
check("layout: multi-column fields fill top-down first (column-major)", dom.mainColMajor, `${dom.mainColMajor}`);
check(
    "layout: inter-block gap equals inter-column gap (uniform spacing)",
    dom.mainColGap > 0 && Math.abs(dom.mainColGap - dom.mainBlockGap) <= 2,
    `colGap=${dom.mainColGap}px blockGap=${dom.mainBlockGap}px`,
);

// Bulk select/deselect on the "Unusable By" panel drives the real edit pipeline across the byte fields.
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
check("bulk: Deselect all clears every flag in the panel", (await boxCounts()).checked === 0, "");

// ============================================================
// Baseline (dispatch-level)
// ============================================================
check("baseline: 2 abilities", sectionKids(abilitiesNodeId).total === 2, `total=${sectionKids(abilitiesNodeId).total}`);
check("baseline: 3 effects", sectionKids(effectsNodeId).total === 3, `total=${sectionKids(effectsNodeId).total}`);

// ============================================================
// Abilities & Effects tree tab
// ============================================================
await clickTab("Abilities & Effects");
await page.waitForSelector(".eff-tree .eff-tree-vrow", { timeout: 5000 });
await page.waitForTimeout(200);

const treeTabText = (
    (await page.locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]').textContent()) ?? ""
).trim();
check("tab: tree tab shows combined abilities/effects count (2/3)", treeTabText.includes("2/3"), treeTabText);

// The tree is a flat virtualized row list (header rows + effect rows in document order), not nested group
// elements - reconstruct groups by walking the rows: a header starts a group; following effect rows belong
// to it until the next header. (At these small counts every row is within the render window.)
const treeShape = await page.evaluate(() => {
    const groups: { head: string; level: string; count: string; effects: string[] }[] = [];
    let cur: (typeof groups)[number] | undefined;
    for (const r of Array.from(document.querySelectorAll(".eff-tree-vrow"))) {
        const head = r.querySelector(".eff-tree-head");
        const effLabel = r.querySelector(".eff-tree-effect-label");
        if (head) {
            cur = {
                head: (head.querySelector(".eff-tree-head-label")?.textContent ?? "").trim(),
                level: (head.querySelector(".eff-tree-level")?.textContent ?? "").trim(),
                count: (head.querySelector(".eff-tree-count")?.textContent ?? "").trim(),
                effects: [],
            };
            groups.push(cur);
        } else if (effLabel && cur) {
            cur.effects.push((effLabel.textContent ?? "").trim());
        }
    }
    return { groups, effectRows: document.querySelectorAll(".eff-tree-effect").length };
});
check(
    "tree: Global + per-ability groups render with nested effects",
    treeShape.groups.length >= 3 &&
        (treeShape.groups[0]?.head ?? "").startsWith("Global") &&
        treeShape.groups.filter((g) => g.head.startsWith("Ability")).length === 2,
    JSON.stringify(treeShape.groups),
);
check(
    "tree: effects nest under their owning ability (1 under Ability 1, 2 under Ability 2)",
    treeShape.effectRows === 3 &&
        treeShape.groups.find((g) => g.head === "Ability 1")?.effects.length === 1 &&
        treeShape.groups.find((g) => g.head === "Ability 2")?.effects.length === 2,
    JSON.stringify(treeShape.groups.map((g) => ({ h: g.head, n: g.effects.length }))),
);
// ITM abilities carry no level field, so no level badge is shown (SPL shows "Level Required").
check(
    "tree: ITM ability rows show no level badge",
    treeShape.groups.every((g) => g.level === ""),
    JSON.stringify(treeShape.groups.map((g) => g.level)),
);

// Hover an UNSELECTED ability header (Ability 2; Ability 1 is the default selection): the row gets the hover
// background, but the label <button> must NOT get its own (global button:hover) highlight - it stays
// transparent so the row's hover shows through uniformly.
const ab2Head = page
    .locator(".eff-tree-head")
    .filter({ has: page.locator(".eff-tree-head-label", { hasText: "Ability 2" }) });
await ab2Head.locator(".eff-tree-head-label").hover();
await page.waitForTimeout(120);
const hoverColors = await ab2Head.evaluate((head) => ({
    row: getComputedStyle(head).backgroundColor,
    label: getComputedStyle(head.querySelector(".eff-tree-head-label")!).backgroundColor,
}));
check(
    "hover: row provides the hover bg and the label button stays transparent",
    hoverColors.label === "rgba(0, 0, 0, 0)" && hoverColors.row !== "rgba(0, 0, 0, 0)",
    JSON.stringify(hoverColors),
);

// Selecting an effect renders the shared feature-block fragment (opcode combobox, folded Level cell).
await page.locator(".eff-tree-effect").first().click();
await page.locator(".eff-tree .detail .layout-root .field").first().waitFor({ timeout: 3000 });
const effDetail = await page.evaluate(() => ({
    fields: document.querySelectorAll(".eff-tree .detail .layout-root .field").length,
    combobox: document.querySelectorAll(".eff-tree .detail .bb-combobox-input").length,
    panelTitles: document.querySelectorAll(".eff-tree .detail .layout-root .panel > h3").length,
}));
check(
    "tree: effect detail renders the shared feature-block fragment (wire order, no semantic panel titles)",
    effDetail.fields > 10 && effDetail.panelTitles === 0,
    `fields=${effDetail.fields} panelTitles=${effDetail.panelTitles}`,
);
check("tree: opcode detail field is a searchable combobox", effDetail.combobox >= 1, `count=${effDetail.combobox}`);

// Per-column label tracks: a static column (Opcode/Target/Power) hugs its short label rather than inheriting a
// wide fixed track sized for a label that only appears in another column. The reserved label width is scoped to
// the column holding the rewritten parameter1/parameter2 fields, so a static label like "Opcode" sits close to
// its value (a small gap), not stranded ~17ch away as it was under the old blanket fixed label column.
const opcodeGap = await page.evaluate(() => {
    const field = (
        Array.from(document.querySelectorAll(".eff-tree .detail .kv.kv-multi .field")) as HTMLElement[]
    ).find((f) => (f.querySelector(".label")?.textContent ?? "").trim() === "Opcode");
    if (!field) return -1;
    const label = field.querySelector(".label") as HTMLElement;
    const ctrl = field.querySelector(".field-control") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(label);
    return Math.round(ctrl.getBoundingClientRect().left - range.getBoundingClientRect().right);
});
check(
    "tree: a static label (Opcode) hugs its value - not padded for another column's wide label",
    opcodeGap >= 0 && opcodeGap < 60,
    `opcode label->value gap=${opcodeGap}px`,
);

// Label overrides must reach the detail (the tree passes the layout `labels` map through, as the old tabs did):
// the feature block's stackingIdEx renders as "Stacking ID (ToBEx)", not the bare humanized "Stacking Id Ex".
const effText = (await page.locator(".eff-tree .detail .layout-root").first().innerText()).replace(/\s+/g, " ");
check(
    "tree: effect detail applies label overrides (Stacking ID (ToBEx))",
    effText.includes("Stacking ID (ToBEx)") && !effText.includes("Stacking Id Ex"),
    effText.includes("Stacking ID (ToBEx)") ? "ok" : effText,
);

const levelCell = page
    .locator(".eff-tree .detail .layout-root .field")
    .filter({ has: page.locator(".label", { hasText: /^Level$/ }) })
    .first();
check(
    "tree: level range folds into one 'Level' cell with two boxes",
    (await levelCell.locator(".field-control.joined input").count()) === 2,
    "",
);

// No-overlap guard at a NARROW pane: the effect feature block is a 2-column grid whose col-1 value holds the
// wide (tier-l) opcode combobox. In the tree's split detail pane - narrower than a full-page tab - the value
// track must shrink the control rather than let it keep its tier width and spill over the col-2 label. Measure
// at a deliberately narrow viewport (the 1280 default has enough slack to hide the bug) that no col-2 label
// whose row-band intersects the combobox has its left edge under the combobox.
await page.setViewportSize({ width: 1000, height: 900 });
await page.waitForTimeout(120);
const narrowOverlap = await page.evaluate(() => {
    const combo = document.querySelector(".eff-tree .detail .bb-combobox-input") as HTMLElement | null;
    if (!combo) return { ok: false, detail: "no combobox" };
    const cr = combo.getBoundingClientRect();
    const mid = (cr.top + cr.bottom) / 2;
    const hits = (
        Array.from(document.querySelectorAll(".eff-tree .detail .kv.kv-multi .field .label")) as HTMLElement[]
    )
        .map((l) => ({ text: l.textContent ?? "", r: l.getBoundingClientRect() }))
        .filter(({ r }) => r.top <= mid && r.bottom >= mid && r.left > cr.left + 5 && r.left < cr.right);
    return { ok: hits.length === 0, detail: hits.map((h) => h.text).join(",") || "none" };
});
check(
    "tree: opcode combobox never overlaps a col-2 label in a narrow detail pane",
    narrowOverlap.ok,
    narrowOverlap.detail,
);
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(120);

// Stable-columns guard: the col-2 "Timing" control's left edge must coincide across all three effects
// (different opcodes relabel parameter1/parameter2, but the fixed label column keeps the values put).
const timingLefts: number[] = [];
for (let i = 0; i < 3; i++) {
    await page.locator(".eff-tree-effect").nth(i).click();
    await page.waitForTimeout(80);
    const left = await page
        .locator('.eff-tree .detail .bb-select-trigger[aria-label="Timing"]')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().left));
    timingLefts.push(left);
}
check(
    "tree: value columns stay put when opcode/parameter labels change (fixed label column)",
    timingLefts.every((l) => Math.abs(l - timingLefts[0]!) <= 1),
    `timingLefts=${JSON.stringify(timingLefts)}`,
);

// Selecting an ability header renders the shared ITM ability panels in the same detail pane.
await page.locator(".eff-tree-head-label", { hasText: "Ability 1" }).first().click();
await page.locator(".eff-tree .detail .layout-root .field").first().waitFor({ timeout: 3000 });
const abilityPanels = (await page.locator(".eff-tree .detail .layout-root .panel h3").allInnerTexts()).map((t) =>
    t.toUpperCase(),
);
check(
    "tree: ability detail renders the shared panels (Ability/Damage/Projectile/Charges/Flags)",
    ["ABILITY", "DAMAGE", "PROJECTILE", "CHARGES", "FLAGS"].every((p) => abilityPanels.includes(p)),
    JSON.stringify(abilityPanels),
);
const abilityText = await page.locator(".eff-tree .detail .layout-root").first().innerText();
check(
    "tree: Melee Animation renders all three distinct slots",
    ["Overhand", "Backhand", "Thrust"].every((s) => abilityText.includes(s)),
    "",
);
check(
    "tree: ability detail applies label overrides (ammo reads 'Arrow' not 'Is Arrow')",
    abilityText.includes("Arrow") && !abilityText.includes("Is Arrow"),
    abilityText.includes("Is Arrow") ? "labels-not-applied" : "ok",
);
await page.screenshot({ path: path.join(here, "shot-itm-tree.png"), fullPage: true });

// ============================================================
// Structure ops via the tree (full parity with the dropped Abilities/Effects tabs)
// ============================================================
// + ability (section-level add)
await page.locator(".eff-tree-toolbar .eff-tree-toolbtn").click();
await page.waitForTimeout(200);
check(
    "ops: + ability adds an ability",
    sectionKids(abilitiesNodeId).total === 3,
    `${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();
check(
    "ops: undo restores 2 abilities",
    sectionKids(abilitiesNodeId).total === 2,
    `${sectionKids(abilitiesNodeId).total}`,
);

// Owner-scoped + effect on Ability 1 (addChild)
const ability1Head = page
    .locator(".eff-tree-head")
    .filter({ has: page.locator(".eff-tree-head-label", { hasText: "Ability 1" }) });
await ability1Head.locator(".eff-tree-add").click();
await page.waitForTimeout(200);
check(
    "ops: + effect on Ability 1 adds an effect",
    sectionKids(effectsNodeId).total === 4,
    `${sectionKids(effectsNodeId).total}`,
);
await doUndo();
check("ops: undo restores 3 effects", sectionKids(effectsNodeId).total === 3, `${sectionKids(effectsNodeId).total}`);

// Per-entry RowActions in the detail pane: delete an effect, then add an ability below the selected one.
await page.locator(".eff-tree-effect").first().click();
await page.locator(".eff-tree .detail .row-actions").first().waitFor({ timeout: 3000 });
await page.locator('.eff-tree .detail .row-actions button[aria-label="Delete"]').click();
await page.waitForTimeout(200);
check(
    "ops: delete effect via RowActions removes it",
    sectionKids(effectsNodeId).total === 2,
    `${sectionKids(effectsNodeId).total}`,
);
await doUndo();

await page.locator(".eff-tree-head-label", { hasText: "Ability 1" }).first().click();
await page.locator(".eff-tree .detail .row-actions").first().waitFor({ timeout: 3000 });
await page.locator('.eff-tree .detail .row-actions button[aria-label="Add below"]').click();
await page.waitForTimeout(200);
check(
    "ops: ability RowActions Add below inserts an ability",
    sectionKids(abilitiesNodeId).total === 3,
    `${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// Add global (equipping) effect: the Global group's + appends to the equipping range (section-level add).
await page.locator('.eff-tree-add[aria-label="Add global effect"]').click();
await page.waitForTimeout(200);
check(
    "ops: + global effect grows the effect count",
    sectionKids(effectsNodeId).total === 4,
    `${sectionKids(effectsNodeId).total}`,
);
await doUndo();
check("ops: undo restores 3 effects", sectionKids(effectsNodeId).total === 3, `${sectionKids(effectsNodeId).total}`);

// ============================================================
// Filter: typing narrows the tree to matching effects (+ their owning headers), forcing groups expanded.
// ============================================================
await page.locator(".eff-tree-toolbar input.list-filter-input").fill("op 21");
await page.waitForTimeout(200);
const filtered = await page.evaluate(() => ({
    effects: Array.from(document.querySelectorAll(".eff-tree-effect-label")).map((e) => (e.textContent ?? "").trim()),
    heads: Array.from(document.querySelectorAll(".eff-tree-head-label")).map((e) => (e.textContent ?? "").trim()),
}));
check(
    "filter: only the matching effect (op 21, under Ability 2) and its header remain",
    filtered.effects.length === 1 &&
        (filtered.effects[0] ?? "").includes("op 21") &&
        filtered.heads.length === 1 &&
        filtered.heads[0] === "Ability 2",
    JSON.stringify(filtered),
);
await page.locator(".eff-tree-toolbar .list-filter-clear").click();
await page.waitForTimeout(150);
check(
    "filter: clearing restores all three effects",
    (await page.locator(".eff-tree-effect").count()) === 3,
    `${await page.locator(".eff-tree-effect").count()}`,
);

// Collapse all / expand all: collapsing hides every nested effect row (headers remain); expanding restores them.
await page.locator('.eff-tree-iconbtn[aria-label="Collapse all"]').click();
await page.waitForTimeout(150);
check(
    "tree: collapse all hides every effect row",
    (await page.locator(".eff-tree-effect").count()) === 0,
    `${await page.locator(".eff-tree-effect").count()}`,
);
await page.locator('.eff-tree-iconbtn[aria-label="Expand all"]').click();
await page.waitForTimeout(150);
check(
    "tree: expand all restores every effect row",
    (await page.locator(".eff-tree-effect").count()) === 3,
    `${await page.locator(".eff-tree-effect").count()}`,
);

// ============================================================
// Virtualization: a large effect set mounts only a windowed subset of rows (not all 150).
// ============================================================
{
    const bigDoc = {
        ...baseDoc,
        header: { ...baseDoc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
        abilities: [{ ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 150 }],
        effects: Array.from({ length: 150 }, (_, i) => mkEffect(i % 60)),
    };
    const r = dispatch({ type: "open", uri: "file:///big.itm", bytes: serializeItmCanonicalDocument(bigDoc) });
    if (r.type !== "opened") {
        check("virtualization: big doc open", false, `type=${r.type}`);
    } else {
        sessionId = r.result.sessionId;
        await page.evaluate((rr) => window.postMessage(rr, "*"), { type: "init", open: r.result } as HostToWebview);
        await page.waitForTimeout(300);
        const mounted = await page.locator(".eff-tree-vrow").count();
        const spacerH = await page
            .locator(".eff-tree-spacer")
            .first()
            .evaluate((el) => Math.round(el.getBoundingClientRect().height));
        // ~152 visual rows (2 headers + 150 effects); only ~viewport+overscan are mounted.
        check(
            "virtualization: only a windowed subset of rows is mounted",
            mounted > 0 && mounted < 60,
            `mounted=${mounted}`,
        );
        check("virtualization: spacer sizes to the full row count", spacerH > 3000, `spacerH=${spacerH}`);
    }
}

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
        const wmEffects = dispatch({ type: "getChildren", sessionId: wmSession, nodeId: null, start: 0, end: 50 });
        const wmEffectsNodeId =
            wmEffects.type === "children" ? (wmEffects.rows.find((r) => r.name === "Effects")?.id ?? "") : "";
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

await browser.close();

console.log("\n=== ITM layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL ITM ASSERTIONS PASS" : `\n${failed} ITM ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
