/**
 * CRE EFF v1 effect-detail harness pass.
 *
 * A CRE whose `effStructureVersion` is 0 embeds the older 48-byte EFF v1 effect record instead of the EFF v2
 * body. The CRE Effects list declares the v2 fragment as primary and the v1 fragment as a fallback; the detail
 * pane must render the FIRST whose refs resolve - so a v1 effect renders the v1 fragment (its byte-order fields
 * including the v1-only Timing Mode / Saving Throw), NOT the auto-form and NOT the v2 fragment. No v1 CRE exists in the
 * corpus (every vendored CRE is v2), so this synthesizes one through the real writer/parser round-trip, loads
 * it in the REAL webview bundle, selects an effect, and asserts the v1 fragment rendered.
 */

import { chromium, type Locator } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { creParser } from "../../../binary/src/cre/index";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../../../binary/src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../../../binary/src/cre/canonical-writer";
import { defaultCreEffectV1 } from "../../../binary/src/cre/entity-ops";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Synthesize a v1 CRE: take a real v2 CRE, flip effStructureVersion to 0 and swap in v1 effect records. ----
const FIXTURE = path.join(here, "../../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const baseParsed = creParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
if (baseParsed.errors) throw new Error("fixture parse errors: " + baseParsed.errors.join(", "));
const baseDoc = getCreCanonicalDocument(baseParsed) ?? rebuildCreCanonicalDocument(baseParsed);
if (!baseDoc) throw new Error("no canonical doc from fixture");
const v1Doc = {
    ...baseDoc,
    header: { ...baseDoc.header, effStructureVersion: 0 },
    effects: {
        kind: "v1" as const,
        records: [
            { ...defaultCreEffectV1(), opcode: 10 },
            { ...defaultCreEffectV1(), opcode: 25 },
        ],
    },
};
const creBytes = serializeCreCanonicalDocument(v1Doc);

let sessionId = "";

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///v1.cre", bytes: creBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
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
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Confirm the synthetic file actually parsed as v1 with effects (dispatch-level, DOM-independent). ----
{
    const r = dispatch({ type: "open", uri: "file:///v1-caps.cre", bytes: creBytes });
    if (r.type !== "opened") {
        check("setup: synthetic v1 CRE opened", false, `type=${r.type}`);
    } else {
        const effId = r.result.layout.layout?.sections["Effects"]?.nodeId ?? "";
        const kids = dispatch({ type: "getChildren", sessionId: r.result.sessionId, nodeId: effId, start: 0, end: 10 });
        check(
            "setup: synthetic v1 CRE has 2 effects",
            kids.type === "children" && kids.total === 2,
            `total=${kids.type === "children" ? kids.total : -1}`,
        );
    }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "CRE-v1");

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
const effectsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: /^Effects$/ }) });
async function selectRow(scope: Locator, idx: number): Promise<void> {
    await scope.locator(".vlist .vrow").nth(idx).click();
    await scope.locator(".row-actions").first().waitFor({ timeout: 3000 });
    await page.waitForTimeout(100);
}

await clickTab("Effects");
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });

// The shared v1 fragment renders through LayoutRenderer (`.detail .layout-root`), one untitled wire-byte-order
// panel: layout fields present, and no semantic panel `h3` titles. The v1-vs-v2 discrimination is asserted
// next (the v1-only Timing Mode / Saving Throw fields).
const v1Fields = await effectsPanel.locator(".detail .layout-root .field").count();
const v1PanelTitles = await effectsPanel.locator(".detail .layout-root .panel > h3").count();
check(
    "v1: CRE v1 effect detail renders the shared v1 fragment in wire byte order (no semantic panel titles)",
    v1Fields > 10 && v1PanelTitles === 0,
    `fields=${v1Fields} panelTitles=${v1PanelTitles}`,
);
const detailText = (await effectsPanel.locator(".detail .layout-root").first().innerText()).toLowerCase();
check(
    "v1: the v1-only Timing Mode / Saving Throw fields are shown (not the v2 fragment)",
    detailText.includes("timing mode") && detailText.includes("saving throw"),
    `hasTimingMode=${detailText.includes("timing mode")} hasSavingThrow=${detailText.includes("saving throw")}`,
);
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("v1: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

await page.screenshot({ path: path.join(here, "shot-cre-effects-v1.png"), fullPage: true });

await browser.close();

console.log("\n=== CRE v1 effect harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL CRE-v1 ASSERTIONS PASS" : `\n${failed} CRE-v1 ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
