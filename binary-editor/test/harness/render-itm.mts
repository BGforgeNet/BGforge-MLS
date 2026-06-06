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
const assertNoCsp = installCspGate(page, "ITM");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));

// Wait for the ITM to open and section tabs to appear (role=tab set by the Tabs primitive).
await page.waitForSelector("[role='tablist'] [role='tab']", { timeout: 5000 });

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

// ---- Summary dispatch-side check ----
// Verify the dispatch produces non-empty summaries for effects rows before the webview assertion.
{
    const r = dispatch({ type: "getChildren", sessionId, nodeId: effectsNodeId, start: 0, end: 3 });
    const summaries = r.type === "children" ? r.rows.map((row) => row.summary ?? "") : [];
    check(
        "summary: effect row 0 has a summary (opcode label)",
        summaries[0] !== undefined && summaries[0].length > 0,
        `summary="${summaries[0]}"`,
    );
    check(
        "summary: effect row 1 has a summary (opcode label)",
        summaries[1] !== undefined && summaries[1].length > 0,
        `summary="${summaries[1]}"`,
    );
}

// ---- Helper: navigate to a section tab and wait for rows ----
// Section tabs are now rendered via the Tabs primitive: role=tablist + role=tab + aria-selected.
// Scope to .bb-tabs.primary (the section strip) to avoid matching in-form group tabs.
async function goToSection(p: Page, tabLabel: string, expectedRows: number): Promise<void> {
    await p.locator(".bb-tabs.primary [role='tab']", { hasText: tabLabel }).first().click();
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

// ---- Helper: click a RowActions button by aria-label ----
async function clickAction(p: Page, ariaLabel: string): Promise<void> {
    await p.locator(`.row-actions button[aria-label="${ariaLabel}"]`).first().click();
    await p.waitForTimeout(200);
}

// ---- Helper: click Delete then confirm (two-step) ----
async function clickDelete(p: Page): Promise<void> {
    await clickAction(p, "Delete");
    // After arming, the confirm button appears; click it to dispatch.
    await p.locator(`.row-actions button[aria-label="Confirm delete"]`).first().click();
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
await clickAction(page, "Add above");
check(
    "abilities: insert-before row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: insert after row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "Add below");
check(
    "abilities: insert-after row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: reorder down row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "Move down");
check(
    "abilities: reorder-down row0: count unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: reorder up row 1 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);
await clickAction(page, "Move up");
check(
    "abilities: reorder-up row1: count unchanged",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: duplicate row 0 ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "Duplicate");
check(
    "abilities: duplicate row0: count +1",
    sectionKids(abilitiesNodeId).total === 3,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
await doUndo();

// --- Ability: delete single-click must NOT remove (confirm-required gate) ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);
await clickAction(page, "Delete");
check(
    "abilities: delete single-click does NOT remove (confirm pending)",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);
// Cancel the pending confirm so state resets for the next step.
await page.locator(`.row-actions button[aria-label="Cancel delete"]`).first().click();
await page.waitForTimeout(100);

// --- Ability: remove row 1 (two-step confirm) ---
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);
await clickDelete(page);
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
await clickAction(page, "Add above");
check(
    "effects: insert-before row0: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: insert after row 0 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 0);
await clickAction(page, "Add below");
check(
    "effects: insert-after row0: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: reorder down row 1 (ability1 owns effects[1,2] - valid same-owner swap) ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickAction(page, "Move down");
check(
    "effects: reorder-down row1 (same owner): count unchanged",
    sectionKids(effectsNodeId).total === 3,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: reorder up row 2 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 2);
await clickAction(page, "Move up");
check(
    "effects: reorder-up row2 (same owner): count unchanged",
    sectionKids(effectsNodeId).total === 3,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: duplicate row 1 ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickAction(page, "Duplicate");
check(
    "effects: duplicate row1: count +1",
    sectionKids(effectsNodeId).total === 4,
    `total=${sectionKids(effectsNodeId).total}`,
);
await doUndo();

// --- Effect: remove row 1 (two-step confirm) ---
await goToSection(page, "Effects", 3);
await selectRow(page, 1);
await clickDelete(page);
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

        // Address the only effect by its stable NodeId (structure ops are NodeId-keyed, not label-keyed).
        const firstEffectId = wmBefore.type === "children" ? (wmBefore.rows[0]?.id ?? "") : "";
        const removeR = dispatch({
            type: "structureOp",
            sessionId: wmSession,
            op: { op: "remove", entryId: firstEffectId },
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

// ---- Labeled-controls + delete-confirm assertions ----
// Verify the toolbar has clearly labeled controls and that Delete is a two-step operation.
await goToSection(page, "Abilities", 2);
await selectRow(page, 1);

// "Move up" button must exist with the correct aria-label.
const moveUpBtn = page.locator(`.row-actions button[aria-label="Move up"]`).first();
check("controls: Move up button is present", await moveUpBtn.isVisible(), "visible check");

// Delete requires a deliberate second click: first click arms confirm, count must still be 2.
await clickAction(page, "Delete");
const afterArm = sectionKids(abilitiesNodeId).total;
check("controls: single Delete click does not remove (count unchanged)", afterArm === 2, `total=${afterArm}`);
// Cancel the confirm so the state is clean.
await page.locator(`.row-actions button[aria-label="Cancel delete"]`).first().click();
await page.waitForTimeout(100);

// ---- Wrong-entry regression: arming delete on one entry must NOT carry over to a different entry. ----
// ListSection reuses a single RowActions instance; without the entry-switch reset, the still-armed Confirm
// would delete the now-selected entry. Arm on row 0, switch to row 1, assert the confirm affordance cleared
// and a follow-up Confirm-delete would be impossible (button gone) - and the count is untouched.
await goToSection(page, "Abilities", 2);
await selectRow(page, 0);
await clickAction(page, "Delete");
// Confirm affordance is showing for row 0.
const armedBeforeSwitch = await page.locator(`.row-actions button[aria-label="Confirm delete"]`).count();
check("controls: confirm armed on entry A", armedBeforeSwitch === 1, `count=${armedBeforeSwitch}`);
// Switch selection to a DIFFERENT entry (row 1). The reset effect must clear the pending confirm.
await selectRow(page, 1);
const armedAfterSwitch = await page.locator(`.row-actions button[aria-label="Confirm delete"]`).count();
check(
    "controls: switching entry clears pending confirm (no carry-over)",
    armedAfterSwitch === 0,
    `confirm-buttons=${armedAfterSwitch}`,
);
check(
    "controls: switching entry while armed does not delete (count unchanged)",
    sectionKids(abilitiesNodeId).total === 2,
    `total=${sectionKids(abilitiesNodeId).total}`,
);

// ---- Offset toggle assertions ----
// Offsets are hidden by default (developer affordance, not needed by end users).
// Selecting a row populates the detail form; in the default state no .offset elements should appear.
await goToSection(page, "Effects", 3);
await selectRow(page, 0);
// Wait for the detail form to populate with fields.
await page.waitForSelector(".form .field", { timeout: 3000 });
const offsetsBeforeToggle = await page.locator(".offset").count();
check("offsets: hidden by default (count=0)", offsetsBeforeToggle === 0, `count=${offsetsBeforeToggle}`);
// Click the "Show offsets" checkbox in the toolbar to enable offsets.
await page.locator(".toolbar label.bb-checkbox-label").click();
await page.waitForTimeout(100);
const offsetsAfterToggle = await page.locator(".offset").count();
check("offsets: visible after toggle (count>0)", offsetsAfterToggle > 0, `count=${offsetsAfterToggle}`);
// Turn offsets back off so the screenshots reflect the default (offsets hidden) state.
await page.locator(".toolbar label.bb-checkbox-label").click();
await page.waitForTimeout(100);

// ============================================================
// DIAGNOSTIC AFFORDANCES: inject a synthetic diagnostic to verify
// the warning icon marker, banner, and quick-fix button all render.
//
// We navigate to Effects, select row 0 (populates the detail form),
// read one field's nodeId from the DOM, then post a synthetic
// { type: "diagnostics" } message. The field must show a .diag.warning
// wrapper with aria-label matching the message, the banner must render
// with the .banner-header icon, and the .quick-fix button must appear.
// A second post with [] clears the state so screenshots below are clean.
// ============================================================

await goToSection(page, "Effects", 3);
await selectRow(page, 0);
await page.waitForSelector(".form .field", { timeout: 3000 });

// Grab the first field's DOM id attribute - Field.svelte sets the row's nodeId as
// data-node-id on the .field div only if we added it; instead we read the first
// field label text and use the dispatch Node side to get the matching row's id.
// The simpler path: read the field list from dispatch (Node side), pick row 0's id.
const effectsRows = dispatch({ type: "getChildren", sessionId, nodeId: effectsNodeId, start: 0, end: 1 });
const firstEffectNodeId = effectsRows.type === "children" ? (effectsRows.rows[0]?.id ?? "") : "";

// Get children of the first effect row (its form fields).
let diagNodeId = "";
if (firstEffectNodeId !== "") {
    const fieldRows = dispatch({ type: "getChildren", sessionId, nodeId: firstEffectNodeId, start: 0, end: 1 });
    if (fieldRows.type === "children") diagNodeId = fieldRows.rows[0]?.id ?? "";
}

if (diagNodeId !== "") {
    const syntheticDiagMsg = "Value out of range";
    const syntheticQuickFixLabel = "Reset to default";
    const syntheticDiag: HostToWebview = {
        type: "diagnostics",
        diagnostics: [
            {
                nodeId: diagNodeId,
                severity: "warning",
                message: syntheticDiagMsg,
                quickFix: {
                    label: syntheticQuickFixLabel,
                    edits: [{ nodeId: diagNodeId, value: 0 }],
                },
            },
        ],
    };
    await page.evaluate((m) => window.postMessage(m, "*"), syntheticDiag);
    await page.waitForTimeout(200);

    // Assert: .diag.warning marker present on the field.
    const diagMarkerCount = await page.locator(".form .diag.warning").count();
    check(
        "diagnostics: warning marker renders (.diag.warning present)",
        diagMarkerCount >= 1,
        `count=${diagMarkerCount}`,
    );

    // Assert: marker carries aria-label equal to the diagnostic message (screen reader accessible).
    const ariaLabel = await page.locator(".form .diag.warning").first().getAttribute("aria-label");
    check(
        "diagnostics: marker aria-label matches message",
        ariaLabel === syntheticDiagMsg,
        `aria-label="${ariaLabel}"`,
    );

    // Assert: banner renders with the warning surface.
    const bannerCount = await page.locator(".banner.warning").count();
    check("diagnostics: warning banner renders (.banner.warning present)", bannerCount >= 1, `count=${bannerCount}`);

    // Assert: banner carries the leading icon (.banner-header .codicon).
    const bannerIconCount = await page.locator(".banner-header .codicon").count();
    check(
        "diagnostics: banner has leading icon (.banner-header .codicon)",
        bannerIconCount >= 1,
        `count=${bannerIconCount}`,
    );

    // Assert: banner summary text contains the word "warning".
    const summaryText = await page.locator(".banner-summary").first().textContent();
    check(
        "diagnostics: banner summary mentions 'warning'",
        (summaryText ?? "").includes("warning"),
        `summary="${summaryText}"`,
    );

    // Assert: .quick-fix button renders with the fix label.
    const quickFixCount = await page.locator(".form .quick-fix").count();
    check("diagnostics: quick-fix button renders (.quick-fix present)", quickFixCount >= 1, `count=${quickFixCount}`);
    const quickFixText = await page.locator(".form .quick-fix").first().textContent();
    check(
        "diagnostics: quick-fix button contains fix label",
        (quickFixText ?? "").includes(syntheticQuickFixLabel),
        `text="${quickFixText}"`,
    );

    // Screenshot the diagnostic state so it can be visually reviewed.
    await page.screenshot({ path: path.join(here, "shot-diagnostics.png") });

    // Clear diagnostics so subsequent screenshots show the clean state.
    await page.evaluate((m) => window.postMessage(m, "*"), { type: "diagnostics", diagnostics: [] } as HostToWebview);
    await page.waitForTimeout(150);
} else {
    check("diagnostics: could resolve a field nodeId for injection", false, "nodeId empty - skipped render check");
}

// ---- Summary DOM render assertions ----
// Confirm that the VirtualList rows now display the dispatch-provided opcode summary as
// their primary label. Read the expected summaries from the dispatch (Node-side ground truth),
// then assert the corresponding DOM .vrow elements contain those strings.
{
    const r = dispatch({ type: "getChildren", sessionId, nodeId: effectsNodeId, start: 0, end: 3 });
    const summaries = r.type === "children" ? r.rows.map((row) => row.summary ?? "") : [];
    await goToSection(page, "Effects", 3);
    for (let i = 0; i < Math.min(summaries.length, 3); i++) {
        const expected = summaries[i] ?? "";
        if (expected.length === 0) continue;
        const vrowText = (await page.locator(".vlist .vrow").nth(i).textContent()) ?? "";
        check(
            `summary DOM: effects row ${i} contains dispatch summary`,
            vrowText.includes(expected),
            `expected="${expected}" in "${vrowText}"`,
        );
    }
}

// ---- Filter assertions ----
// Type a query into the effects filter input, assert visible row count narrows, clear, assert all return.
// "Stat" is in the summary of effects 0 and 2 but not effect 1 ("State: Invisibility" starts with "State",
// not "Stat" as a standalone word, but "Stat:" is a prefix of effect 0 and 2 summaries - use "Invisibility"
// to match exactly one effect).
await goToSection(page, "Effects", 3);
{
    const filterInput = page.locator(".list-filter-input").first();
    // Type a query that matches exactly one effect row (effect 1: "State: Invisibility").
    // pressSequentially fires keyboard events so Svelte's bind:value picks up the value.
    await filterInput.click();
    await filterInput.pressSequentially("invisibility");
    await page.waitForTimeout(200);
    const filteredCount = await page.locator(".vlist .vrow").count();
    check("filter: 'invisibility' narrows effects to 1 row", filteredCount === 1, `vrow count=${filteredCount}`);
    // Verify the visible row contains the expected label.
    const filteredText = (await page.locator(".vlist .vrow").first().textContent()) ?? "";
    check(
        "filter: filtered row contains 'Invisibility'",
        filteredText.toLowerCase().includes("invisibility"),
        `text="${filteredText}"`,
    );
    // Clear the filter via the clear button and wait for it to appear.
    await page.locator(".list-filter-clear").first().waitFor({ state: "visible", timeout: 3000 });
    await page.locator(".list-filter-clear").first().click();
    await page.waitForTimeout(200);
    // After clearing, VirtualList returns to normal virtualized mode and should render all 3 rows.
    const clearedCount = await page.locator(".vlist .vrow").count();
    check("filter: after clear, all 3 effects return", clearedCount >= 3, `vrow count=${clearedCount}`);
}

// ---- Screenshots ----
await goToSection(page, "Abilities", 2);
await page.screenshot({ path: path.join(here, "shot-itm-abilities.png") });
await goToSection(page, "Effects", 3);
// Apply the filter and take a screenshot of the filtered state.
{
    const filterInput = page.locator(".list-filter-input").first();
    await filterInput.click();
    await filterInput.pressSequentially("invisibility");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(here, "shot-itm-effects-filtered.png") });
    await page.locator(".list-filter-clear").first().waitFor({ state: "visible", timeout: 3000 });
    await page.locator(".list-filter-clear").first().click();
    await page.waitForTimeout(100);
}
await selectRow(page, 0);
await page.waitForSelector(".form .field", { timeout: 3000 });
await page.screenshot({ path: path.join(here, "shot-itm-effects.png") });

await browser.close();

// ============================================================
// Report
// ============================================================
console.log("\n=== ITM harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL ITM OPS PASS" : `\n${failed} ITM OPS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
