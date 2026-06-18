/**
 * Cross-format value-control clipping sweep.
 *
 * Opens every binary format in the REAL webview bundle and walks each primary tab (and, where a list section
 * is present, selects its first entry to render the detail form), running the shared clip gate
 * (`clip-gate.ts`) on each view. The gate flags any value control whose box clips its text and any dropdown
 * rendered without a `dd-*` width class. This is the sweeping check for the whole clipping class - the
 * per-format render-*.mts drivers verify their own format in depth; this one verifies the ONE invariant
 * "no value control clips" across all of them, so a new clip anywhere is caught in one place.
 *
 * Format coverage is gated on fixture presence: the IE formats (CRE/ITM/SPL/EFF) live under the gitignored
 * `external/` corpus and are skipped (with a logged SKIP) when absent, exactly like the binary external-corpus
 * tests; PRO and MAP use committed `client/testFixture/` fixtures and always run.
 *
 * Run: pnpm exec tsx binary-editor/test/harness/render-clip-sweep.mts
 * Exits non-zero (listing every offending control) if anything clips; prints "CLIP: no ..." otherwise.
 */
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { collectClipViolations, reportClipViolations, type ClipViolation } from "./clip-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "../../..");

// label -> fixture. IE formats are external (skipped when absent); PRO/MAP are committed.
const FORMATS: { label: string; uri: string; file: string }[] = [
    { label: "CRE", uri: "file:///sweep.cre", file: "external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre" },
    {
        label: "ITM",
        uri: "file:///sweep.itm",
        file: "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm",
    },
    {
        label: "SPL",
        uri: "file:///sweep.spl",
        file: "external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl",
    },
    {
        label: "EFF",
        uri: "file:///sweep.eff",
        file: "external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff",
    },
    { label: "PRO", uri: "file:///sweep.pro", file: "client/testFixture/proto/critters/00000051.pro" },
    { label: "PRO-item", uri: "file:///sweep-item.pro", file: "client/testFixture/proto/items/00000031.pro" },
    { label: "MAP", uri: "file:///sweep.map", file: "client/testFixture/maps/arcaves.map" },
];

/** Drive one format through the webview and collect clip violations across its tabs. */
async function runFormat(browser: Browser, label: string, uri: string, bytes: Uint8Array): Promise<ClipViolation[]> {
    const page: Page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

    // Generic host wiring: the same synchronous dispatch path the VSCode worker uses, format-agnostic - it
    // routes by the layout the opened file produces, so one closure serves every format (mirrors render-cre).
    let sessionId = "";
    const hostUp = (m: WebviewToHost): HostToWebview[] => {
        if (m.type === "ready") {
            const r = dispatch({ type: "open", uri, bytes });
            if (r.type !== "opened") return [];
            sessionId = r.result.sessionId;
            return [{ type: "init", open: r.result }];
        }
        if (m.type === "requestChildren") {
            const r = dispatch({ type: "getChildren", sessionId, nodeId: m.nodeId, start: m.start, end: m.end });
            return r.type === "children"
                ? [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }]
                : [];
        }
        if (m.type === "requestSpellbook") {
            const r = dispatch({ type: "getSpellbook", sessionId });
            return r.type === "spellbook" ? [{ type: "spellbook", requestId: m.requestId, view: r.view }] : [];
        }
        if (m.type === "spellbookEdit") {
            const r = dispatch({ type: "spellbookEdit", sessionId, op: m.op });
            return r.type === "structure"
                ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }]
                : [];
        }
        if (m.type === "editField") {
            const r = dispatch({ type: "editField", sessionId, nodeId: m.nodeId, value: m.value });
            return r.type === "edited"
                ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }]
                : [];
        }
        if (m.type === "structureOp") {
            const r = dispatch({ type: "structureOp", sessionId, op: m.op });
            return r.type === "structure"
                ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }]
                : [];
        }
        return [];
    };

    await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
        for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
    });
    await page.goto("file://" + path.join(here, "app.html"));
    await page.waitForSelector(".layout-root", { timeout: 5000 });
    await page.waitForTimeout(200);

    const found: ClipViolation[] = [];
    // Check whatever a freshly-opened detail/list selection renders too: select the first list row if one is
    // present, so detail forms get swept and not just the tab's own fields/grids.
    const sweepCurrentView = async (ctx: string): Promise<void> => {
        found.push(...(await collectClipViolations(page, ctx)));
        const firstRow = page.locator(".master .vlist .vrow").first();
        if (await firstRow.count()) {
            await firstRow.click().catch(() => undefined);
            await page.waitForTimeout(150);
            found.push(...(await collectClipViolations(page, ctx + " (detail)")));
        }
    };

    const tabs = page.locator('.bb-tabs.primary button[role="tab"]');
    const tabCount = await tabs.count();
    if (tabCount === 0) {
        await sweepCurrentView(label); // single-page format (PRO / EFF)
    } else {
        for (let i = 0; i < tabCount; i++) {
            const tab = tabs.nth(i);
            const name = ((await tab.textContent()) ?? `tab${i}`).replace(/\s*\(\d.*\)\s*$/, "").trim();
            await tab.click();
            await page.waitForTimeout(200);
            await sweepCurrentView(`${label} > ${name}`);
        }
    }

    await page.close();
    return found;
}

const browser = await chromium.launch({ headless: true });
const all: ClipViolation[] = [];
for (const fmt of FORMATS) {
    const abs = path.join(repo, fmt.file);
    if (!fs.existsSync(abs)) {
        console.log(`SKIP  ${fmt.label}  (fixture absent: ${fmt.file})`);
        continue;
    }
    const bytes = new Uint8Array(fs.readFileSync(abs));
    const v = await runFormat(browser, fmt.label, fmt.uri, bytes);
    console.log(`swept ${fmt.label}: ${v.length} violation(s)`);
    all.push(...v);
}
await browser.close();

reportClipViolations(all, "CLIP SWEEP");
