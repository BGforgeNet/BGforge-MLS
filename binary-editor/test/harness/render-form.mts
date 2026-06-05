/**
 * Phantom-format harness pass.
 *
 * Drives the real App.svelte + FormSection + ListSection with a synthetic
 * display tree for a made-up format ("gizmo") that does not exist in the
 * binary adapter registry. The renderer is format-agnostic by construction
 * and never branches on format id, so this proves the generic UI handles a
 * novel descriptor with zero format-specific code paths.
 *
 * Sections in the "gizmo" layout:
 *
 *   "Settings" (form, kind="form"):
 *     - fields: "Name" (string), "Level" (int32)
 *     - groups: "Basics", "Advanced", "Other"  (3 groups -> vertical tablist at depth=1)
 *       each group: 2 plain fields
 *
 *   "Extra" (form, kind="form"):
 *     - groups g0..g6 (7 groups -> sections mode, no tablist)
 *
 *   "Controls" (form, kind="form"):
 *     - "Mode"     - small enum (5 options -> Select)
 *     - "Target"   - large enum (15 options -> Combobox)
 *     - "Flags"    - flags field (3 bits -> Checkbox grid)
 *     - "Tag"      - string field (-> text input)
 *     - "Power"    - int32 field (-> number input)
 *
 *   "Widgets" (list, kind="list", render="master-detail", canAdd=true, canModify=true):
 *     - 3 list entries ("Widget 0", "Widget 1", "Widget 2")
 *     - each entry has a detail form with a Name (string) and Value (int32) field
 *
 * Assertions (all from prior form-tabs pass, plus):
 *   - 2 ungrouped fields render outside any tab strip
 *   - 3 groups -> role=tablist with 3 [role=tab] buttons (group names)
 *   - clicking the second tab swaps the visible group's fields
 *   - 7 groups -> no tablist, headed sections visible
 *   - "Controls" form: .bb-select-trigger (small enum), .bb-combobox-input (large enum),
 *     .flags-grid with checkboxes, input[type="text"], input[type="number"] all render
 *   - "Widgets" list: master list renders 3 .vrow entries; selecting one shows detail form
 *     with RowActions structure-op controls (labeled "Move up", "Delete" etc.)
 */

import { chromium } from "playwright";
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import type { Row, LayoutDescriptor, OpenResult } from "@bgforge/binary-editor";
import { installCspGate } from "./csp-gate";
import { THEME_VARS } from "./theme-vars";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// ---- Build the webview bundle (same pipeline as build.mjs) ----
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-form-"));
await build({
    entryPoints: [path.join(here, "harness-main.ts")],
    bundle: true,
    format: "iife",
    write: true,
    outdir,
    logLevel: "silent",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true } })],
});
const js = fs.readFileSync(path.join(outdir, "harness-main.js"), "utf8");
fs.rmSync(outdir, { recursive: true, force: true });
const css = fs.readFileSync(path.join(repo, "client/src/binary-editor/webview/styles.css"), "utf8");

