/**
 * Grouped-form harness pass.
 *
 * Drives the real App.svelte + FormSection with a synthetic display tree
 * that has both ungrouped fields and groups, so the tabs-over-accordion
 * organization is exercised. No real binary file is required.
 *
 * Synthetic tree (section "Settings", form, no-add/no-modify):
 *   - fields: "Name" (string), "Level" (int32)
 *   - groups: "Basics", "Advanced", "Other"  (3 groups -> vertical tablist at depth=1)
 *     - each group: 2 plain fields
 *
 * 7-group fallback tree (separate open):
 *   - groups g0..g6 (7 groups -> sections mode, no tablist)
 *
 * Assertions:
 *   - 2 ungrouped fields render outside any tab strip
 *   - 3 groups -> role=tablist with 3 [role=tab] buttons (group names)
 *   - clicking the second tab swaps the visible group's fields
 *   - 7 groups -> no tablist, headed sections visible
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
:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
    --vscode-font-size: 13px;
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-panel-border: #2b2b2b;
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #ffffff;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-input-placeholderForeground: #a6a6a6;
    --vscode-checkbox-background: #3c3c3c;
    --vscode-checkbox-foreground: #cccccc;
    --vscode-checkbox-border: #6b6b6b;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-editorWarning-foreground: #cca700;
}
${css}
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

const layout: LayoutDescriptor = {
    formatId: "synthetic",
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
    ],
};

const openResult: OpenResult = {
    sessionId: "syn-001",
    format: "synthetic",
    formatName: "Synthetic Test Format",
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
        else rows = (id != null ? sevenGroupChildren[id] : undefined) ?? [];
        const sliced = rows.slice(m.start, m.end);
        return [{ type: "children", requestId: m.requestId, parentId: id, rows: sliced, total: rows.length }];
    }
    return [];
}

// ---- Browser ----
const cspMessages: string[] = [];
const isCspViolation = (text: string): boolean => /Content Security Policy/i.test(text) || /Refused to/i.test(text);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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
await page.goto("file://" + htmlPath);

// Wait for the form section to appear (the "Settings" tab is active by default).
await page.waitForSelector(".tabs button", { timeout: 5000 });

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
// The top-level .tabs section strip also has role=tablist, so we scope to .bb-tabs (the in-form group tabs).
const bbTabsListCount = await page.locator(".bb-tabs[role='tablist']").count();
check("bb-tabs tablist renders for 3-group form", bbTabsListCount >= 1, `tablistCount=${bbTabsListCount}`);

const groupTabButtons = page.locator(".bb-tabs[role='tablist'] [role='tab']");
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
const initialTabActive = await page.locator(".bb-tabs [role='tab'][aria-selected='true']").first().textContent();
check("first tab is initially active", initialTabActive?.trim() === "Basics", `active='${initialTabActive?.trim()}'`);

const basicsFieldLabels = await page.locator(".form .field .label").allTextContents();
check("Basics fields visible: HP", basicsFieldLabels.includes("HP"), `labels=${basicsFieldLabels.join(",")}`);
check("Basics fields visible: MP", basicsFieldLabels.includes("MP"), `labels=${basicsFieldLabels.join(",")}`);

// ---- Click "Advanced" tab -> field swap ----
await page.locator(".bb-tabs [role='tab']", { hasText: "Advanced" }).first().click();
await page.waitForTimeout(200);

const advancedTabActive = await page.locator(".bb-tabs [role='tab'][aria-selected='true']").first().textContent();
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
await page.locator(".tabs button", { hasText: "Extra" }).first().click();
// Wait for at least one .subgroup-title to appear (sections mode renders these; not present in tabs mode).
await page.waitForSelector(".subgroup-title", { timeout: 3000 });
await page.waitForTimeout(100);

// The Extra form has 7 groups, which is > threshold (6), so organizeGroups returns sections mode.
// In sections mode, no .bb-tabs strip is rendered. The top-level .tabs section strip always has role=tablist,
// so we must count only .bb-tabs[role=tablist] (the in-form group tablist).
const extraTablistCount = await page.locator(".bb-tabs[role='tablist']").count();
check("no tablist for 7-group form (sections mode)", extraTablistCount === 0, `tablistCount=${extraTablistCount}`);

const subgroupTitles = await page.locator(".subgroup-title").allTextContents();
check("7-group form renders headed sections (>= 7)", subgroupTitles.length >= 7, `count=${subgroupTitles.length}`);
check(
    "headed section title present (Group 0)",
    subgroupTitles.includes("Group 0"),
    `titles=${subgroupTitles.join(",")}`,
);

await page.screenshot({ path: path.join(here, "shot-form-sections.png") });

await browser.close();

// ---- CSP ----
console.log("\n=== Form tabs harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL FORM TAB ASSERTIONS PASS" : `\n${failed} FORM TAB ASSERTIONS FAILED`);
if (cspMessages.length > 0) {
    console.log("\nCSP VIOLATION(S) detected:");
    for (const m of cspMessages) console.log("  " + m);
    console.log("\nFORM CSP FAILED");
    process.exit(1);
}
console.log("CSP: no violations");
if (failed > 0) process.exit(1);
