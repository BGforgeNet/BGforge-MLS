/**
 * PRO subtype layout harness pass.
 *
 * Every PRO object/sub type now has a declarative layout variant (critter is covered by render-pro). This
 * driver opens a representative proto of each remaining family (item weapon/drug/armor, scenery door, wall,
 * tile, misc) in the REAL webview bundle and, per fixture, asserts:
 *   - the layout resolves to the expected variant (no fallback to the legacy tabs path);
 *   - the dense page renders with no section tabs and a non-zero label/value gap (no overlap);
 *   - open -> serialize round-trips byte-identical (dispatch-level, DOM-independent).
 *
 * Fixtures: real Fallout 2 RP protos, one per variant family.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.join(here, "../../../external/fallout/Fallout2_Restoration_Project/data/proto");

const CASES: { variant: string; file: string }[] = [
    { variant: "item.weapon", file: "items/00000583.pro" },
    { variant: "item.drug", file: "items/00000311.pro" },
    { variant: "item.armor", file: "items/00000595.pro" },
    { variant: "scenery.door", file: "scenery/00002103.pro" },
    { variant: "wall", file: "walls/00001902.pro" },
    { variant: "tile", file: "tiles/00003744.pro" },
    { variant: "misc", file: "misc/00000009.pro" },
];

let currentBytes = new Uint8Array();
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///x.pro", bytes: currentBytes });
        return r.type === "opened" ? [{ type: "init", open: r.result }] : [];
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const assertPageClean = installPageGate(page, "PRO-subtypes");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

for (const c of CASES) {
    currentBytes = new Uint8Array(fs.readFileSync(path.join(PROTO, c.file)));

    // Dispatch-level: variant resolves + round-trip.
    const r = dispatch({ type: "open", uri: "file:///x.pro", bytes: currentBytes });
    if (r.type !== "opened") {
        check(`${c.variant}: open`, false, `type=${r.type}`);
        continue;
    }
    check(
        `${c.variant}: layout variant resolves`,
        r.result.layout.layout?.variantId === c.variant,
        `variantId=${r.result.layout.layout?.variantId}`,
    );
    const s = dispatch({ type: "serialize", sessionId: r.result.sessionId });
    const out = s.type === "serialized" ? s.bytes : new Uint8Array();
    const identical = out.length === currentBytes.length && out.every((b, i) => b === currentBytes[i]);
    check(`${c.variant}: round-trips byte-identical`, identical, `outLen=${out.length} srcLen=${currentBytes.length}`);

    // DOM: render the real webview, assert no tabs + positive label/value gap.
    await page.goto("file://" + path.join(here, "app.html"));
    await page.waitForSelector(".layout-root", { timeout: 5000 });
    await page
        .waitForFunction(() => document.querySelectorAll(".layout-root .panel").length >= 2, undefined, {
            timeout: 5000,
        })
        .catch(() => undefined);
    const dom = await page.evaluate(() => {
        const tabs = document.querySelectorAll(".bb-tabs").length;
        const panels = document.querySelectorAll(".layout-root .panel").length;
        let minGap = Infinity;
        for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
            const label = field.querySelector(".label");
            const control = field.querySelector(".field-control");
            if (!label || !control) continue;
            const gap = control.getBoundingClientRect().left - label.getBoundingClientRect().right;
            if (gap < minGap) minGap = gap;
        }
        return { tabs, panels, minGap };
    });
    check(`${c.variant}: no section tabs`, dom.tabs === 0, `tabs=${dom.tabs}`);
    check(`${c.variant}: panels render`, dom.panels >= 2, `panels=${dom.panels}`);
    check(`${c.variant}: label/value gap positive`, dom.minGap >= 4, `minGap=${dom.minGap}px`);

    // One screenshot per subtype (the single end-of-loop shot only captured the last case).
    await page.screenshot({ path: shotPath(`shot-pro-${c.variant.replace(".", "-")}.png`), fullPage: true });
}

await browser.close();

console.log("\n=== PRO subtype layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PRO SUBTYPE ASSERTIONS PASS" : `\n${failed} PRO SUBTYPE ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