const nonce = crypto.randomBytes(16).toString("base64");
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
${THEME_VARS}${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

const htmlPath = path.join(here, "form.html");
fs.writeFileSync(htmlPath, html);

// ---- Synthetic display tree ----
// Section root: nodeId "s0", kind="form", no-list.
// Children of "s0": 2 ungrouped fields + 3 groups.
// Each group: 2 fields.
const settingsSection: Row[] = [
    {
        id: "s0/0",
        namePath: ["Settings", "Name"],
        depth: 1,
        kind: "field",
        name: "Name",
        valueType: "string",
        displayValue: "Hero",
        rawValue: "Hero",
        editable: true,
    },
    {
        id: "s0/1",
        namePath: ["Settings", "Level"],
        depth: 1,
        kind: "field",
        name: "Level",
        valueType: "int32",
        displayValue: "5",
        rawValue: 5,
        editable: true,
    },
    { id: "s0/2", namePath: ["Settings", "Basics"], depth: 1, kind: "group", name: "Basics", hasChildren: true },
    { id: "s0/3", namePath: ["Settings", "Advanced"], depth: 1, kind: "group", name: "Advanced", hasChildren: true },
    { id: "s0/4", namePath: ["Settings", "Other"], depth: 1, kind: "group", name: "Other", hasChildren: true },
];

const basicsFields: Row[] = [
    {
        id: "s0/2/0",
        namePath: ["Settings", "Basics", "HP"],
        depth: 2,
        kind: "field",
        name: "HP",
        valueType: "int32",
        displayValue: "100",
        rawValue: 100,
        editable: true,
    },
    {
        id: "s0/2/1",
        namePath: ["Settings", "Basics", "MP"],
        depth: 2,
        kind: "field",
        name: "MP",
        valueType: "int32",
        displayValue: "50",
        rawValue: 50,
        editable: true,
    },
];
const advancedFields: Row[] = [
    {
        id: "s0/3/0",
        namePath: ["Settings", "Advanced", "Speed"],
        depth: 2,
        kind: "field",
        name: "Speed",
        valueType: "int32",
        displayValue: "10",
        rawValue: 10,
        editable: true,
    },
    {
        id: "s0/3/1",
        namePath: ["Settings", "Advanced", "Armor"],
        depth: 2,
        kind: "field",
        name: "Armor",
        valueType: "int32",
        displayValue: "3",
        rawValue: 3,
        editable: true,
    },
];
const otherFields: Row[] = [
    {
        id: "s0/4/0",
        namePath: ["Settings", "Other", "Luck"],
        depth: 2,
        kind: "field",
        name: "Luck",
        valueType: "int32",
        displayValue: "7",
        rawValue: 7,
        editable: true,
    },
    {
        id: "s0/4/1",
        namePath: ["Settings", "Other", "Notes"],
        depth: 2,
        kind: "field",
        name: "Notes",
        valueType: "string",
        displayValue: "",
        rawValue: "",
        editable: true,
    },
];

// 7-group section for the sections-fallback assertion.
const sevenGroupSection: Row[] = Array.from({ length: 7 }, (_, i) => ({
    id: `s1/${i}`,
    namePath: ["Extra", `Group ${i}`],
    depth: 1,
    kind: "group" as const,
    name: `Group ${i}`,
    hasChildren: true,
}));

// Each of the 7 groups gets 1 field.
const sevenGroupChildren: Record<string, Row[]> = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
        `s1/${i}`,
        [
            {
                id: `s1/${i}/0`,
                namePath: ["Extra", `Group ${i}`, "Val"],
                depth: 2,
                kind: "field" as const,
                name: "Val",
                valueType: "int32" as const,
                displayValue: "0",
                rawValue: 0,
                editable: true,
            },
        ],
    ]),
);

// ---- "Controls" form section: all four control types for the phantom format ----
// "Mode": small enum (5 options -> Select; threshold is 12, so 5 < threshold -> Select)
// "Target": large enum (15 options -> Combobox; 15 > threshold -> Combobox)
// "Flags": flags field (3 bits -> Checkbox grid)
// "Tag": string field (-> text input)
// "Power": int32 field (-> number input)
const controlsSection: Row[] = [
    {
        id: "s2/0",
        namePath: ["Controls", "Mode"],
        depth: 1,
        kind: "field",
        name: "Mode",
        valueType: "enum",
        displayValue: "Idle",
        rawValue: 0,
        editable: true,
        enumOptions: { "0": "Idle", "1": "Active", "2": "Passive", "3": "Sleep", "4": "Error" },
    },
    {
        id: "s2/1",
        namePath: ["Controls", "Target"],
        depth: 1,
        kind: "field",
        name: "Target",
        valueType: "enum",
        displayValue: "None",
        rawValue: 0,
        editable: true,
        // 15 options -> isLargeEnum(15) = true -> Combobox
        enumOptions: {
            "0": "None",
            "1": "Self",
            "2": "Ally",
            "3": "Enemy",
            "4": "Area",
            "5": "Point",
            "6": "Ground",
            "7": "Projectile",
            "8": "ItemInSlot",
            "9": "Container",
            "10": "Door",
            "11": "Trigger",
            "12": "Waypoint",
            "13": "Region",
            "14": "Creature",
        },
    },
    {
        id: "s2/2",
        namePath: ["Controls", "Flags"],
        depth: 1,
        kind: "field",
        name: "Flags",
        valueType: "flags",
        displayValue: "0x00",
        rawValue: 0,
        editable: true,
        flagOptions: { "0": "Enabled", "1": "Visible", "2": "Locked" },
    },
    {
        id: "s2/3",
        namePath: ["Controls", "Tag"],
        depth: 1,
        kind: "field",
        name: "Tag",
        valueType: "string",
        displayValue: "gizmo_01",
        rawValue: "gizmo_01",
        editable: true,
    },
    {
        id: "s2/4",
        namePath: ["Controls", "Power"],
        depth: 1,
        kind: "field",
        name: "Power",
        valueType: "int32",
        displayValue: "42",
        rawValue: 42,
        editable: true,
    },
];

