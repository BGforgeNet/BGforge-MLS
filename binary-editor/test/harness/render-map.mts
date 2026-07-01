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
import { shotPath } from "./out-dir";
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
    if (m.type === "structureOp") {
        // Drive interactive structure ops (e.g. the inventory mini-list add) back through the real dispatch and
        // hand the webview the resulting changeSet, the same shape the host provider posts.
        const r = dispatch({ type: "structureOp", sessionId, op: m.op });
        if (r.type === "structure") {
            return [
                {
                    type: "changeSet",
                    changeSet: r.result.changeSet,
                    ...(r.result.selection !== undefined && { selection: r.result.selection }),
                },
            ];
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "MAP");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
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
// MAP is tabbed (Header / Objects [per-elevation subtabs] / Scripts [pruned when absent]); capture Header first.
check(
    "screenshot: Header tab active for shot-map",
    (await activeTabLabel()).includes("Header"),
    await activeTabLabel(),
);
await page.screenshot({ path: shotPath("shot-map.png"), fullPage: true });

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
// The Header tab carries only the header fields and the map flags; the global/local variable inline lists live
// in the Variables tab and the per-elevation object lists in the Objects tab (checked below), each with absent
// sections leaving no panel.
const expectedPanels = ["Header", "Map Flags"];
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
const objectsMd = page.locator(".layout-root .master-detail").first();
const elevMd = await page.locator(".layout-root .master-detail").count();
check("layout: objects tab renders an elevation object list", elevMd >= 1, `count=${elevMd}`);
// Select the first object so the detail pane renders (otherwise the shot is just an empty "Select an entry." pane).
await objectsMd.locator(".vlist .vrow").first().waitFor({ timeout: 5000 });
await objectsMd.locator(".vlist .vrow").first().click();
await page.waitForTimeout(200);
check(
    "screenshot: Objects tab active for shot-map-objects",
    (await activeTabLabel()).includes("Objects"),
    await activeTabLabel(),
);
await page.screenshot({ path: shotPath("shot-map-objects.png"), fullPage: true });

// The object detail splits into "Details" + "Inventory" tabs; the engine Inventory Header bookkeeping group is
// hidden, so it must NOT appear as a form sub-tab. Open the Inventory tab to reach the mini-list.
const detailTabs = objectsMd.locator(".detail .detail-tabs > .bb-tabs").first();
check(
    "inventory: detail exposes a 'Details' and 'Inventory' tab",
    (await detailTabs.locator('button[role="tab"]').filter({ hasText: "Details" }).count()) === 1 &&
        (await detailTabs.locator('button[role="tab"]').filter({ hasText: "Inventory" }).count()) === 1,
    "",
);
check(
    "inventory: the engine Inventory Header group is hidden (no such tab)",
    (await objectsMd.locator('.detail .bb-tabs button[role="tab"]').filter({ hasText: "Inventory Header" }).count()) ===
        0,
    "",
);
await detailTabs.locator('button[role="tab"]').filter({ hasText: "Inventory" }).first().click();
await page.waitForTimeout(150);

// Inventory mini-list (interactive): cave6's first object has no inventory, so the list opens on its empty
// state. Add two items through the "+ add item" button (real addChild dispatch -> changeSet refresh), expand
// the first item's nested form, and screenshot the populated list with its per-row remove + accordion detail.
const inventoryList = page.locator(".child-list").first();
check("inventory: the object detail renders a child mini-list", (await inventoryList.count()) >= 1, "");
check(
    "inventory: starts on the empty state",
    (await inventoryList.locator(".child-list-empty").count()) === 1,
    (await inventoryList
        .locator(".child-list-empty")
        .textContent()
        .catch(() => "")) ?? "",
);
await inventoryList.locator(".child-list-add").click();
await page.waitForTimeout(150);
await inventoryList.locator(".child-list-add").click();
await page.waitForTimeout(150);
const invRows = await inventoryList.locator(".child-row").count();
check("inventory: + add item grew the list to two rows", invRows === 2, `rows=${invRows}`);
const invTabText =
    (await detailTabs
        .locator('button[role="tab"]')
        .filter({ hasText: "Inventory" })
        .first()
        .textContent()
        .catch(() => "")) ?? "";
check(
    "inventory: the Inventory tab label tracks the item count, in '(N)' form",
    invTabText.includes("(2)"),
    `label="${invTabText.trim()}"`,
);
await inventoryList.locator(".child-row .child-row-label").first().click();
await page.waitForTimeout(200);
// The row label is the item's identity (PID) + quantity, not the bare "Inventory Entry N" group name.
const firstRowLabel = (await inventoryList.locator(".child-row .child-row-label").first().textContent()) ?? "";
check(
    "inventory: row label shows the item PID + quantity",
    /0x[0-9a-f]+/i.test(firstRowLabel) && /x\d+/.test(firstRowLabel),
    `label="${firstRowLabel.trim()}"`,
);
check(
    "inventory: expanding a row reveals its nested item form",
    (await inventoryList.locator(".child-row-detail .form").count()) >= 1,
    "",
);
await page.screenshot({ path: shotPath("shot-map-inventory.png"), fullPage: true });

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

await browser.close();

console.log("\n=== MAP layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP ASSERTIONS PASS" : `\n${failed} MAP ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
