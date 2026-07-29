/**
 * Resref resource-picker harness pass.
 *
 * A resref field renders as a searchable picker only when the record was opened from an installed game, so this
 * driver plays a host that HAS one: it runs outgoing messages through the real `withGameContext` (the same
 * stamping the extension does) with a synthetic game, and answers `requestResourceList` from a synthetic index.
 * The other drivers deliberately have no game, so this is the only pass that renders the control at all.
 *
 * What it pins:
 *   - a resref field becomes a combobox with a game, and stays a plain text input without one;
 *   - the list loads on FIRST OPEN, not on mount, and is fetched once per type however many fields share it;
 *   - the rendered-option cap reports its overflow rather than silently dropping it, and typing narrows;
 *   - a typed name the install does NOT have still commits - the picker is open-ended, which is the whole
 *     contract (a mod names what a later install step creates).
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { withGameContext } from "../../../client/src/binary-editor/game-rows";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const itmBytes = new Uint8Array(fs.readFileSync(FIXTURE));

/** The one BAM the synthetic install actually has, so exactly one field also gets the open affordance. */
const PRESENT_BAM = "ISW1H01";
/** More BAMs than the combobox renders (cap 200), so the overflow notice is exercised - a real BG:EE has ~12300. */
const BAM_INDEX = [PRESENT_BAM, ...Array.from({ length: 260 }, (_, i) => `BAM${String(i).padStart(4, "0")}`)].sort();

/** A game that resolves every declared type and holds only PRESENT_BAM. */
const lookups = {
    strref: () => undefined,
    slotLabel: () => undefined,
    namingTable: () => undefined,
    resourceType: (decl: { type: string }, resref: string) => ({
        type: decl.type,
        present: decl.type === "BAM" && resref === PRESENT_BAM,
    }),
};

let sessionId = "";
const listRequests: string[] = [];
const edits: (number | string)[] = [];

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///picker.itm", bytes: itmBytes });
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
    if (m.type === "requestResourceList") {
        listRequests.push(m.ext);
        return [
            {
                type: "resourceList",
                requestId: m.requestId,
                resrefs: m.ext.toLowerCase() === "bam" ? BAM_INDEX : [],
            },
        ];
    }
    if (m.type === "editField") {
        edits.push(m.value);
        const r = dispatch({ type: "editField", sessionId, nodeId: m.nodeId, value: m.value });
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

/** Every resref field's rendered shape, keyed by its label. */
async function pickers(page: Page): Promise<Record<string, { combobox: boolean; width: string; chip: boolean }>> {
    return page.evaluate(() => {
        const out: Record<string, { combobox: boolean; width: string; chip: boolean }> = {};
        for (const field of Array.from(document.querySelectorAll(".layout-root .field"))) {
            const label = (field.querySelector(".label")?.textContent ?? "").trim();
            const control = field.querySelector(".field-control");
            if (!label || !control) continue;
            if (!/icon|replacement/i.test(label)) continue;
            out[label] = {
                combobox: control.querySelector(".bb-combobox-input") !== null,
                width: Array.from(control.classList).find((c) => c.startsWith("dd-") || c.startsWith("tier-")) ?? "?",
                chip: field.querySelector(".jump-link") !== null,
            };
        }
        return out;
    });
}

// ---- Without a game: the same fields must stay plain text boxes ----
const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "resource picker");

let gameOpen = false;
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) {
        const resolved = gameOpen ? withGameContext(reply, lookups) : reply;
        await page.evaluate((rr) => window.postMessage(rr, "*"), resolved);
    }
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .panel h3", { timeout: 5000 });

const noGame = await pickers(page);
check(
    "no game: every resref field stays a plain text input",
    Object.keys(noGame).length > 0 && Object.values(noGame).every((f) => !f.combobox),
    JSON.stringify(noGame),
);

// ---- With a game: re-open the record so every row is stamped ----
gameOpen = true;
{
    const r = dispatch({ type: "open", uri: "file:///picker-game.itm", bytes: itmBytes });
    if (r.type !== "opened") throw new Error("re-open failed");
    sessionId = r.result.sessionId;
    await page.evaluate(
        (rr) => window.postMessage(rr, "*"),
        withGameContext({ type: "init", open: r.result } as HostToWebview, lookups),
    );
}
await page.waitForSelector(".layout-root .bb-combobox-input", { timeout: 5000 });

