/**
 * Reproduction: a script -> object jump whose target object sits DEEP in the list (index > the master list's
 * bounded selection-resolution window). The object list has thousands of entries; if the jump target is beyond
 * the window, the selection must still resolve to it - not silently fall back to the first object.
 *
 * Uses denbus1, whose Elevation 0 has dozens of script-linked objects beyond the window (the first near index
 * 900, the deepest near 3800). Drives the real webview: open the linked script, click its SID jump chip, and
 * assert the landed object's SID equals the script's sid (i.e. it landed on the actual target, not object 0).
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFileDerivedParseOptions, mapParser } from "@bgforge/binary";
import { buildModel } from "../../src/model";
import { dispatch } from "../../src/index";
import type { FlatNode } from "../../src/model";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/denbus1.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));
const parseOptions = buildFileDerivedParseOptions(FIXTURE);

// --- Find a deep script -> object pair from the model. ---
const model = buildModel(mapParser.parse(mapBytes, parseOptions));
function childSid(entry: FlatNode): number | undefined {
    for (const i of model.childrenByParent.get(entry.id) ?? []) {
        const c = model.nodes[i]!;
        if (c.kind === "field" && c.name === "SID") {
            const f = c.source as { value: unknown; rawValue?: number };
            const v = typeof f.value === "number" ? f.value : f.rawValue;
            return typeof v === "number" ? v : undefined;
        }
    }
    return undefined;
}
const scriptBySid = new Map<number, { type: string; label: string }>();
for (const sIdx of model.childrenByParent.get("") ?? []) {
    const sec = model.nodes[sIdx]!;
    if (sec.kind !== "group" || !sec.name.endsWith("Scripts")) continue;
    for (const eIdx of model.childrenByParent.get(sec.id) ?? []) {
        const e = model.nodes[eIdx]!;
        const sid = childSid(e);
        if (sid !== undefined && !scriptBySid.has(sid)) {
            scriptBySid.set(sid, { type: sec.name.replace(/ Scripts$/, ""), label: e.name });
        }
    }
}
let deep: { scriptType: string; scriptLabel: string; objSid: number; objIndex: number; elevation: string } | undefined;
const DEEP_THRESHOLD = 256;
for (const sIdx of model.childrenByParent.get("") ?? []) {
    const sec = model.nodes[sIdx]!;
    if (sec.kind !== "group" || !sec.name.endsWith("Objects")) continue;
    const objects = (model.childrenByParent.get(sec.id) ?? [])
        .map((i) => model.nodes[i]!)
        .filter((n) => n.kind === "group");
    objects.forEach((o, idx) => {
        if (deep || idx <= DEEP_THRESHOLD) return;
        const sid = childSid(o);
        const script = sid !== undefined && sid !== -1 ? scriptBySid.get(sid) : undefined;
        if (script)
            deep = {
                scriptType: script.type,
                scriptLabel: script.label,
                objSid: sid!,
                objIndex: idx,
                elevation: sec.name,
            };
    });
    if (deep) break;
}
if (!deep) throw new Error("no deep script-linked object found in fixture");
const objSidHex = (deep.objSid >>> 0).toString(16).padStart(8, "0");
console.log(`deep target: ${deep.scriptLabel} -> ${deep.elevation} object idx ${deep.objIndex} (SID 0x${objSidHex})`);

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///denbus1.map", bytes: mapBytes, options: parseOptions });
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
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const assertPageClean = installPageGate(page, "MAP-jump-deep");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });

const activePrimaryTab = () =>
    page.locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]').first().innerText();
const fieldHex = (label: string) =>
    page.evaluate((lbl) => {
        const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
            (f) => f.querySelector(".label")?.textContent?.trim() === lbl,
        );
        const input = field?.querySelector(".hex-input input") as HTMLInputElement | null;
        return input ? input.value : null;
    }, label);

// Open the linked script: Scripts tab -> its type subtab -> filter to its exact label -> click it.
await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: "Scripts" }).first().click();
await page.locator('.layout-root .bb-tabs button[role="tab"]').filter({ hasText: deep.scriptType }).first().click();
await page.locator(".layout-root .list-filter-input").first().fill(deep.scriptLabel);
await page.locator(".layout-root .vlist .vrow").filter({ hasText: deep.scriptLabel }).first().click();
await page
    .waitForFunction(
        () => {
            const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
                (f) => f.querySelector(".label")?.textContent?.trim() === "SID",
            );
            return field !== undefined && field.querySelector(".jump-link") !== null;
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);

const sidChip = page
    .locator(".layout-root .field")
    .filter({ has: page.locator('.label:text-is("SID")') })
    .first()
    .locator(".jump-link");
check("the deep-linked script exposes a SID jump chip", (await sidChip.count()) > 0, deep.scriptLabel);
await sidChip.first().click();

// A deep jump is two async round-trips: locateEntry fetches the full object list to resolve the selection
// (the target sits past the bounded window), THEN the detail pane fetches and renders the landed object's
// fields. Poll for the object's SID field to render rather than racing a fixed sleep - the old 300ms sleep
// read the still-empty detail pane and saw null even though the jump had landed correctly.
await page
    .waitForFunction(
        () => {
            const field = Array.from(document.querySelectorAll(".layout-root .field")).find(
                (f) => f.querySelector(".label")?.textContent?.trim() === "SID",
            );
            // Absent field -> false, never a throw: the empty pane IS the state being polled through, and a
            // throwing predicate rejects the wait outright (swallowed below), leaving the checks unguarded.
            const input = field?.querySelector<HTMLInputElement>(".hex-input input");
            return (input?.value.length ?? 0) > 0;
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined); // let the assertions below report the concrete failure rather than a poll timeout

const tabAfter = (await activePrimaryTab()).trim();
check("jump switches to the Objects tab", tabAfter.startsWith("Objects"), `active="${tabAfter}"`);

const landedSid = await fieldHex("SID");
check(
    "the jump lands on the deep target object (object SID == script SID), not the first object",
    landedSid !== null && (parseInt(landedSid, 16) | 0) === (deep.objSid | 0),
    `landed=0x${landedSid} expected=0x${objSidHex} targetIdx=${deep.objIndex}`,
);
await page.screenshot({ path: shotPath("shot-map-jump-deep.png"), fullPage: true });

await browser.close();
console.log("\n=== MAP deep-jump harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL DEEP-JUMP ASSERTIONS PASS" : `\n${failed} DEEP-JUMP ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
