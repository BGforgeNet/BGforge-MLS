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
import { shotPath } from "./out-dir";
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

/** One field of the nth ability, by display name - the node id an edit needs, plus its current raw value. */
function abilityField(abilityIndex: number, name: string): { id: string; raw: number | string | undefined } {
    const abilities = dispatch({ type: "getChildren", sessionId, nodeId: abilitiesNodeId, start: 0, end: 10 });
    const ability = abilities.type === "children" ? abilities.rows[abilityIndex] : undefined;
    if (!ability) return { id: "", raw: undefined };
    const fields = dispatch({ type: "getChildren", sessionId, nodeId: ability.id, start: 0, end: 100 });
    const row = fields.type === "children" ? fields.rows.find((r) => r.name === name) : undefined;
    return { id: row?.id ?? "", raw: row?.rawValue };
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
await page.waitForSelector(".layout-root .panel h3", { timeout: 5000 });
// Default tab is General; capture it, then navigate to the tree tab below.
await page.screenshot({ path: shotPath("shot-itm.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page
        .locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]')
        .filter({ hasText: label })
        .first()
        .waitFor({ timeout: 5000 });
}
// Undo and refresh the webview exactly as the extension host does: the worker's undo returns a full changeSet
// and the host posts THAT (client/src/binary-editor/provider.ts refreshDocumentPanels), never the bare
// "invalidated" this used to send. Both bump the webview's version and so both re-fetch, which is why the
// weaker message passed every assertion here - it was a fidelity gap, not the cause of anything.
async function doUndo(): Promise<void> {
    const r = dispatch({ type: "undo", sessionId });
    const message: HostToWebview =
        r.type === "structure" ? { type: "changeSet", changeSet: r.result.changeSet } : { type: "invalidated" };
    await page.evaluate((rr) => window.postMessage(rr, "*"), message);
    // The invalidation triggers an async version-bump -> re-fetch round trip inside the webview with no single
    // DOM-observable completion signal generic across every call site (dispatch-level checks, tree re-renders,
    // and RowActions targets all key off it differently) - bounded settle, not a condition poll.
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

// Field tooltips: a rich IESDP `desc` surfaces as the field label's `title` (Field.svelte), while a desc that
// merely repeats the label is suppressed. This exercises the whole channel end to end - the generator writes
// the cleaned desc onto the ITM spec, derive-presentation drops the redundant ones, and projectRow reads the
// survivors from the presentation schema into Row.description, which the webview renders as the label title.
const tooltips = await page.evaluate(() => {
    const out: [string, string][] = [];
    for (const field of Array.from(document.querySelectorAll(".layout-root .field"))) {
        const label = field.querySelector(".label");
        if (label) out.push([(label.textContent ?? "").trim(), label.getAttribute("title") ?? ""]);
    }
    return out;
});
const norm = (s: string): string => s.replace(/\W+/g, "").toLowerCase();
check(
    "tooltip: a rich IESDP desc surfaces on the field label ('unused in BG1' from a min-stat field)",
    tooltips.some(([, title]) => title.includes("unused in BG1")),
    JSON.stringify(tooltips.filter(([, t]) => t !== "").map(([l, t]) => `${l}: ${t.slice(0, 40)}`)),
);
check(
    "tooltip: a label-redundant desc is suppressed (no field's title just repeats its own label)",
    tooltips.every(([text, title]) => title === "" || norm(title) !== norm(text)),
    JSON.stringify(tooltips.filter(([text, title]) => title !== "" && norm(title) === norm(text))),
);

// Doc link: a field whose full write-up was capped (e.g. Min Level) renders an external IESDP link next to its
// label (DocLink -> a plain external <a>, which VS Code opens in the browser). Assert the affordance renders
// with a real IESDP href; the actual browser-open is VS Code host behaviour, covered by the live drive.
const docLinks = await page.evaluate(() =>
    Array.from(
        document.querySelectorAll(".layout-root .doc-link"),
        (a) => (a as HTMLAnchorElement).getAttribute("href") ?? "",
    ),
);
check(
    "doc-link: a capped field renders an external IESDP link beside its label",
    docLinks.length > 0 && docLinks.every((h) => h.startsWith("https://gibberlings3.github.io/iesdp/")),
    JSON.stringify(docLinks),
);
// The doc-link marker's styling (micro raised muted "?") is guarded by measurement, not just the href above:
// assert the global .doc-link rule actually applies (it previously did not, as a component <style>).
const docLinkStyle = await page.evaluate(() => {
    const a = document.querySelector(".layout-root .doc-link");
    if (!a) return undefined;
    const cs = getComputedStyle(a);
    const label = a.closest(".label, .nm") as HTMLElement;
    const aBox = a.getBoundingClientRect();
    const labBox = label.getBoundingClientRect();
    return {
        smaller: Number.parseFloat(cs.fontSize) < Number.parseFloat(getComputedStyle(label).fontSize),
        raised: cs.verticalAlign === "super",
        notClipped: aBox.top >= labBox.top - 0.5 && aBox.bottom <= labBox.bottom + 0.5,
    };
});
check(
    "doc-link: the micro '?' marker's global styling applies (smaller + raised + not clipped)",
    docLinkStyle !== undefined && docLinkStyle.smaller && docLinkStyle.raised && docLinkStyle.notClipped,
    JSON.stringify(docLinkStyle),
);
// The "?" repeats the field's own tooltip (the capped description) and appends the "Click to see more" hint.
const docLinkTitle = await page.evaluate(() => {
    const a = document.querySelector(".layout-root .doc-link");
    const label = a?.closest(".label, .nm");
    return { tip: a?.getAttribute("title") ?? "", labelTip: label?.getAttribute("title") ?? "" };
});
check(
    "doc-link: the '?' tooltip repeats the field description and adds 'Click to see more'",
    docLinkTitle.labelTip.length > 0 &&
        docLinkTitle.tip.includes(docLinkTitle.labelTip) &&
        docLinkTitle.tip.includes("Click to see more"),
    JSON.stringify(docLinkTitle),
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
await page
    .waitForFunction(
        () => {
            const panel = Array.from(document.querySelectorAll(".panel")).find(
                (p) => p.querySelector("h3")?.textContent === "Unusable By",
            );
            const boxes = panel?.querySelectorAll('[role="checkbox"]') ?? [];
            return boxes.length > 0 && Array.from(boxes).every((b) => b.getAttribute("aria-checked") === "true");
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const afterSelect = await boxCounts();
check(
    "bulk: Select all checks every flag in the panel",
    afterSelect.total > 0 && afterSelect.checked === afterSelect.total,
    `${afterSelect.checked}/${afterSelect.total}`,
);
await unusablePanel.getByRole("button", { name: "Deselect all", exact: true }).click();
await page
    .waitForFunction(
        () => {
            const panel = Array.from(document.querySelectorAll(".panel")).find(
                (p) => p.querySelector("h3")?.textContent === "Unusable By",
            );
            const boxes = panel?.querySelectorAll('[role="checkbox"]') ?? [];
            return boxes.length > 0 && Array.from(boxes).every((b) => b.getAttribute("aria-checked") !== "true");
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
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
await page
    .waitForFunction(
        () => {
            const tab = document.querySelector('.bb-tabs.primary button[role="tab"][aria-selected="true"]');
            return !!tab && (tab.textContent ?? "").includes("2/3");
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);

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
await page
    .waitForFunction(
        () => {
            const labels = Array.from(document.querySelectorAll(".eff-tree-head-label"));
            const label = labels.find((l) => (l.textContent ?? "").includes("Ability 2"));
            const head = label?.closest(".eff-tree-head") as HTMLElement | null;
            return !!head && getComputedStyle(head).backgroundColor !== "rgba(0, 0, 0, 0)";
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
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

// The dual-purpose 0x1c/0x20 pair no longer folds into one "Level" cell. It renders as two standalone fields
// whose label defaults to the level reading (Maximum/Minimum Level) and is flipped to Dice Thrown/Dice Sides by
// the opcode overlay for dice opcodes. Assert no joined "Level" cell remains and both standalone fields show.
const levelDice = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".eff-tree .detail .layout-root .field")) as HTMLElement[];
    let joinedLevel = false;
    let thrown = "";
    let sides = "";
    let thrownStandalone = false;
    let sidesStandalone = false;
    for (const f of fields) {
        const label = (f.querySelector(".label")?.textContent ?? "").trim();
        const joined = !!f.querySelector(".field-control.joined");
        if (label === "Level" && joined) joinedLevel = true;
        if (label === "Maximum Level" || label === "Dice Thrown") {
            thrown = label;
            thrownStandalone = !joined;
        }
        if (label === "Minimum Level" || label === "Dice Sides") {
            sides = label;
            sidesStandalone = !joined;
        }
    }
    return { joinedLevel, ok: thrownStandalone && sidesStandalone, detail: `${thrown} / ${sides}` };
});
check(
    "tree: 0x1c/0x20 pair renders as two standalone fields (no 'Level' fold)",
    !levelDice.joinedLevel && levelDice.ok,
    `joinedLevel=${levelDice.joinedLevel} fields=${levelDice.detail}`,
);

// No-overlap guard at a NARROW pane: the effect feature block is a 2-column grid whose col-1 value holds the
// wide (tier-l) opcode combobox. In the tree's split detail pane - narrower than a full-page tab - the value
// track must shrink the control rather than let it keep its tier width and spill over the col-2 label. Measure
// at a deliberately narrow viewport (the 1280 default has enough slack to hide the bug) that no col-2 label
// whose row-band intersects the combobox has its left edge under the combobox.
await page.setViewportSize({ width: 1000, height: 900 });
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

// Stable-columns guard: the col-2 "Timing" control's left edge must coincide across all three effects
// (different opcodes relabel parameter1/parameter2, but the fixed label column keeps the values put).
const timingLefts: number[] = [];
for (let i = 0; i < 3; i++) {
    await page.locator(".eff-tree-effect").nth(i).click();
    await page
        .waitForFunction(
            (idx) => {
                const rows = Array.from(document.querySelectorAll(".eff-tree-effect"));
                return rows[idx]?.classList.contains("eff-tree-selected") ?? false;
            },
            i,
            { timeout: 5000 },
        )
        .catch(() => undefined);
    const left = await page
        .locator('.eff-tree .detail .bb-combobox-input[aria-label="Timing"]')
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
    "tree: ability detail renders the shared panels (Ability/Damage/Animation/Charges/Flags)",
    ["ABILITY", "DAMAGE", "ANIMATION", "CHARGES", "FLAGS"].every((p) => abilityPanels.includes(p)),
    JSON.stringify(abilityPanels),
);
const abilityText = await page.locator(".eff-tree .detail .layout-root").first().innerText();
check(
    "tree: Melee group renders all three distinct slots",
    ["Overhand", "Backhand", "Thrust"].every((s) => abilityText.includes(s)),
    "",
);
check(
    "tree: ability detail applies label overrides (ammo reads 'Arrow' not 'Is Arrow')",
    abilityText.includes("Arrow") && !abilityText.includes("Is Arrow"),
    abilityText.includes("Is Arrow") ? "labels-not-applied" : "ok",
);

// Damage dice fold: thrown/sides/bonus collapse into one "Dice" cell shown D&D-style as X d Y + Z (three
// editable inputs with per-gap separators), matching how effects fold dice - not three separate fields.
const diceFold = await page.evaluate(() => {
    const cell = (Array.from(document.querySelectorAll(".eff-tree .detail .field")) as HTMLElement[]).find(
        (f) => (f.querySelector(".label")?.textContent ?? "").trim() === "Dice",
    );
    if (!cell) return { ok: false, detail: "no Dice cell" };
    const inputs = cell.querySelectorAll(".joined-input input").length;
    const seps = Array.from(cell.querySelectorAll(".joined-sep"), (s) => s.textContent?.trim());
    return { ok: inputs === 3 && seps.join(",") === "d,+", detail: `inputs=${inputs} seps=${seps.join("")}` };
});
check("tree: ITM damage dice fold into one X d Y + Z cell", diceFold.ok, diceFold.detail);

// Dropdown widths are decoupled from the text-input tiers and sized to each dropdown's OWN longest option
// (controls.ts dropdownWidth -> dd-{1..5}). The Ammo "Arrow" Yes/No dropdown carries only "0 No"/"1 Yes", so it
// lands on the tightest dd-1 box; a wordy dropdown like Damage Type takes a far wider box. Assert the class and
// that the tiny dropdown is materially narrower than the wide one (it used to inherit the same M/L tier width).
const ddWidths = await page.evaluate(() => {
    const out: Record<string, { cls: string; w: number } | null> = {};
    const inputs = Array.from(document.querySelectorAll(".eff-tree .detail .bb-combobox-input")) as HTMLElement[];
    for (const label of ["Arrow", "Damage Type", "Attack Type"]) {
        const input = inputs.find((el) => el.getAttribute("aria-label") === label);
        const box = input?.closest(".bb-combobox") as HTMLElement | null;
        if (!input || !box) {
            out[label] = null;
            continue;
        }
        const fc = input.closest(".field-control");
        const cls = fc ? (Array.from(fc.classList).find((c) => c.startsWith("dd-")) ?? "?") : "?";
        out[label] = { cls, w: Math.round(box.getBoundingClientRect().width) };
    }
    return { arrow: out["Arrow"], damage: out["Damage Type"], attack: out["Attack Type"] };
});
check(
    "tree: tiny Yes/No dropdown lands on dd-1 and is narrower than a wordy one (widths decoupled from text tiers)",
    ddWidths.arrow?.cls === "dd-1" &&
        !!ddWidths.damage &&
        !!ddWidths.attack &&
        ddWidths.arrow!.w < ddWidths.attack!.w &&
        ddWidths.attack!.w < ddWidths.damage!.w,
    JSON.stringify(ddWidths),
);
await page.screenshot({ path: shotPath("shot-itm-tree.png"), fullPage: true });

// ============================================================
// A dropdown reflects a value changed from OUTSIDE it (undo/redo, a cascade) - REGRESSION
// ============================================================
// Both halves need the input FOCUSED, which is where it is left after a pick - i.e. exactly the state a user is
// in when they undo the edit they just made. Driven through the real keyboard and the real host reply, because
// neither half exists at the data layer: the changeSet always carried the right value, and only the control
// disagreed with it.
{
    const dmg = page.locator('.eff-tree .detail .bb-combobox-input[aria-label="Damage Type"]').first();
    const before = await dmg.inputValue();
    await dmg.click();
    await page.locator(".bb-combobox-item").first().waitFor({ timeout: 5000 });
    const pick = (await page.locator(".bb-combobox-item").allInnerTexts()).find((t) => t.trim() !== before)!;
    await page.locator(".bb-combobox-item", { hasText: pick.trim() }).first().click();
    await page.waitForFunction(
        (b) => {
            const el = document.querySelector('.eff-tree .detail .bb-combobox-input[aria-label="Damage Type"]');
            return el instanceof HTMLInputElement && el.value !== b;
        },
        before,
        { timeout: 5000 },
    );

    // An editor shortcut typed into the focused input must not open the list. bits-ui opens for any keydown
    // outside its own interaction set, and that set holds only the bare modifier - so the `z` of Ctrl+Z arrives
    // as a character. A dropdown popping open over the form on every undo is the visible half of that.
    await page.keyboard.press("Control+z");
    check(
        "undo: an editor shortcut in a focused dropdown does not open the list",
        (await dmg.getAttribute("aria-expanded")) === "false",
        `aria-expanded=${await dmg.getAttribute("aria-expanded")}`,
    );

    // With the list OPEN and untyped, the control is still idle, so an externally-changed value must reach it.
    // Gating the display sync on "closed" instead of "not searching" left the pre-undo label on screen until
    // the list was dismissed.
    await dmg.click();
    await page.locator(".bb-combobox-item").first().waitFor({ timeout: 5000 });
    await doUndo();
    check(
        "undo: an open, untyped dropdown shows the restored value",
        (await dmg.inputValue()) === before,
        `shown=${await dmg.inputValue()} expected=${before}`,
    );

    // The other side of that gate: once the user IS searching, an external change must not overwrite the query.
    await dmg.click();
    await page.keyboard.type("cru");
    // Whatever the click left in the box plus what was typed - the invariant is that the external change does
    // not REPLACE it, not that the query equals the keystrokes (a click into an already-focused input places
    // the caret rather than selecting, so the two differ).
    const query = await dmg.inputValue();
    const dmgField = abilityField(0, "Damage Type");
    const other = dmgField.raw === 2 ? 3 : 2;
    const edited = dispatch({ type: "editField", sessionId, nodeId: dmgField.id, value: other });
    if (edited.type === "edited") {
        await page.evaluate((rr) => window.postMessage(rr, "*"), {
            type: "changeSet",
            changeSet: edited.result.changeSet,
        } as HostToWebview);
    }
    check(
        "undo: a search in progress survives an external change",
        (await dmg.inputValue()) === query && query.includes("cru"),
        `shown=${await dmg.inputValue()} query=${query}`,
    );
    await page.keyboard.press("Escape");
    await doUndo(); // drop that edit so the structure-op section below starts from the same baseline
}

// ============================================================
// Structure ops via the tree (full parity with the dropped Abilities/Effects tabs)
// ============================================================
// + ability (section-level add)
await page.locator(".eff-tree-toolbar .eff-tree-toolbtn").click();
await page
    .waitForFunction(
        () =>
            Array.from(document.querySelectorAll(".eff-tree-head-label")).filter((l) =>
                (l.textContent ?? "").startsWith("Ability"),
            ).length === 3,
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
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
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 4, undefined, { timeout: 5000 })
    .catch(() => undefined);
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
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 2, undefined, { timeout: 5000 })
    .catch(() => undefined);
check(
    "ops: delete effect via RowActions removes it",
    sectionKids(effectsNodeId).total === 2,
    `${sectionKids(effectsNodeId).total}`,
);
await doUndo();

await page.locator(".eff-tree-head-label", { hasText: "Ability 1" }).first().click();
await page.locator(".eff-tree .detail .row-actions").first().waitFor({ timeout: 3000 });
await page.locator('.eff-tree .detail .row-actions button[aria-label="Add below"]').click();
await page
    .waitForFunction(
        () =>
            Array.from(document.querySelectorAll(".eff-tree-head-label")).filter((l) =>
                (l.textContent ?? "").startsWith("Ability"),
            ).length === 3,
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
check(
    "ops: ability RowActions Add below inserts an ability",
    sectionKids(abilitiesNodeId).total === 3,
    `${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// Add global (equipping) effect: the Global group's + appends to the equipping range (section-level add).
await page.locator('.eff-tree-add[aria-label="Add global effect"]').click();
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 4, undefined, { timeout: 5000 })
    .catch(() => undefined);
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
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect-label").length === 1, undefined, {
        timeout: 5000,
    })
    .catch(() => undefined);
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
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 3, undefined, { timeout: 5000 })
    .catch(() => undefined);
check(
    "filter: clearing restores all three effects",
    (await page.locator(".eff-tree-effect").count()) === 3,
    `${await page.locator(".eff-tree-effect").count()}`,
);

// Collapse all / expand all: collapsing hides every nested effect row (headers remain); expanding restores them.
await page.locator('.eff-tree-iconbtn[aria-label="Collapse all"]').click();
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
check(
    "tree: collapse all hides every effect row",
    (await page.locator(".eff-tree-effect").count()) === 0,
    `${await page.locator(".eff-tree-effect").count()}`,
);
await page.locator('.eff-tree-iconbtn[aria-label="Expand all"]').click();
await page
    .waitForFunction(() => document.querySelectorAll(".eff-tree-effect").length === 3, undefined, { timeout: 5000 })
    .catch(() => undefined);
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
        await page
            .waitForFunction(
                () => {
                    const spacer = document.querySelector(".eff-tree-spacer") as HTMLElement | null;
                    return !!spacer && spacer.getBoundingClientRect().height > 3000;
                },
                undefined,
                { timeout: 5000 },
            )
            .catch(() => undefined);
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