// ---- "Widgets" list section: 3 top-level list entries ----
// Each entry is a "group" row (the master list item) served at the "Widgets" nodeId ("s3").
// Selecting an entry requests its children (the detail form fields).
const widgetsListRows: Row[] = Array.from({ length: 3 }, (_, i) => ({
    id: `s3/${i}`,
    namePath: ["Widgets", `Widget ${i}`],
    depth: 1,
    kind: "group" as const,
    name: `Widget ${i}`,
    hasChildren: true,
}));

// Each widget entry exposes a small detail form (Name + Value).
const widgetDetailRows: Record<string, Row[]> = Object.fromEntries(
    Array.from({ length: 3 }, (_, i) => [
        `s3/${i}`,
        [
            {
                id: `s3/${i}/0`,
                namePath: ["Widgets", `Widget ${i}`, "Name"],
                depth: 2,
                kind: "field" as const,
                name: "Name",
                valueType: "string" as const,
                displayValue: `widget_${i}`,
                rawValue: `widget_${i}`,
                editable: true,
            },
            {
                id: `s3/${i}/1`,
                namePath: ["Widgets", `Widget ${i}`, "Value"],
                depth: 2,
                kind: "field" as const,
                name: "Value",
                valueType: "int32" as const,
                displayValue: String(i * 10),
                rawValue: i * 10,
                editable: true,
            },
        ],
    ]),
);

const layout: LayoutDescriptor = {
    // "gizmo" is intentionally not one of the real format ids (pro/itm/spl/eff/cre/map).
    // The renderer is format-agnostic and never branches on this id.
    formatId: "gizmo",
    sections: [
        {
            id: "s0",
            title: "Settings",
            kind: "form",
            nodeId: "s0",
            render: "master-detail",
            canAdd: false,
            canModify: false,
        },
        {
            id: "s1",
            title: "Extra",
            kind: "form",
            nodeId: "s1",
            render: "master-detail",
            canAdd: false,
            canModify: false,
        },
        {
            id: "s2",
            title: "Controls",
            kind: "form",
            nodeId: "s2",
            render: "master-detail",
            canAdd: false,
            canModify: false,
        },
        {
            id: "s3",
            title: "Widgets",
            kind: "list",
            nodeId: "s3",
            render: "master-detail",
            canAdd: true,
            canModify: true,
        },
    ],
};

const openResult: OpenResult = {
    sessionId: "syn-001",
    format: "gizmo",
    formatName: "Gizmo (phantom format)",
    layout,
    warnings: [],
    errors: [],
    rootWindow: [],
};

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        return [{ type: "init", open: openResult }];
    }
    if (m.type === "requestChildren") {
        const id = m.nodeId;
        let rows: Row[];
        if (id === "s0") rows = settingsSection;
        else if (id === "s0/2") rows = basicsFields;
        else if (id === "s0/3") rows = advancedFields;
        else if (id === "s0/4") rows = otherFields;
        else if (id === "s1") rows = sevenGroupSection;
        else if (id === "s2") rows = controlsSection;
        else if (id === "s3") rows = widgetsListRows;
        else rows = (id != null ? (sevenGroupChildren[id] ?? widgetDetailRows[id]) : undefined) ?? [];
        const sliced = rows.slice(m.start, m.end);
        return [{ type: "children", requestId: m.requestId, parentId: id, rows: sliced, total: rows.length }];
    }
    return [];
}

// ---- Browser ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const assertNoCsp = installCspGate(page, "PHANTOM");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + htmlPath);

// Wait for the form section to appear (the "Settings" tab is active by default).
// Section tabs now render via the Tabs primitive with role=tab.
await page.waitForSelector(".bb-tabs.primary [role='tab']", { timeout: 5000 });

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// Give Svelte effects time to settle (requestChildren is async).
await page.waitForTimeout(300);

