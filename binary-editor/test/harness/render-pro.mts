/**
 * PRO critter layout harness pass.
 *
 * Opens a real Fallout critter .pro in the production webview bundle and asserts it renders via the
 * NEW declarative single-page layout (LayoutRenderer) rather than the legacy section tabs: a Header
 * panel with two flag-checkbox columns, Demographics + Final panels, a Stats matrix (Primary /
 * Secondary / Dmg Threshold / Dmg Resist, each Base|Bonus), and a 4-column Skills grid - with NO
 * section tabs. Screenshots at a realistic VS Code editor-pane size (1400x860) for visual review
 * against the approved mockup (plan section 2.1). CSP gate must stay clean.
 *
 * Run: pnpm exec tsx binary-editor/test/harness/render-pro.mts  (after `cd binary && pnpm build` and build.mts)
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { WebviewToHost, HostToWebview } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const CRITTER_FIXTURE = path.join(repo, "client/testFixture/proto/critters/00000051.pro");

const bytes = new Uint8Array(fs.readFileSync(CRITTER_FIXTURE));
const open = dispatch({ type: "open", uri: "file:///00000051.pro", bytes });
if (open.type !== "opened" || open.result.errors.length > 0) {
    console.log("critter open failed:", open.type === "opened" ? open.result.errors : open);
    process.exit(1);
}
const result = open.result;

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") return [{ type: "init", open: result }];
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2 });
const assertNoCsp = installCspGate(page, "PRO-critter");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root", { timeout: 5000 });
await page.waitForTimeout(250);

check(
    "critter resolves a declarative layout (variant critter)",
    result.layout.layout?.variantId === "critter",
    `variantId=${result.layout.layout?.variantId}`,
);
const dom = await page.evaluate(() => ({
    panelTitles: Array.from(document.querySelectorAll(".layout-root .panel > h3"), (e) => e.textContent),
    matrixGroups: document.querySelectorAll(".matrix .mcol").length,
    skills: document.querySelectorAll(".grid .skill").length,
    flagCols: document.querySelectorAll(".flag-columns .gcol").length,
    flagTooltips: document.querySelectorAll(".flag-columns label[title]").length,
    tabs: document.querySelectorAll(".bb-tabs").length,
    controls: document.querySelectorAll(
        ".layout-root input, .layout-root [role='combobox'], .layout-root [role='checkbox']",
    ).length,
}));
check(
    "panels are Header / Demographics / Final / Stats / Skills",
    JSON.stringify(dom.panelTitles) === JSON.stringify(["Header", "Demographics", "Final", "Stats", "Skills"]),
    JSON.stringify(dom.panelTitles),
);
check("Stats matrix has 4 column groups", dom.matrixGroups === 4, `count=${dom.matrixGroups}`);
check("Skills grid has 18 entries", dom.skills === 18, `count=${dom.skills}`);
check("Header flags render as 2 columns", dom.flagCols === 2, `count=${dom.flagCols}`);
check("all 11 critter flags carry a tooltip", dom.flagTooltips === 11, `count=${dom.flagTooltips}`);
check("no section tabs (single page)", dom.tabs === 0, `count=${dom.tabs}`);
check("editable controls render (> 80)", dom.controls > 80, `count=${dom.controls}`);

// Reactivity regression: the host snapshots the resolved layout fields at init, so the App's changeSet
// handler must patch that snapshot for an edit to re-render. Simulate the host posting a changeSet for
// one field with a new value and assert the rendered control reflects it (the "editing a value / dropdown
// does not update the page" bug). aiPacket is a plain number field in the Header panel.
const fields = result.layout.layout?.fields ?? {};
const target = fields["pro.critter.aiPacket"];
if (!target) {
    check("reactivity: aiPacket field resolved", false, "missing pro.critter.aiPacket");
} else {
    const NEW_VALUE = "31337";
    const valuesBefore = await page.$$eval(".layout-root input", (els) =>
        els.map((e) => (e as HTMLInputElement).value),
    );
    await page.evaluate(
        ({ row, v }) =>
            window.postMessage(
                {
                    type: "changeSet",
                    changeSet: {
                        changed: [{ ...row, rawValue: Number(v), displayValue: v }],
                        diagnostics: [],
                        dirty: true,
                        formatValid: true,
                    },
                },
                "*",
            ),
        { row: target, v: NEW_VALUE },
    );
    await page.waitForTimeout(150);
    const valuesAfter = await page.$$eval(".layout-root input", (els) => els.map((e) => (e as HTMLInputElement).value));
    check(
        "reactivity: a changeSet edit re-renders the control",
        !valuesBefore.includes(NEW_VALUE) && valuesAfter.includes(NEW_VALUE),
        `before-has=${valuesBefore.includes(NEW_VALUE)} after-has=${valuesAfter.includes(NEW_VALUE)}`,
    );
}

await page.screenshot({ path: path.join(here, "shot-pro-critter.png") });
await browser.close();

console.log("\n=== PRO critter harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL PRO CRITTER ASSERTIONS PASS" : `\n${failed} PRO CRITTER ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