const withGame = await pickers(page);
const iconFields = Object.entries(withGame).filter(([label]) => /icon/i.test(label));
check(
    "game open: every resref field renders the searchable picker",
    iconFields.length >= 3 && iconFields.every(([, f]) => f.combobox),
    JSON.stringify(withGame),
);
check(
    "game open: a picker takes a dropdown width sized to the field's 8 chars (dd-2), not a text tier",
    iconFields.every(([, f]) => f.width === "dd-2"),
    JSON.stringify(iconFields.map(([l, f]) => `${l}=${f.width}`)),
);
// The fixture's own icons are not in this install, so nothing is openable yet while everything is pickable -
// the two affordances answer different questions. Proven the other way round after the edits below.
check(
    "game open: an unresolvable value is pickable but not openable",
    Object.values(withGame).every((f) => f.combobox && !f.chip),
    JSON.stringify(Object.entries(withGame).map(([l, f]) => `${l}: pick=${f.combobox} open=${f.chip}`)),
);

// ---- The list loads on first open, once per type ----
check("mount: no list is fetched before a picker is opened", listRequests.length === 0, JSON.stringify(listRequests));

const firstIcon = page.locator('.layout-root .bb-combobox-input[aria-label="Inventory Icon"]');

// The input shows the current value while idle, so a field the user only tabs through must not commit it back
// to itself - that reads as an edit downstream (dirty document, an undo slot) for a value nobody changed.
{
    const editsBefore = edits.length;
    await firstIcon.click();
    await page.waitForTimeout(300);
    await page.locator(".layout-root .panel h3").first().click();
    await page.waitForTimeout(500);
    check(
        "no-op: focusing and leaving a picker commits nothing",
        edits.length === editsBefore,
        `edits=${JSON.stringify(edits)}`,
    );
}
await firstIcon.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 5000 });
check("open: opening a picker fetches its type's list", listRequests.length === 1, JSON.stringify(listRequests));

const opened = await page.evaluate(() => ({
    items: document.querySelectorAll(".bb-combobox-item").length,
    more: (document.querySelector(".bb-combobox-more")?.textContent ?? "").trim(),
}));
check(
    "open: the rendered list is capped and says how many it left out",
    opened.items === 200 && opened.more === `${BAM_INDEX.length - 200} more - keep typing to narrow`,
    `items=${opened.items} more="${opened.more}"`,
);

// Typing narrows to the matches - the point of the cap notice, and the only way to reach a late entry.
await firstIcon.fill("");
await firstIcon.pressSequentially(PRESENT_BAM.slice(0, 4), { delay: 10 });
await page
    .waitForFunction(() => document.querySelectorAll(".bb-combobox-item").length === 1, undefined, { timeout: 5000 })
    .catch(() => undefined);
const filtered = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".bb-combobox-item"), (e) => (e.textContent ?? "").trim()),
);
check(
    "filter: typing narrows the list to the match",
    JSON.stringify(filtered) === `["${PRESENT_BAM}"]`,
    JSON.stringify(filtered),
);

// ---- Open-ended: a name the install does not have still commits ----
await firstIcon.fill("");
await firstIcon.pressSequentially("MODONLY", { delay: 10 });
await firstIcon.press("Enter");
await page.waitForTimeout(300);
const committed = await page.evaluate(() => {
    const input = document.querySelector(
        '.layout-root .bb-combobox-input[aria-label="Inventory Icon"]',
    ) as HTMLInputElement | null;
    return input?.value ?? "";
});
check("open-ended: a resref the install does not have commits anyway", committed === "MODONLY", `input="${committed}"`);
check(
    "open-ended: committing an unresolvable name adds no marker and no open chip",
    (await pickers(page))["Inventory Icon"]?.chip === false,
    JSON.stringify((await pickers(page))["Inventory Icon"]),
);

// The other direction: picking a name the install DOES have grows the open chip, so the affordance tracks the
// value rather than the field - which is what makes withholding it on the miss above a statement about presence.
await firstIcon.fill("");
await firstIcon.pressSequentially(PRESENT_BAM, { delay: 10 });
await firstIcon.press("Enter");
await page
    .waitForFunction(
        () => {
            const field = document
                .querySelector('.layout-root .bb-combobox-input[aria-label="Inventory Icon"]')
                ?.closest(".field");
            return field?.querySelector(".jump-link") !== null;
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
check(
    "presence: picking a resref the install has grows the open chip",
    (await pickers(page))["Inventory Icon"]?.chip === true,
    JSON.stringify((await pickers(page))["Inventory Icon"]),
);

// A second picker of the same type reuses the fetched list rather than asking again.
const secondIcon = page.locator('.layout-root .bb-combobox-input[aria-label="Ground Icon"]');
await secondIcon.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 5000 });
check(
    "cache: a second field of the same type reuses the list",
    listRequests.length === 1,
    JSON.stringify(listRequests),
);

await page.keyboard.press("Escape");
await page.screenshot({ path: shotPath("shot-resource-picker.png"), fullPage: true });

await browser.close();

console.log("\n=== resource picker harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL RESOURCE PICKER ASSERTIONS PASS" : `\n${failed} RESOURCE PICKER ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