// ---- Ungrouped fields render outside any tab strip ----
// The 2 ungrouped fields ("Name", "Level") should appear as .field elements.
const fieldCount = await page.locator(".form .field").count();
check("ungrouped fields render (>= 2)", fieldCount >= 2, `fieldCount=${fieldCount}`);

// ---- 3 groups -> role=tablist with 3 [role=tab] buttons ----
// Both the section strip (.bb-tabs.primary) and in-form group tabs (.bb-tabs.secondary) have role=tablist.
// Scope to .bb-tabs.secondary to count only the in-form group tablist.
const bbTabsListCount = await page.locator(".bb-tabs.secondary[role='tablist']").count();
check("bb-tabs tablist renders for 3-group form", bbTabsListCount >= 1, `tablistCount=${bbTabsListCount}`);

const groupTabButtons = page.locator(".bb-tabs.secondary[role='tablist'] [role='tab']");
const tabCount = await groupTabButtons.count();
check("3 group tabs render", tabCount === 3, `tabCount=${tabCount}`);

// Verify the group names appear as tab labels.
const tabLabels: string[] = [];
for (let i = 0; i < tabCount; i++) {
    tabLabels.push((await groupTabButtons.nth(i).textContent())?.trim() ?? "");
}
check("tab labels match group names (Basics)", tabLabels.includes("Basics"), `labels=${tabLabels.join(",")}`);
check("tab labels match group names (Advanced)", tabLabels.includes("Advanced"), `labels=${tabLabels.join(",")}`);
check("tab labels match group names (Other)", tabLabels.includes("Other"), `labels=${tabLabels.join(",")}`);

// ---- Active group's fields render ----
// Initially "Basics" is the first group, so HP and MP fields should appear.
const initialTabActive = await page
    .locator(".bb-tabs.secondary [role='tab'][aria-selected='true']")
    .first()
    .textContent();
check("first tab is initially active", initialTabActive?.trim() === "Basics", `active='${initialTabActive?.trim()}'`);

const basicsFieldLabels = await page.locator(".form .field .label").allTextContents();
check("Basics fields visible: HP", basicsFieldLabels.includes("HP"), `labels=${basicsFieldLabels.join(",")}`);
check("Basics fields visible: MP", basicsFieldLabels.includes("MP"), `labels=${basicsFieldLabels.join(",")}`);

// ---- Click "Advanced" tab -> field swap ----
await page.locator(".bb-tabs.secondary [role='tab']", { hasText: "Advanced" }).first().click();
await page.waitForTimeout(200);

const advancedTabActive = await page
    .locator(".bb-tabs.secondary [role='tab'][aria-selected='true']")
    .first()
    .textContent();
check(
    "Advanced tab active after click",
    advancedTabActive?.trim() === "Advanced",
    `active='${advancedTabActive?.trim()}'`,
);

const advancedFieldLabels = await page.locator(".form .field .label").allTextContents();
check(
    "Advanced fields visible: Speed",
    advancedFieldLabels.includes("Speed"),
    `labels=${advancedFieldLabels.join(",")}`,
);
check(
    "Advanced fields visible: Armor",
    advancedFieldLabels.includes("Armor"),
    `labels=${advancedFieldLabels.join(",")}`,
);
// Basics fields must no longer be visible.
check(
    "Basics fields hidden after tab switch",
    !advancedFieldLabels.includes("HP"),
    `labels=${advancedFieldLabels.join(",")}`,
);

// ---- No accordion caret remnants ----
const caretCount = await page.locator(".caret").count();
check("no accordion carets", caretCount === 0, `caretCount=${caretCount}`);

await page.screenshot({ path: path.join(here, "shot-form-tabs.png") });

// ---- 7-group fallback: switch to "Extra" section ----
await page.locator(".bb-tabs.primary [role='tab']", { hasText: "Extra" }).first().click();
// Wait for at least one .subgroup-title to appear (sections mode renders these; not present in tabs mode).
await page.waitForSelector(".subgroup-title", { timeout: 3000 });
await page.waitForTimeout(100);

// The Extra form has 7 groups, which is > threshold (6), so organizeGroups returns sections mode.
// In sections mode, no .bb-tabs.secondary strip is rendered. The section strip (.bb-tabs.primary) is always
// present, so we count only .bb-tabs.secondary[role=tablist] (the in-form group tablist).
const extraTablistCount = await page.locator(".bb-tabs.secondary[role='tablist']").count();
check("no tablist for 7-group form (sections mode)", extraTablistCount === 0, `tablistCount=${extraTablistCount}`);

