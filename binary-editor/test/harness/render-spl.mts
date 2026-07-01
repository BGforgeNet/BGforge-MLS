/**
 * SPL single-page layout harness pass.
 *
 * SPL renders a General tab plus a single "Abilities & Effects" TREE tab (the flat Abilities / Effects
 * master-detail tabs were replaced by the tree, parallel to ITM). SPL ability rows additionally show a
 * "Level Required" badge (ITM abilities carry no level). Opens a synthetic SPL (2 abilities with distinct
 * required levels, 3 effects) in the REAL webview bundle and:
 *   - asserts the General tab layout resolves (variant "spell", panels, positive label/value spacing);
 *   - asserts the tree renders Global + per-ability groups with nested effects and a Level Required badge,
 *     and that selecting an effect / ability renders the shared detail fragment;
 *   - keeps the casting-free SPL remove-first-effect regression (dispatch-level, DOM-independent).
 *
 * Structure ops left the UI with the old tabs; they remain covered by entity-ops unit tests and are
 * re-exercised end-to-end here only via the regression below.
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";
import { splParser } from "../../../binary/src/spl/index";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "../../../binary/src/spl/canonical-reader";
import { serializeSplCanonicalDocument } from "../../../binary/src/spl/canonical-writer";
import { defaultSplAbility } from "../../../binary/src/spl/entity-ops";
import { defaultIeEffect } from "../../../binary/src/ie-common/structure-ops";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Build synthetic SPL bytes ----
const FIXTURE = path.join(here, "../../../external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl");
const baseParsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
if (baseParsed.errors) throw new Error("fixture parse errors: " + baseParsed.errors.join(", "));
const baseDoc = getSplCanonicalDocument(baseParsed) ?? rebuildSplCanonicalDocument(baseParsed);
if (!baseDoc) throw new Error("no canonical doc from fixture");

const mkEffect = (opcode: number) => ({ ...defaultIeEffect(), opcode });
const syntheticDoc = {
    ...baseDoc,
    header: { ...baseDoc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
    abilities: [
        { ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1, levelRequired: 1 },
        { ...defaultSplAbility(), featureBlocksOffset: 1, featureBlocksCount: 2, levelRequired: 5 },
    ],
    effects: [mkEffect(10), mkEffect(20), mkEffect(21)],
};
const splBytes = serializeSplCanonicalDocument(syntheticDoc);

// ---- Session state ----
let sessionId = "";
let abilitiesNodeId = "";
let effectsNodeId = "";

/** Resolve a depth-0 group's node id by name (the tree joins Abilities/Effects internally, so the layout no
 *  longer exposes them as `sections`). */
function groupNodeId(name: string): string {
    const r = dispatch({ type: "getChildren", sessionId, nodeId: null, start: 0, end: 50 });
    return r.type === "children" ? (r.rows.find((row) => row.name === name)?.id ?? "") : "";
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///synthetic.spl", bytes: splBytes });
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
    return [];
}

function sectionKids(nodeId: string): number {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
    return r.type === "children" ? r.total : -1;
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Browser ----
const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "SPL");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: shotPath("shot-spl.png"), fullPage: true });
async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page.waitForTimeout(200);
}

// ---- Layout assertions (General tab) ----
{
    const r = dispatch({ type: "open", uri: "file:///caps.spl", bytes: splBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'spell'", L?.variantId === "spell", `variantId=${L?.variantId}`);
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
    // Exclude-panel subgroup legends (flagGroups): Priests / Mages / Other.
    const excludeGroups = Array.from(
        document.querySelectorAll(".layout-root .flag-groups .flag-group-name"),
        (e) => e.textContent,
    );
    let minGap = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
        if (gap < minGap) minGap = gap;
    }
    return { panels, excludeGroups, minGap };
});
check(
    "layout: General tab panels render (Spell / Flags / Exclude)",
    JSON.stringify(dom.panels) === JSON.stringify(["Spell", "Flags", "Exclude"]),
    JSON.stringify(dom.panels),
);
check(
    "layout: Exclude panel groups exclusion flags into Priests / Mages / Class subgroups",
    JSON.stringify(dom.excludeGroups) === JSON.stringify(["Priests", "Mages", "Class"]),
    JSON.stringify(dom.excludeGroups),
);
check("layout: label/value gap is positive (no overlap)", dom.minGap >= 4, `minGap=${dom.minGap}px`);

// ---- Baseline (dispatch-level) ----
check("baseline: 2 abilities", sectionKids(abilitiesNodeId) === 2, `total=${sectionKids(abilitiesNodeId)}`);
check("baseline: 3 effects", sectionKids(effectsNodeId) === 3, `total=${sectionKids(effectsNodeId)}`);

// ---- Abilities & Effects tree tab ----
await clickTab("Abilities & Effects");
await page.waitForSelector(".eff-tree .eff-tree-vrow", { timeout: 5000 });
await page.waitForTimeout(200);

const treeTabText = (
    (await page.locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]').textContent()) ?? ""
).trim();
check("tab: tree tab shows combined abilities/effects count (2/3)", treeTabText.includes("2/3"), treeTabText);

