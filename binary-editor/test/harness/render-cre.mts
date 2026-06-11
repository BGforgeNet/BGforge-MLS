/**
 * CRE tabbed layout harness pass.
 *
 * CRE renders through the declarative layout as a tabbed editor (General / Combat / Inventory / Proficiencies /
 * Sounds / Spells / Effects). The header scalars are grouped into single-column titled boxes packed side by
 * side: the General tab carries Main / Identity / Scripting on its first row and Attributes / Thief Skills /
 * Extra Stats / Colors on its second, plus the creature-flag grid and a short trailing table; the Combat tab
 * carries Main (attack stats) / AC / Saving Throws / Resistances and the status-flag grid. The 40 equipped-item
 * slots render as a grid (Inventory), the 20 proficiency bytes as a matrix (Proficiencies), the 100 sound
 * strrefs as a grid (Sounds). The three spell tables (Known Spells, Spell Memorization Info, Memorized Spells)
 * render together through the unified `spellbook` block (spell-type subtabs over per-level cards) under the
 * Spells tab; Effects and Items render as master-detail `list` blocks under Effects / Inventory. This driver
 * opens a real BG2 mage CRE in the REAL webview bundle and:
 *   - asserts the layout resolves (variant "creature", sections map with correct caps, the top-level tab strip,
 *     the opcode renders as a searchable combobox in the effect detail, label/value spacing is non-zero in both
 *     the field boxes and the item-slots grid);
 *   - drives structure ops through the actual message path (webview posts -> hostUp -> dispatch -> changeSet):
 *     a spellbook "+ memorize" (and undo) on the Spells tab, and Effects insert/duplicate/remove/undo;
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
    if (m.type === "requestSpellbook") {
        const r = dispatch({ type: "getSpellbook", sessionId });
        return r.type === "spellbook" ? [{ type: "spellbook", requestId: m.requestId, view: r.view }] : [];
    }
    if (m.type === "spellbookEdit") {
        const r = dispatch({ type: "spellbookEdit", sessionId, op: m.op });
        return r.type === "structure"
            ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }]
            : [];
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
    // Mirror the real provider: undo returns a changeSet, posted so the webview refreshes fields/tab counts too.
    const r = dispatch({ type: "undo", sessionId });
    if (r.type === "structure") postToWebview({ type: "changeSet", changeSet: r.result.changeSet });
    else postToWebview({ type: "invalidated" });
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
// CRE is tabbed; capture the default (General) tab immediately so the screenshot exists regardless of
// the later structure-op steps (which navigate into the Spells / Effects tabs).
await page.screenshot({ path: path.join(here, "shot-cre.png"), fullPage: true });

// ---- Dropdown tier guard (UI-GUIDELINES: dropdowns size to their longest option, quantized to the S/M/ML/L
// width tiers - mid-length IE IDS dropdowns land on ML, not the wide L, so the column is not over-wide; yet the
// longest option must still fit). The Identity box's Alignment is a stable ML case: its longest of the nine fixed
// alignments is "0x32 Chaotic neutral" = 20ch. Assert it renders on the ML tier (24ch, the fixed middle width -
// NOT the 34ch L box), then drive it to that longest option and assert the trigger label is not ellipsis-clipped
// (scrollWidth <= clientWidth). ----
{
    const alignFc = page.locator('.field-control:has(.bb-select-trigger[aria-label="Alignment"])').first();
    const alignTier = await alignFc.evaluate((el) => el.className.replace("field-control", "").trim());
    check("dropdown: mid-length Alignment lands on the ML tier (not the wide L)", alignTier === "tier-ml", alignTier);
    const alignTrigger = page.locator('.bb-select-trigger[aria-label="Alignment"]');
    await alignTrigger.click();
    await page.waitForTimeout(150);
    await page.locator(".bb-popup-item", { hasText: "Chaotic neutral" }).first().click();
    await page.waitForTimeout(150);
    const alignClip = await page
        .locator('.bb-select-trigger[aria-label="Alignment"] .bb-select-label')
        .evaluate((el) => ({ text: el.textContent ?? "", clipped: el.scrollWidth > el.clientWidth + 1 }));
    check(
        "dropdown: longest Alignment option fits the ML trigger without clipping",
        !alignClip.clipped,
        JSON.stringify(alignClip),
    );
}

async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}

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
    // Delete fires immediately (no confirm step) - a single click on the Delete button removes the entry.
    await clickAction(scope, "Delete");
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
            "layout: Effects canAdd+canModify",
            L?.sections["Effects"]?.canAdd === true && L?.sections["Effects"]?.canModify === true,
            JSON.stringify(L?.sections["Effects"]),
        );
        // The three spell tables render through the spellbook block, not list blocks, so they are absent from
        // the resolved sections map (their structure ops are driven by the spellbook, not a list toolbar).
        check(
            "layout: spell tables are not list sections (handled by the spellbook)",
            L?.sections["Known Spells"] === undefined &&
                L?.sections["Spell Memorization Info"] === undefined &&
                L?.sections["Memorized Spells"] === undefined,
            JSON.stringify(Object.keys(L?.sections ?? {})),
        );
    }
}
// CRE is tabbed: assert the top-level tab strip (count badges stripped), then visit the tabs that carry the
// grids/fields to verify they render and align. (The spellbook lives under Spells; the Effects/Items list
// sections under Effects/Inventory - both exercised below.)
const topTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'), (e) =>
        (e.textContent ?? "").replace(/\s*\(\d+(?:\/\d+)?\)\s*$/, "").trim(),
    ),
);
check(
    "layout: top-level tabs render in order",
    JSON.stringify(topTabs) ===
        JSON.stringify(["General", "Combat", "Inventory", "Proficiencies", "Sounds", "Spells", "Effects"]),
    JSON.stringify(topTabs),
);

await clickTab("General");
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
// Proficiencies render as a 2-column matrix (Active Class / Original Class), one `.strow` per slot with two
// value cells (`.c`) - not a grid. 20 slots x 2 columns = 40 cells.
const prof = await page.evaluate(() => {
    const matrix = document.querySelector(".layout-root .panel .matrix");
    return {
        rows: matrix ? matrix.querySelectorAll(".strow").length : 0,
        cells: matrix ? matrix.querySelectorAll(".strow .c").length : 0,
        colHeaders: matrix ? Array.from(matrix.querySelectorAll(".sub .bb"), (e) => (e.textContent ?? "").trim()) : [],
        firstRowLabel: matrix?.querySelector(".strow .nm")?.textContent?.trim() ?? "",
    };
});
check(
    "layout: proficiencies matrix renders 20 rows x 2 value columns (40 cells)",
    prof.rows === 20 && prof.cells === 40,
    JSON.stringify(prof),
);
check(
    "layout: proficiencies matrix column headers are Active/Original Class",
    JSON.stringify(prof.colHeaders) === JSON.stringify(["Active Class", "Original Class"]),
    JSON.stringify(prof.colHeaders),
);
check(
    "layout: proficiencies matrix first row labelled 'Large Swords'",
    prof.firstRowLabel === "Large Swords",
    prof.firstRowLabel,
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
// Baseline counts (Node-side ground truth). The spell tables are no longer list sections (they render through
// the spellbook), so they are absent from the sections map; the spellbook block is exercised via getSpellbook.
// ============================================================
const baseEffects = sectionCount(sectionNodeId["Effects"]!);
check("baseline: effects count >= 1", baseEffects >= 1, `count=${baseEffects}`);
// Total memorized spells across the joined view (cleanly-owned slots + any unassigned-bucket entries).
const memorizedTotal = (): number => {
    const r = dispatch({ type: "getSpellbook", sessionId });
    if (r.type !== "spellbook") return -1;
    return (
        r.view.types.reduce((n, t) => n + t.levels.reduce((m, l) => m + l.slots.length, 0), 0) + r.view.bucket.length
    );
};

// ============================================================
// SPELLS: the three spell tables render through the unified spellbook (type subtabs over per-level cards),
// not three flat lists. Assert it renders, then drive a "+ memorize" through the real message path and confirm
// the level gains a memorized slot.
// ============================================================
await clickTab("Spells");
await page.waitForSelector(".spellbook", { timeout: 3000 });
await page.screenshot({ path: path.join(here, "shot-cre-spells.png"), fullPage: true });
const spellbookTypeTabs = await page.locator(".spellbook .bb-tabs button[role='tab']").allInnerTexts();
check(
    "spells: spellbook renders a spell-type subtab (Wizard for the mage fixture)",
    spellbookTypeTabs.some((t) => /Wizard/i.test(t)),
    JSON.stringify(spellbookTypeTabs),
);
const baseMemorized = memorizedTotal();
const firstLevelCard = page.locator(".spellbook .sb-level").first();
check("spells: at least one level card renders", (await page.locator(".spellbook .sb-level").count()) >= 1, "");
const readSpellsTab = () =>
    page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'));
        const tab = tabs.find((b) => (b.textContent ?? "").trim().startsWith("Spells"));
        return (tab?.textContent ?? "").trim();
    });
const spellsTabBefore = await readSpellsTab();
await firstLevelCard.locator("button.sb-add", { hasText: "memorize" }).first().click();
await page.waitForTimeout(250);
const spellsTabAfter = await readSpellsTab();
check(
    "spells: + memorize adds a memorized spell (count +1)",
    memorizedTotal() === baseMemorized + 1,
    `count=${memorizedTotal()}`,
);
check(
    "spells: top-level Spells tab count refreshes after the structure op",
    spellsTabAfter !== spellsTabBefore && /\(\d+\/\d+\)/.test(spellsTabAfter),
    `before="${spellsTabBefore}" after="${spellsTabAfter}"`,
);
await doUndo();
const spellsTabUndone = await readSpellsTab();
check(
    "spells: undo restores the memorized-spell count",
    memorizedTotal() === baseMemorized,
    `count=${memorizedTotal()}`,
);
check(
    "spells: undo also restores the top-level Spells tab count",
    spellsTabUndone === spellsTabBefore,
    `before="${spellsTabBefore}" undone="${spellsTabUndone}"`,
);

// ---- Spellbook card layout: cards must be a uniform width (no flex-grow drift where a trailing odd card on a
// partial row hits max-width and is wider), and a level's Known and Memorized entries must align row-for-row. ----
await page.setViewportSize({ width: 900, height: 1500 });
await page.waitForTimeout(150);
const cardWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".spellbook .sb-level"), (el) => Math.round(el.getBoundingClientRect().width)),
);
check("spells: all level cards have equal width", new Set(cardWidths).size === 1, JSON.stringify(cardWidths));
await page.setViewportSize({ width: 1280, height: 1000 });
await page.waitForTimeout(150);
const entryAlign = await page.evaluate(() => {
    for (const c of Array.from(document.querySelectorAll(".spellbook .sb-level"))) {
        const cols = c.querySelectorAll(".sb-col");
        const k = cols[0] ? cols[0].querySelector(".sb-resref") : null;
        const m = cols[1] ? cols[1].querySelector(".sb-resref") : null;
        if (k && m)
            return { known: Math.round(k.getBoundingClientRect().top), mem: Math.round(m.getBoundingClientRect().top) };
    }
    return { known: -1, mem: -2 };
});
check(
    "spells: Known and Memorized first entries align (same top)",
    entryAlign.known === entryAlign.mem,
    JSON.stringify(entryAlign),
);
const xPos = await page.evaluate(() => {
    for (const c of Array.from(document.querySelectorAll(".spellbook .sb-level"))) {
        const row = c.querySelector(".sb-mem-row");
        if (!row) continue;
        const resref = row.querySelector(".sb-resref");
        const x = row.querySelector(".sb-x");
        const cb = row.querySelector(".bb-checkbox-label");
        if (resref && x && cb)
            return {
                resref: Math.round(resref.getBoundingClientRect().left),
                x: Math.round(x.getBoundingClientRect().left),
                cb: Math.round(cb.getBoundingClientRect().left),
            };
    }
    return { resref: 0, x: 0, cb: 0 };
});
check(
    "spells: memorized remove (x) follows the resref slot, before the flags",
    xPos.resref < xPos.x && xPos.x < xPos.cb,
    JSON.stringify(xPos),
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
// Effect detail: a CRE v2 effect renders through the SHARED EFF v2 fragment (the same LayoutRenderer panels
// a standalone `.eff` uses), not a generic auto-form - so the detail pane shows `.layout-root` panels, and
// opcode renders as a searchable combobox (spec searchableEnum).
// ============================================================
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
// h3 titles render uppercased by CSS (innerText returns the transformed text); compare case-insensitively.
const sharedPanels = (await effectsPanel.locator(".detail .layout-root .panel h3").allInnerTexts()).map((t) =>
    t.toUpperCase(),
);
check(
    "effects: v2 effect detail renders the shared EFF panels (Effect/Parameters/Resources/...)",
    sharedPanels.includes("EFFECT") && sharedPanels.includes("PARAMETERS") && sharedPanels.includes("RESOURCES"),
    JSON.stringify(sharedPanels),
);
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("effects: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

// Reserved/padding fields (signature2, version2, unused1-7) are not referenced by the shared fragment, so the
// v2 effect detail must NOT render them (edwin6 uses effStructureVersion 1 = EFF v2 body, which has all of
// them). They stay in the model for the byte round-trip (asserted below) - only the form omits them.
const effectDetailText = (await effectsPanel.locator(".detail").first().innerText()).toLowerCase();
const showsReserved = /signature|version\s*2|unused/.test(effectDetailText);
check(
    "effects: reserved/padding fields are hidden from the detail form",
    !showsReserved,
    `text-has-reserved=${showsReserved}`,
);

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

// ---- Screenshots ---- (shot-cre.png = the General tab, captured at load; here capture the Effects tab detail)
await clickTab("Effects");
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
await page.screenshot({ path: path.join(here, "shot-cre-effects.png"), fullPage: true });

await browser.close();

console.log("\n=== CRE layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL CRE ASSERTIONS PASS" : `\n${failed} CRE ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