const subgroupTitles = await page.locator(".subgroup-title").allTextContents();
check("7-group form renders headed sections (>= 7)", subgroupTitles.length >= 7, `count=${subgroupTitles.length}`);
check(
    "headed section title present (Group 0)",
    subgroupTitles.includes("Group 0"),
    `titles=${subgroupTitles.join(",")}`,
);

await page.screenshot({ path: path.join(here, "shot-form-sections.png") });

// ============================================================
// PHANTOM-FORMAT CONTROL TYPES
// Switch to the "Controls" section and assert each control type renders via its primitive.
// ============================================================

await page.locator(".bb-tabs.primary [role='tab']", { hasText: "Controls" }).first().click();
await page.waitForTimeout(300);

// Small enum (5 options) -> Select -> .bb-select-trigger
const selectCount = await page.locator(".bb-select-trigger").count();
check("phantom: small enum renders Select (.bb-select-trigger)", selectCount >= 1, `count=${selectCount}`);

// Large enum (15 options) -> Combobox -> .bb-combobox-input
const comboboxCount = await page.locator(".bb-combobox-input").count();
check("phantom: large enum renders Combobox (.bb-combobox-input)", comboboxCount >= 1, `count=${comboboxCount}`);

// Flags field -> .flags-grid with checkboxes (role="checkbox")
const flagsGridCount = await page.locator(".flags-grid").count();
check("phantom: flags field renders .flags-grid", flagsGridCount >= 1, `count=${flagsGridCount}`);
const flagsCheckboxCount = await page.locator(".flags-grid [role='checkbox']").count();
check("phantom: flags checkboxes present (>= 3)", flagsCheckboxCount >= 3, `count=${flagsCheckboxCount}`);

// String field -> input[type="text"]
const stringInputCount = await page.locator(".form input[type='text']").count();
check("phantom: string field renders text input", stringInputCount >= 1, `count=${stringInputCount}`);

// Number field -> input[type="number"]
const numberInputCount = await page.locator(".form input[type='number']").count();
check("phantom: number field renders number input", numberInputCount >= 1, `count=${numberInputCount}`);

// ============================================================
// PHANTOM-FORMAT LIST SECTION
// Switch to "Widgets" and assert master-detail list: 3 entries, selection -> detail + RowActions.
// ============================================================

await page.locator(".bb-tabs.primary [role='tab']", { hasText: "Widgets" }).first().click();
// Wait for VirtualList to render at least 3 .vrow entries.
await page.waitForFunction(() => document.querySelectorAll(".vlist .vrow").length >= 3, { timeout: 5000 });
await page.waitForTimeout(200);

const vrowCount = await page.locator(".vlist .vrow").count();
check("phantom: list section renders 3 master entries", vrowCount >= 3, `count=${vrowCount}`);

// Select the first entry and wait for the detail form to appear.
await page.locator(".vlist .vrow").first().click();
await page.waitForSelector(".row-actions", { timeout: 3000 });
await page.waitForSelector(".form .field", { timeout: 3000 });
await page.waitForTimeout(100);

// Detail form must show field labels for the selected widget entry.
const detailLabels = await page.locator(".form .field .label").allTextContents();
check("phantom: detail form has Name field", detailLabels.includes("Name"), `labels=${detailLabels.join(",")}`);
check("phantom: detail form has Value field", detailLabels.includes("Value"), `labels=${detailLabels.join(",")}`);

// Structure-op controls (RowActions, non-compact mode): labeled buttons must be present.
const moveUpBtn = await page.locator('.row-actions button[aria-label="Move up"]').count();
check("phantom: list RowActions has Move up button", moveUpBtn >= 1, `count=${moveUpBtn}`);
const deleteBtn = await page.locator('.row-actions button[aria-label="Delete"]').count();
check("phantom: list RowActions has Delete button", deleteBtn >= 1, `count=${deleteBtn}`);

await page.screenshot({ path: path.join(here, "shot-phantom.png") });

await browser.close();

// ---- Results ----
console.log("\n=== Phantom-format harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PHANTOM-FORMAT ASSERTIONS PASS" : `\n${failed} PHANTOM-FORMAT ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
