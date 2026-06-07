/**
 * MAP single-page layout harness pass.
 *
 * MAP is migrated to the declarative layout: header fields (with Map Flags as a flag column), the
 * global/local variable arrays as inline lists, the per-elevation object lists and the four script sections
 * as master-detail `list` blocks - all on one page (no section tabs). The object lists and scripts delegate
 * to the same windowed getChildren path the legacy tabs used. This driver opens a real Fallout map in the
 * REAL webview bundle and:
 *   - asserts the layout resolves (variant "map", per-elevation object sections with add/modify caps, the
 *     Header + Map Flags panel, both variable lists, no tabs, label/value spacing is non-zero);
 *   - confirms absent optional sections (the script sections here) render NOTHING - no panel, no "not found"
 *     stub leaks to the user (LayoutRenderer prunes panels/rows whose only content is an absent section);
 *   - drives structure ops at dispatch level on a variable list (add/undo) and an object list (insert/remove/
 *     undo) - the interactive DOM path is covered by the ITM/CRE harnesses (same ListSection component), and
 *     dispatch-level is robust against a 2000+ row virtualized list;
 *   - keeps a dispatch-level round-trip regression (open -> serialize -> byte-identical).
 *
 * Fixture: cave6 - a clean map (objects fully decode, so object structure ops apply rather than hitting the
 * opaque-tail corruption guard), with global + local variables and three elevation object sections (elev 0
 * populated, 1 and 2 present but empty, which exercises the empty-master-detail render).
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { mapParser } from "../../../binary/src/map/index";

const here = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.join(here, "../../../external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));
{
    const parsed = mapParser.parse(mapBytes);
    if (parsed.errors) throw new Error("fixture parse errors: " + parsed.errors.join(", "));
}

let sessionId = "";
const sectionNodeId: Record<string, string> = {};

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///cave6.map", bytes: mapBytes });
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
    return [];
}

function sectionCount(nodeId: string): number {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 4000 });
    return r.type === "children" ? r.total : -1;
}
function firstChildId(nodeId: string): string {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 1 });
    return r.type === "children" && r.rows[0] ? r.rows[0].id : "";
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const assertNoCsp = installCspGate(page, "MAP");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
// MAP is tabbed (Header / Objects [per-elevation subtabs] / Scripts [pruned when absent]); capture Header.
await page.screenshot({ path: path.join(here, "shot-map.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}

// ============================================================
// Layout assertions
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///caps.map", bytes: mapBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'map'", L?.variantId === "map", `variantId=${L?.variantId}`);
        check(
            "layout: Global Variables canAdd+canModify",
            L?.sections["Global Variables"]?.canAdd === true && L?.sections["Global Variables"]?.canModify === true,
            JSON.stringify(L?.sections["Global Variables"]),
        );
        check(
            "layout: Elevation 0 Objects canAdd+canModify",
            L?.sections["Elevation 0 Objects"]?.canAdd === true &&
                L?.sections["Elevation 0 Objects"]?.canModify === true,
            JSON.stringify(L?.sections["Elevation 0 Objects"]),
        );
        check(
            "layout: script sections absent in this fixture",
            L?.sections["System Scripts"] === undefined && L?.sections["Item Scripts"] === undefined,
            `system=${JSON.stringify(L?.sections["System Scripts"])}`,
        );
    }
}
const dom = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent);
    const masterDetails = document.querySelectorAll(".layout-root .master-detail").length;
    const tabs = document.querySelectorAll(".bb-tabs").length;
    const stubs = document.querySelectorAll(".layout-root .layout-stub").length;
    let minFieldGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minFieldGap) minFieldGap = gap;
    }
    return { panels, masterDetails, tabs, stubs, minFieldGap };
});
// The Header tab carries the header fields, map flags, and the global/local variable inline lists; the
// per-elevation object lists live in the Objects tab (checked below), and absent sections leave no panel.
const expectedPanels = ["Header", "Map Flags", "Global Variables", "Local Variables"];
check(
    "layout: Header tab panels render, in order",
    JSON.stringify(dom.panels) === JSON.stringify(expectedPanels),
    JSON.stringify(dom.panels),
);
check("layout: top-level tabs render (Header / Objects)", dom.tabs >= 1, `tabStrips=${dom.tabs}`);
check("layout: absent sections leave no 'not found' stub", dom.stubs === 0, `stubs=${dom.stubs}`);
check("layout: label/value gap is positive (no overlap)", dom.minFieldGap >= 4, `minFieldGap=${dom.minFieldGap}px`);

// Objects tab: the active elevation subtab renders its object list (master-detail).
await clickTab("Objects");
const elevMd = await page.locator(".layout-root .master-detail").count();
check("layout: objects tab renders an elevation object list", elevMd >= 1, `count=${elevMd}`);
await page.screenshot({ path: path.join(here, "shot-map-objects.png"), fullPage: true });

// ============================================================
// Baseline + structure ops (dispatch-level; the interactive DOM path is covered by ITM/CRE)
// ============================================================
const baseGlobals = sectionCount(sectionNodeId["Global Variables"]!);
const baseElev0 = sectionCount(sectionNodeId["Elevation 0 Objects"]!);
check("baseline: global vars >= 1", baseGlobals >= 1, `count=${baseGlobals}`);
check("baseline: elevation 0 objects >= 1", baseElev0 >= 1, `count=${baseElev0}`);

// Global Variables: add then undo.
{
    const add = dispatch({
        type: "structureOp",
        sessionId,
        op: { op: "add", sectionId: sectionNodeId["Global Variables"]! },
    });
    check(
        "global vars: add: +1",
        add.type === "structure" && sectionCount(sectionNodeId["Global Variables"]!) === baseGlobals + 1,
        `type=${add.type} count=${sectionCount(sectionNodeId["Global Variables"]!)}`,
    );
    dispatch({ type: "undo", sessionId });
    check(
        "global vars: undo back to baseline",
        sectionCount(sectionNodeId["Global Variables"]!) === baseGlobals,
        `count=${sectionCount(sectionNodeId["Global Variables"]!)}`,
    );
}

// Elevation 0 Objects: insert-before then remove, each undone.
{
    const fid = firstChildId(sectionNodeId["Elevation 0 Objects"]!);
    const ins = dispatch({ type: "structureOp", sessionId, op: { op: "insert", entryId: fid, position: "before" } });
    check(
        "elev0 objects: insert-before row0: +1",
        ins.type === "structure" && sectionCount(sectionNodeId["Elevation 0 Objects"]!) === baseElev0 + 1,
        `type=${ins.type} count=${sectionCount(sectionNodeId["Elevation 0 Objects"]!)}`,
    );
    dispatch({ type: "undo", sessionId });
    const rm = dispatch({ type: "structureOp", sessionId, op: { op: "remove", entryId: fid } });
    check(
        "elev0 objects: remove row0: -1",
        rm.type === "structure" && sectionCount(sectionNodeId["Elevation 0 Objects"]!) === baseElev0 - 1,
        `type=${rm.type} count=${sectionCount(sectionNodeId["Elevation 0 Objects"]!)}`,
    );
    dispatch({ type: "undo", sessionId });
    check(
        "elev0 objects: undo back to baseline",
        sectionCount(sectionNodeId["Elevation 0 Objects"]!) === baseElev0,
        `count=${sectionCount(sectionNodeId["Elevation 0 Objects"]!)}`,
    );
}

// ============================================================
// REGRESSION: open -> serialize round-trips byte-identical (dispatch-level).
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///roundtrip.map", bytes: mapBytes });
    if (r.type !== "opened") {
        check("regression: roundtrip open succeeded", false, `type=${r.type}`);
    } else {
        const s = dispatch({ type: "serialize", sessionId: r.result.sessionId });
        const out = s.type === "serialized" ? s.bytes : new Uint8Array();
        const identical = out.length === mapBytes.length && out.every((b, i) => b === mapBytes[i]);
        check(
            "regression: save round-trips byte-identical",
            identical,
            `outLen=${out.length} srcLen=${mapBytes.length}`,
        );
    }
}

// ---- Screenshot (best-effort: the stacked single page can exceed Chromium's capture limit) ----
try {
    await page.screenshot({ path: path.join(here, "shot-map.png"), fullPage: true });
} catch {
    await page.screenshot({ path: path.join(here, "shot-map.png") });
}

await browser.close();

console.log("\n=== MAP layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP ASSERTIONS PASS" : `\n${failed} MAP ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