// Flat virtualized rows (header rows + effect rows in document order) - reconstruct groups by walking them.
const treeShape = await page.evaluate(() => {
    const groups: { head: string; level: string; effects: string[] }[] = [];
    let cur: (typeof groups)[number] | undefined;
    for (const r of Array.from(document.querySelectorAll(".eff-tree-vrow"))) {
        const head = r.querySelector(".eff-tree-head");
        const effLabel = r.querySelector(".eff-tree-effect-label");
        if (head) {
            cur = {
                head: (head.querySelector(".eff-tree-head-label")?.textContent ?? "").trim(),
                level: (head.querySelector(".eff-tree-level")?.textContent ?? "").trim(),
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
    "tree: Global (Casting) + per-ability groups render with nested effects",
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
check(
    "tree: SPL ability rows show the Level Required badge (L1 / L5)",
    treeShape.groups.find((g) => g.head === "Ability 1")?.level === "L1" &&
        treeShape.groups.find((g) => g.head === "Ability 2")?.level === "L5",
    JSON.stringify(treeShape.groups.map((g) => ({ h: g.head, lvl: g.level }))),
);

// Selecting an effect renders the shared feature-block fragment.
await page.locator(".eff-tree-effect").first().click();
await page.locator(".eff-tree .detail .layout-root .field").first().waitFor({ timeout: 3000 });
const effDetail = await page.evaluate(() => ({
    fields: document.querySelectorAll(".eff-tree .detail .layout-root .field").length,
    combobox: document.querySelectorAll(".eff-tree .detail .bb-combobox-input").length,
    panelTitles: document.querySelectorAll(".eff-tree .detail .layout-root .panel > h3").length,
}));
check(
    "tree: SPL effect detail renders the shared feature-block fragment (wire order, no semantic panel titles)",
    effDetail.fields > 10 && effDetail.panelTitles === 0,
    `fields=${effDetail.fields} panelTitles=${effDetail.panelTitles}`,
);
check("tree: opcode detail field is a searchable combobox", effDetail.combobox >= 1, `count=${effDetail.combobox}`);

// Selecting an ability header renders the shared SPL ability panels.
await page.locator(".eff-tree-head-label", { hasText: "Ability 1" }).first().click();
await page.locator(".eff-tree .detail .layout-root .field").first().waitFor({ timeout: 3000 });
const abilityPanels = (await page.locator(".eff-tree .detail .layout-root .panel h3").allInnerTexts()).map((t) =>
    t.toUpperCase(),
);
check(
    "tree: SPL ability detail renders the shared panels (Ability/Casting/Projectile/Appearance)",
    ["ABILITY", "CASTING", "PROJECTILE", "APPEARANCE"].every((p) => abilityPanels.includes(p)),
    JSON.stringify(abilityPanels),
);
const abilityText = await page.locator(".eff-tree .detail .layout-root").first().innerText();
check(
    "tree: reserved (unused) and serializer-managed pointers omitted from the ability detail",
    !abilityText.includes("Unused") && !abilityText.includes("Feature Blocks"),
    `hasUnused=${abilityText.includes("Unused")} hasFeatureBlocks=${abilityText.includes("Feature Blocks")}`,
);
await page.screenshot({ path: shotPath("shot-spl-tree.png"), fullPage: true });

// ---- Regression: casting-free SPL remove-first-effect (dispatch-level) ----
{
    const regrDoc = {
        ...baseDoc,
        header: { ...baseDoc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
        abilities: [{ ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 }],
        effects: [mkEffect(99)],
    };
    const regrBytes = serializeSplCanonicalDocument(regrDoc);
    const regrR = dispatch({ type: "open", uri: "file:///spl-regr.spl", bytes: regrBytes });
    if (regrR.type !== "opened") {
        check("regression: casting-free spl open succeeded", false, `type=${regrR.type}`);
    } else {
        const regrSession = regrR.result.sessionId;
        const regrKids = dispatch({ type: "getChildren", sessionId: regrSession, nodeId: null, start: 0, end: 50 });
        const regrEffectsNodeId =
            regrKids.type === "children" ? (regrKids.rows.find((r) => r.name === "Effects")?.id ?? "") : "";
        const before = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: casting-free spl has 1 effect",
            (before.type === "children" ? before.total : -1) === 1,
            `count=${before.type === "children" ? before.total : -1}`,
        );
        const firstEffectId = before.type === "children" ? (before.rows[0]?.id ?? "") : "";
        const removeR = dispatch({
            type: "structureOp",
            sessionId: regrSession,
            op: { op: "remove", entryId: firstEffectId },
        });
        check("regression: remove-first-effect did not error", removeR.type !== "error", `type=${removeR.type}`);
        const after = dispatch({
            type: "getChildren",
            sessionId: regrSession,
            nodeId: regrEffectsNodeId,
            start: 0,
            end: 10,
        });
        check(
            "regression: effect count dropped to 0",
            (after.type === "children" ? after.total : -1) === 0,
            `count=${after.type === "children" ? after.total : -1}`,
        );
    }
}

await browser.close();

console.log("\n=== SPL layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL SPL ASSERTIONS PASS" : `\n${failed} SPL ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
