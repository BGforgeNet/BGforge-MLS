/**
 * PRO and EFF harness pass.
 *
 * Opens one Fallout PRO (item proto) and one Infinity Engine EFF in the real webview bundle (app.html).
 * Both are migrated to the declarative layout (PRO via its per-subtype item variant, EFF via the "effect"
 * variant) and render as a single dense page through LayoutRenderer - the legacy section-tabs path is gone.
 * EFF lays out its body fields in on-disk (wire) byte order as one untitled dense 2-column panel (flag boxes
 * for Save Type / Resistance inline at their byte position), with the ~300-entry opcode enum as a searchable
 * combobox. Both run under the strict nonce CSP.
 *
 * Assertions:
 *   - PRO (item): opens without error, resolves an `item.*` layout variant, fields render via .layout-root,
 *     and no section tabs appear.
 *   - EFF: opens without error, resolves the "effect" layout variant, renders as one untitled byte-order panel
 *     (no semantic panel titles), opcode renders as a searchable combobox, and no section tabs appear.
 *   - CSP: no Content-Security-Policy violations in either page.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { WebviewToHost, HostToWebview } from "../../../client/src/binary-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const PRO_FIXTURE = path.join(repo, "client/testFixture/proto/items/00000031.pro");
const EFF_FIXTURE = path.join(repo, "external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff");

const proBytes = new Uint8Array(fs.readFileSync(PRO_FIXTURE));
const effBytes = new Uint8Array(fs.readFileSync(EFF_FIXTURE));

// ---- Verify parsers can open both formats before launching the browser ----
const proOpen = dispatch({ type: "open", uri: "file:///00000031.pro", bytes: proBytes });
if (proOpen.type !== "opened" || proOpen.result.errors.length > 0) {
    console.log("PRO open failed:", proOpen.type === "opened" ? proOpen.result.errors : proOpen);
    process.exit(1);
}
const effOpen = dispatch({ type: "open", uri: "file:///balth01b.eff", bytes: effBytes });
if (effOpen.type !== "opened" || effOpen.result.errors.length > 0) {
    console.log("EFF open failed:", effOpen.type === "opened" ? effOpen.result.errors : effOpen);
    process.exit(1);
}

// Store open results for hostUp callbacks.
let currentOpenResult = proOpen.result;

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        return [{ type: "init", open: currentOpenResult }];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({
            type: "getChildren",
            sessionId: currentOpenResult.sessionId,
            nodeId: m.nodeId,
            start: m.start,
            end: m.end,
        });
        if (r.type === "children") {
            return [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }];
        }
    }
    if (m.type === "editField") {
        const r = dispatch({
            type: "editField",
            sessionId: currentOpenResult.sessionId,
            nodeId: m.nodeId,
            value: m.value,
        });
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const assertPageClean = installPageGate(page, "PRO+EFF");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

// ---- PRO pass ----
currentOpenResult = proOpen.result;
await page.goto("file://" + path.join(here, "app.html"));
// PRO renders as a single dense page via the declarative layout (every object/sub type has a variant).
await page.waitForSelector(".layout-root", { timeout: 5000 });
await page
    .waitForFunction(() => document.querySelectorAll(".layout-root .field").length > 0, undefined, { timeout: 5000 })
    .catch(() => undefined);

check(
    "pro: resolves an item layout variant",
    proOpen.result.layout.layout?.variantId?.startsWith("item.") === true,
    `variantId=${proOpen.result.layout.layout?.variantId}`,
);
const proDom = await page.evaluate(() => ({
    fields: document.querySelectorAll(".layout-root .field").length,
    tabs: document.querySelectorAll(".bb-tabs").length,
}));
check("pro: layout fields render (> 0)", proDom.fields > 0, `count=${proDom.fields}`);
check("pro: no section tabs (single page)", proDom.tabs === 0, `count=${proDom.tabs}`);

await page.screenshot({ path: shotPath("shot-pro.png") });

// ---- Numeric range advisory: PRO header "Light Radius" (domain-narrowed to 0-8, below uint32's own
// 0-4294967295 - binary/src/pro/specs/header.ts) surfaces its resolved bounds as input min/max plus an
// "Allowed range" title on the control itself (in NumberField, the shared numeric control, so every block
// renderer gets it). An out-of-range value is flagged by the native :out-of-range styling + aria-invalid,
// value-derived so it warns while typing AND persists once the value commits - never a transient advisory. ----
const rangeAttrs = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const field = fields.find((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const input = field?.querySelector(".field-control input[type='number']");
    return {
        found: field !== undefined,
        min: input?.getAttribute("min"),
        max: input?.getAttribute("max"),
        title: input?.getAttribute("title"),
        ariaInvalid: input?.getAttribute("aria-invalid"),
    };
});
check("pro: Light Radius field is present", rangeAttrs.found, JSON.stringify(rangeAttrs));
check(
    "pro: Light Radius input carries the domain-narrowed min/max attributes",
    rangeAttrs.min === "0" && rangeAttrs.max === "8",
    `min=${rangeAttrs.min} max=${rangeAttrs.max}`,
);
check(
    "pro: Light Radius control title states the allowed range",
    (rangeAttrs.title ?? "").includes("0 to 8"),
    `title=${rangeAttrs.title}`,
);
check(
    "pro: an in-range Light Radius is not flagged (aria-invalid absent)",
    rangeAttrs.ariaInvalid === null,
    `aria-invalid=${rangeAttrs.ariaInvalid}`,
);

// Baseline geometry of the Light Radius field and its next sibling, to prove the out-of-range indication
// (border-color + background only) never reflows the layout. Inlined (not a shared Node function) so tsx's
// name-keeping wrapper is not injected into the serialized browser closure.
const beforeRects = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const idx = fields.findIndex((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const s = fields[idx]?.getBoundingClientRect();
    const n = fields[idx + 1]?.getBoundingClientRect();
    return {
        self: s ? [Math.round(s.x), Math.round(s.y), Math.round(s.width), Math.round(s.height)] : null,
        next: n ? [Math.round(n.x), Math.round(n.y), Math.round(n.width), Math.round(n.height)] : null,
    };
});

// While typing (value set, not yet committed): the native :out-of-range styling flags it live.
const typing = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const field = fields.find((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const input = field?.querySelector("input[type='number']") as HTMLInputElement | null;
    if (!input) return { outOfRange: false };
    input.value = "20";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { outOfRange: input.matches(":out-of-range") };
});
check(
    "pro: an out-of-range Light Radius is flagged while typing (native :out-of-range)",
    typing.outOfRange,
    JSON.stringify(typing),
);

// Commit the out-of-range value (change -> host round trip stores it faithfully; no clamp/reject).
await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const field = fields.find((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const input = field?.querySelector("input[type='number']") as HTMLInputElement | null;
    input?.dispatchEvent(new Event("change", { bubbles: true }));
});
await page
    .waitForFunction(
        () => {
            const fields = Array.from(document.querySelectorAll(".layout-root .field"));
            const field = fields.find((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
            return field?.querySelector("input[type='number']")?.getAttribute("aria-invalid") === "true";
        },
        undefined,
        { timeout: 2000 },
    )
    .catch(() => undefined);
const committed = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const field = fields.find((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const input = field?.querySelector("input[type='number']") as HTMLInputElement | null;
    return {
        value: input?.value,
        ariaInvalid: input?.getAttribute("aria-invalid"),
        outOfRange: input ? input.matches(":out-of-range") : false,
    };
});
check(
    "pro: a committed out-of-range Light Radius stays flagged (value-derived, persists after blur)",
    committed.value === "20" && committed.ariaInvalid === "true" && committed.outOfRange === true,
    JSON.stringify(committed),
);
const afterRects = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".layout-root .field"));
    const idx = fields.findIndex((f) => f.querySelector(".label")?.textContent?.trim() === "Light Radius");
    const s = fields[idx]?.getBoundingClientRect();
    const n = fields[idx + 1]?.getBoundingClientRect();
    return {
        self: s ? [Math.round(s.x), Math.round(s.y), Math.round(s.width), Math.round(s.height)] : null,
        next: n ? [Math.round(n.x), Math.round(n.y), Math.round(n.width), Math.round(n.height)] : null,
    };
});
check(
    "pro: the out-of-range indication does not reflow the layout",
    JSON.stringify(beforeRects) === JSON.stringify(afterRects),
    `before=${JSON.stringify(beforeRects)} after=${JSON.stringify(afterRects)}`,
);

await page.screenshot({ path: shotPath("shot-pro-range-error.png") });

// ---- EFF pass: reload the same page with a fresh hostUp binding pointing at effOpen ----
// We need to rebind __hostUp before navigating. The easiest way in Playwright is to expose a new page,
// but exposeFunction can only be called once per name. Instead, post the new open result via a fresh
// page load (the page re-registers __hostUp from scratch on navigation).
//
// We create a second page so the first page's exposeFunction binding does not interfere.
const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const assertPageClean2 = installPageGate(page2, "EFF");
currentOpenResult = effOpen.result;

await page2.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page2.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page2.goto("file://" + path.join(here, "app.html"));
await page2.waitForSelector(".layout-root", { timeout: 5000 });
await page2
    .waitForFunction(() => document.querySelectorAll(".layout-root .field").length > 20, undefined, { timeout: 5000 })
    .catch(() => undefined);

check(
    "eff: resolves the 'effect' layout variant",
    effOpen.result.layout.layout?.variantId === "effect",
    `variantId=${effOpen.result.layout.layout?.variantId}`,
);
const effDom = await page2.evaluate(() => ({
    panels: Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent),
    fields: document.querySelectorAll(".layout-root .field").length,
    combobox: document.querySelectorAll(".layout-root .bb-combobox-input").length,
    chevrons: document.querySelectorAll(".layout-root .bb-combobox-trigger").length,
    selects: document.querySelectorAll(".layout-root .bb-select-trigger").length,
    flagCols: document.querySelectorAll(".layout-root .flag-columns").length,
    tabs: document.querySelectorAll(".bb-tabs").length,
}));
check(
    "eff: renders as one untitled wire-byte-order panel (no semantic panel titles)",
    effDom.panels.length === 0,
    JSON.stringify(effDom.panels),
);
check("eff: layout fields render (> 20)", effDom.fields > 20, `count=${effDom.fields}`);
// Every enum is a searchable combobox now (opcode + the small enums target/timing/school/...), each with a
// chevron, and the old Select primitive is gone.
check(
    "eff: enums render as searchable comboboxes (opcode + small enums)",
    effDom.combobox >= 4,
    `count=${effDom.combobox}`,
);
check(
    "eff: every combobox has a chevron trigger",
    effDom.chevrons === effDom.combobox,
    `chevrons=${effDom.chevrons} combobox=${effDom.combobox}`,
);
check("eff: no plain Select remains", effDom.selects === 0, `count=${effDom.selects}`);
check("eff: flags render (saveType + resistance)", effDom.flagCols >= 2, `count=${effDom.flagCols}`);
check("eff: no section tabs (single page)", effDom.tabs === 0, `count=${effDom.tabs}`);

await page2.screenshot({ path: shotPath("shot-eff.png") });

await browser.close();

console.log("\n=== PRO+EFF harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PRO+EFF ASSERTIONS PASS" : `\n${failed} PRO+EFF ASSERTIONS FAILED`);
assertPageClean();
assertPageClean2();
if (failed > 0) process.exit(1);
