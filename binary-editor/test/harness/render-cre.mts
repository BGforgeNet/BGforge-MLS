/**
 * CRE tabbed layout harness pass.
 *
 * CRE renders through the declarative layout as a tabbed editor (General / Combat / Inventory / Proficiencies /
 * Sounds / Spells / Effects). The header scalars are grouped into single-column titled boxes packed side by
 * side: the General tab carries Main / Identity / Scripting on its first row and Attributes / Thief Skills /
 * Extra Stats / Colors on its second, plus the creature-flag grid and a short trailing table; the Combat tab
 * carries Main (attack stats) / AC / Saving Throws / Resistances and the status-flag grid. The 40 equipped-item
 * slots render as a grid (Inventory), the 20 proficiency bytes as a matrix (Proficiencies), the 100 sound
 * strrefs as a grid (Sounds). The three spell tables (Known Spells, Spell Memorization Info, Memorized Spells)
 * render together through the unified `spellbook` block (spell-type subtabs over per-level cards) under the
 * Spells tab; Effects and Items render as master-detail `list` blocks under Effects / Inventory. This driver
 * opens a real BG2 mage CRE in the REAL webview bundle and:
 *   - asserts the layout resolves (variant "creature", sections map with correct caps, the top-level tab strip,
 *     the opcode renders as a searchable combobox in the effect detail, label/value spacing is non-zero in both
 *     the field boxes and the item-slots grid);
 *   - drives structure ops through the actual message path (webview posts -> hostUp -> dispatch -> changeSet):
 *     a spellbook "+ memorize" (and undo) on the Spells tab, and Effects insert/duplicate/remove/undo;
 *   - keeps a dispatch-level round-trip regression (open -> serialize -> byte-identical).
 *
 * Fixture: a real vendored CRE (edwin6 - a BG2 mage with known/memorized spells, effects, and items).
 */

import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";
import { creParser } from "../../../binary/src/cre/index";

const here = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE = path.join(here, "../../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const creBytes = new Uint8Array(fs.readFileSync(FIXTURE));
{
    const parsed = creParser.parse(creBytes);
    if (parsed.errors) throw new Error("fixture parse errors: " + parsed.errors.join(", "));
}

// ---- Session state shared between browser page and Node ----
let sessionId = "";
const sectionNodeId: Record<string, string> = {};
let activePage: Page | undefined;

function postToWebview(m: HostToWebview): void {
    if (activePage) activePage.evaluate((rr) => window.postMessage(rr, "*"), m).catch(() => undefined);
}

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///edwin6.cre", bytes: creBytes });
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
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
    }
    if (m.type === "structureOp") {
        const r = dispatch({ type: "structureOp", sessionId, op: m.op });
        if (r.type === "structure") {
            return [{ type: "changeSet", changeSet: r.result.changeSet, selection: r.result.selection }];
        }
        return [];
    }
    return [];
}

function sectionCount(nodeId: string): number {
    const r = dispatch({ type: "getChildren", sessionId, nodeId, start: 0, end: 400 });
    return r.type === "children" ? r.total : -1;
}

async function doUndo(): Promise<void> {
    // Mirror the real provider: undo returns a changeSet, posted so the webview refreshes fields/tab counts too.
    const r = dispatch({ type: "undo", sessionId });
    if (r.type === "structure") postToWebview({ type: "changeSet", changeSet: r.result.changeSet });
    else postToWebview({ type: "invalidated" });
    // The refresh touches several independent DOM regions (fields, tab badges, lists) with no single
    // DOM-observable completion signal generic across every call site - bounded settle, not a condition poll.
    await activePage?.waitForTimeout(150);
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

// ---- Browser setup ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
activePage = page;
const assertNoCsp = installCspGate(page, "CRE");

await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .bb-tabs", { timeout: 5000 });
await page.waitForSelector(".layout-root .panel h3", { timeout: 5000 });
// CRE is tabbed; capture the default (General) tab immediately so the screenshot exists regardless of
// the later structure-op steps (which navigate into the Spells / Effects tabs).
await page.screenshot({ path: shotPath("shot-cre.png"), fullPage: true });

// ---- Dropdown width guard (binary-editor UI guidelines: dropdowns are sized to their OWN longest option on a
// dedicated dd-{1..5} ch scale, decoupled from the text-input tiers - so a dropdown sharing a column with a
// hex/resref input is no longer dragged to that input's width). Asserted as the RELATIONSHIP between two
// dropdowns in the same Identity box rather than a tier constant: Race's identifiers are short and Alignment's
// are long, so a per-option width puts Race strictly narrower. Pinning a specific tier instead tied the guard
// to the label TEXT - it broke when the vendored tables moved to the game's verbatim identifiers ("Chaotic
// neutral" -> "CHAOTIC_NEUTRAL"), which is a legitimate relabel this guard should survive. Then drive Alignment
// to its longest option and assert the input shows it unclipped (scrollWidth <= clientWidth).
// Every enum is now a searchable combobox: the aria-label is on the input, the chevron opens the list. ----
{
    const ddWidths = await page.evaluate(() =>
        Object.fromEntries(
            Array.from(document.querySelectorAll(".field-control:has(.bb-combobox-input)")).map((el) => [
                el.querySelector(".bb-combobox-input")?.getAttribute("aria-label"),
                {
                    cls: el.className.replace("field-control", "").trim(),
                    w: Math.round(el.getBoundingClientRect().width),
                },
            ]),
        ),
    );
    const race = ddWidths["Race"];
    const alignment = ddWidths["Alignment"];
    const alignFc = page.locator('.field-control:has(.bb-combobox-input[aria-label="Alignment"])').first();
    check(
        "dropdown: same-box dropdowns size to their own longest option, not one shared width",
        race !== undefined &&
            alignment !== undefined &&
            /^dd-[1-5]$/.test(race.cls) &&
            /^dd-[1-5]$/.test(alignment.cls) &&
            race.w < alignment.w,
        JSON.stringify({ race, alignment }),
    );
    await alignFc.locator(".bb-combobox-input").click(); // focusing the input opens the list (chevron is decorative)
    await page
        .waitForFunction(() => document.querySelectorAll(".bb-popup-item").length > 0, undefined, { timeout: 5000 })
        .catch(() => undefined);
    // The OPEN list must render real items: a visible row height (a collapsed ~6px row clips the label) and a
    // non-empty label on every option, with an item highlighted (on open it is the current value's row; after a
    // filter bits-ui highlights the first match - covered by the primitives probe).
    const listInfo = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(".bb-popup-item")) as HTMLElement[];
        return {
            count: items.length,
            minH: items.length ? Math.min(...items.map((i) => Math.round(i.getBoundingClientRect().height))) : 0,
            allLabeled: items.every((i) => (i.textContent ?? "").trim().length > 0),
            anyHighlighted: items.some((i) => i.hasAttribute("data-highlighted")),
        };
    });
    check(
        "dropdown: open list renders labeled rows (visible height + text) with a highlighted item",
        listInfo.count > 0 && listInfo.minH >= 12 && listInfo.allLabeled && listInfo.anyHighlighted,
        JSON.stringify(listInfo),
    );
    await page.locator(".bb-popup-item", { hasText: "CHAOTIC_NEUTRAL" }).first().click();
    await page
        .waitForFunction(
            () => {
                const el = document.querySelector('.bb-combobox-input[aria-label="Alignment"]');
                return !!el && (el as HTMLInputElement).value.includes("CHAOTIC_NEUTRAL");
            },
            undefined,
            { timeout: 5000 },
        )
        .catch(() => undefined);
    const alignClip = await alignFc
        .locator(".bb-combobox-input")
        .evaluate((el: HTMLInputElement) => ({ text: el.value, clipped: el.scrollWidth > el.clientWidth + 1 }));
    check(
        "dropdown: longest Alignment option fits its combobox without clipping",
        !alignClip.clipped,
        JSON.stringify(alignClip),
    );
    // Re-picking the CURRENT value must keep it and close: bits-ui's single-select toggles the selection OFF on a
    // re-pick (value -> ""), which would blank an enum and leave the list open. "CHAOTIC_NEUTRAL" is selected now.
    await alignFc.locator(".bb-combobox-input").click();
    await page.locator(".bb-popup-item", { hasText: "CHAOTIC_NEUTRAL" }).first().click();
    await page
        .waitForFunction(
            () => {
                const el = document.querySelector('.bb-combobox-input[aria-label="Alignment"]');
                return (
                    !!el &&
                    (el as HTMLInputElement).value.includes("CHAOTIC_NEUTRAL") &&
                    document.querySelectorAll(".bb-combobox-content").length === 0
                );
            },
            undefined,
            { timeout: 5000 },
        )
        .catch(() => undefined);
    const rePick = await alignFc.locator(".bb-combobox-input").evaluate((el: HTMLInputElement) => el.value);
    const rePickOpen = await page.locator(".bb-combobox-content").count();
    check(
        "dropdown: re-picking the current value keeps it and closes (no single-select deselect)",
        rePick.includes("CHAOTIC_NEUTRAL") && rePickOpen === 0,
        JSON.stringify({ rePick, rePickOpen }),
    );
}

async function clickTab(label: string): Promise<void> {
    await page.locator('.bb-tabs.primary button[role="tab"]').filter({ hasText: label }).first().click();
    await page
        .locator('.bb-tabs.primary button[role="tab"][aria-selected="true"]')
        .filter({ hasText: label })
        .first()
        .waitFor({ timeout: 5000 });
}

const effectsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: /^Effects$/ }) });

async function selectRow(scope: Locator, idx: number): Promise<void> {
    await scope.locator(".vlist .vrow").nth(idx).click();
    await scope.locator(".row-actions").first().waitFor({ timeout: 3000 });
}
// Effects RowActions (Add above/Duplicate/Delete) drive a real structureOp round trip (webview -> host -> dispatch
// -> changeSet reply), so the row count is the settle signal - callers always check it via a Node-side
// sectionCount() that only reflects the mutation once the reply has landed. clickAction/clickDelete are only ever
// called against the Effects panel in this file, so the row list is queried directly rather than threaded through.
async function clickAction(scope: Locator, ariaLabel: string): Promise<void> {
    const before = await scope.locator(".vlist .vrow").count();
    await scope.locator(`.row-actions button[aria-label="${ariaLabel}"]`).first().click();
    await page
        .waitForFunction(
            (b) => {
                const panel = Array.from(document.querySelectorAll(".panel")).find(
                    (p) => (p.querySelector("h3")?.textContent ?? "").trim() === "Effects",
                );
                return !!panel && panel.querySelectorAll(".vlist .vrow").length !== b;
            },
            before,
            { timeout: 5000 },
        )
        .catch(() => undefined);
}
async function clickDelete(scope: Locator): Promise<void> {
    // Delete fires immediately (no confirm step) - a single click on the Delete button removes the entry.
    await clickAction(scope, "Delete");
}

// ============================================================
// Layout assertions
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///caps.cre", bytes: creBytes });
    if (r.type !== "opened") {
        check("layout: open succeeded", false, `type=${r.type}`);
    } else {
        const L = r.result.layout.layout;
        check("layout: variant is 'creature'", L?.variantId === "creature", `variantId=${L?.variantId}`);
        check(
            "layout: Effects canAdd+canModify",
            L?.sections["Effects"]?.canAdd === true && L?.sections["Effects"]?.canModify === true,
            JSON.stringify(L?.sections["Effects"]),
        );
        // The three spell tables render through the spellbook block, not list blocks, so they are absent from
        // the resolved sections map (their structure ops are driven by the spellbook, not a list toolbar).
        check(
            "layout: spell tables are not list sections (handled by the spellbook)",
            L?.sections["Known Spells"] === undefined &&
                L?.sections["Spell Memorization Info"] === undefined &&
                L?.sections["Memorized Spells"] === undefined,
            JSON.stringify(Object.keys(L?.sections ?? {})),
        );
    }
}
// CRE is tabbed: assert the top-level tab strip (count badges stripped), then visit the tabs that carry the
// grids/fields to verify they render and align. (The spellbook lives under Spells; the Effects/Items list
// sections under Effects/Inventory - both exercised below.)
const topTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'), (e) =>
        (e.textContent ?? "").replace(/\s*\(\d+(?:\/\d+)?\)\s*$/, "").trim(),
    ),
);
check(
    "layout: top-level tabs render in order",
    JSON.stringify(topTabs) ===
        JSON.stringify(["General", "Combat", "Inventory", "Proficiencies", "Sounds", "Spells", "Effects"]),
    JSON.stringify(topTabs),
);

await clickTab("General");
const fieldGap = await page.evaluate(() => {
    let min = Infinity;
    for (const field of Array.from(document.querySelectorAll(".layout-root .kv:not(.kv-multi) .field"))) {
        const label = field.querySelector(".label");
        const control = field.querySelector(".field-control");
        if (!label || !control) continue;
        min = Math.min(min, control.getBoundingClientRect().left - label.getBoundingClientRect().right);
    }
    return min;
});
check("layout: field label/value gap is positive (no overlap)", fieldGap >= 4, `minFieldGap=${fieldGap}px`);

// Range coverage: the numeric range indication (min/max attributes + an "Allowed range" title) must reach
// EVERY block renderer through the shared NumberField, not just Field.svelte's kv form. Assert one numeric
// input in each block kind carries it - FieldsBlock (General scalars), MatrixBlock (Proficiencies grid),
// GridBlock (Sounds grid).
const fieldsBlockRange = await page.evaluate(() => {
    const input = document.querySelector(".layout-root .kv .field input[type='number']");
    return { min: input?.getAttribute("min"), max: input?.getAttribute("max"), title: input?.getAttribute("title") };
});
check(
    "range coverage: a FieldsBlock numeric field carries min/max and an 'Allowed range' title",
    fieldsBlockRange.min != null &&
        fieldsBlockRange.max != null &&
        (fieldsBlockRange.title ?? "").startsWith("Allowed range:"),
    JSON.stringify(fieldsBlockRange),
);

await clickTab("Proficiencies");
const matrixBlockRange = await page.evaluate(() => {
    const input = document.querySelector(".layout-root .matrix .strow .c input[type='number']");
    return { min: input?.getAttribute("min"), max: input?.getAttribute("max"), title: input?.getAttribute("title") };
});
check(
    "range coverage: a MatrixBlock numeric cell carries min/max and an 'Allowed range' title",
    matrixBlockRange.min != null &&
        matrixBlockRange.max != null &&
        (matrixBlockRange.title ?? "").startsWith("Allowed range:"),
    JSON.stringify(matrixBlockRange),
);

await clickTab("Sounds");
const gridBlockRange = await page.evaluate(() => {
    const input = document.querySelector(".layout-root .grid .skill .field-control input[type='number']");
    return { min: input?.getAttribute("min"), max: input?.getAttribute("max"), title: input?.getAttribute("title") };
});
check(
    "range coverage: a GridBlock numeric cell carries min/max and an 'Allowed range' title",
    gridBlockRange.min != null &&
        gridBlockRange.max != null &&
        (gridBlockRange.title ?? "").startsWith("Allowed range:"),
    JSON.stringify(gridBlockRange),
);

await clickTab("Inventory");
const itemSlots = await page.locator('.layout-root .panel:has(h3:text-is("Item Slots")) .grid .skill').count();
check("layout: item-slots grid renders 40 cells", itemSlots === 40, `count=${itemSlots}`);

// Column-major fill guard: a grid block fills column 1 top-to-bottom, then column 2 - so the 2nd cell sits
// directly BELOW the 1st (same left edge, greater top), not to its right.
const gridColMajor = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".layout-root .panel:has(h3) .grid .skill"));
    if (cells.length < 2) return false;
    const a = cells[0]!.getBoundingClientRect();
    const b = cells[1]!.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 2 && b.top > a.top + 2;
});
check(
    "layout: grid block fills top-down first (column-major), not by row",
    gridColMajor,
    `gridColMajor=${gridColMajor}`,
);

// Cross-record jump: an Item Slots cell holding a valid item-table index renders its
// slot LABEL as a jump link (a .nm-link button whose title points at the Items entry); an empty (-1) slot keeps
// a plain .nm label. edwin6's Amulet slot holds index 0 (Items entry "Item 1"); Helmet is empty (-1).
const slotCell = (label: string) =>
    page.locator('.layout-root .panel:has(h3:text-is("Item Slots")) .grid .skill').filter({
        has: page.locator(".nm", { hasText: label }),
    });
const amuletLink = slotCell("Amulet").locator("button.nm-link");
const amuletLinkInfo = {
    count: await amuletLink.count(),
    text: (await amuletLink.first().textContent())?.trim(),
    title: await amuletLink.first().getAttribute("title"),
};
check(
    "inventory: a slot holding a valid item index renders its label as a jump link to the Items entry",
    amuletLinkInfo.count === 1 && amuletLinkInfo.text === "Amulet" && amuletLinkInfo.title === "Go to Item 1",
    JSON.stringify(amuletLinkInfo),
);
const helmetLinkCount = await slotCell("Helmet").locator("button.nm-link").count();
check(
    "inventory: an empty (-1) item slot renders a plain label, not a link",
    helmetLinkCount === 0,
    `count=${helmetLinkCount}`,
);

const itemsPanel = page.locator(".panel").filter({ has: page.locator("h3", { hasText: /^Items$/ }) });
await slotCell("Amulet").locator("button.nm-link").first().click();
await itemsPanel.locator(".vlist .vrow.selected").first().waitFor({ timeout: 5000 });
const selectedItemIsFirst = await itemsPanel
    .locator(".vlist .vrow")
    .first()
    .evaluate((el) => el.classList.contains("selected"));
check(
    "inventory: clicking the slot label link selects the referenced entry in the Items list",
    selectedItemIsFirst,
    `selectedItemIsFirst=${selectedItemIsFirst}`,
);

// Control-sizing guard: a slot's jump affordance must never squeeze the combobox it sits beside. The jump is
// now the LABEL acting as a link (in the max-content label track), and the control track floors at its dd-tier
// width - so a slot with a link must render its dropdown at the same width as one without. A clipped combobox
// has scrollWidth > clientWidth on its search-input element (guards the dropdown-squeeze regression regardless
// of the affordance).
async function measureItemSlotClipping(): Promise<{ anyClipped: boolean; detail: string }> {
    return page.evaluate(() => {
        // `:has(h3:text-is(...))` is a Playwright-locator-only pseudo, not valid in a native querySelectorAll
        // (unlike `:has()` itself, which IS real CSS) - find the "Item Slots" panel by its h3 text instead.
        const panel = Array.from(document.querySelectorAll(".layout-root .panel")).find(
            (p) => (p.querySelector("h3")?.textContent ?? "").trim() === "Item Slots",
        );
        const boxes = Array.from(
            panel?.querySelectorAll(".grid .skill .field-control .bb-combobox-input") ?? [],
        ) as HTMLInputElement[];
        const clipped = boxes
            .map((b) => ({ label: b.getAttribute("aria-label"), over: b.scrollWidth - b.clientWidth }))
            .filter((c) => c.over > 1);
        return { anyClipped: clipped.length > 0, detail: JSON.stringify(clipped) };
    });
}
const clipComfortable = await measureItemSlotClipping();
check(
    "inventory: no item-slot combobox clips at the harness's comfortable (1280px) viewport",
    !clipComfortable.anyClipped,
    clipComfortable.detail,
);
await page.screenshot({ path: shotPath("shot-cre-inventory.png"), fullPage: true });

// Live case: crossRefDependents re-projects every in-range slot when an item's ResRef changes, and a slot's
// OWN edit can add/remove ITS OWN link at runtime. Helmet (empty, column 0, same visual column as Amulet) has
// a plain label; drive its combobox to the item Amulet already holds, so Helmet gains a link and its label
// turns into a .nm-link. Confirm Helmet's own control keeps its column left edge - the label link occupies the
// same (max-content) label track as the plain label did, so gaining a link must not shift the control.
const helmetControl = slotCell("Helmet").locator(".field-control");
const helmetBefore = await helmetControl.evaluate((el) => el.getBoundingClientRect().left);
await page.locator('.bb-combobox-input[aria-label="Helmet"]').click();
await page
    .waitForFunction(() => document.querySelectorAll(".bb-popup-item").length > 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
await page.locator(".bb-popup-item", { hasText: "BGMISC89" }).first().click();
await slotCell("Helmet").locator("button.nm-link").first().waitFor({ timeout: 5000 });
const helmetAfter = await helmetControl.evaluate((el) => el.getBoundingClientRect().left);
check(
    "inventory: a slot's own control keeps its column left edge when its label becomes a link live",
    Math.abs(helmetBefore - helmetAfter) < 1,
    `before=${helmetBefore} after=${helmetAfter}`,
);
const clipAfterLiveChip = await measureItemSlotClipping();
check(
    "inventory: no item-slot combobox clips after a slot label becomes a link live",
    !clipAfterLiveChip.anyClipped,
    clipAfterLiveChip.detail,
);
// Revert the live edit so the byte-round-trip regression later in this file sees the original fixture bytes.
await doUndo();

// Constrained-width pass: the CRE layout caps at 1180px (maxContentWidthPx) regardless of a WIDER viewport,
// so the comfortable pass above never falls below that cap. A live code-server session at a 1920px BROWSER
// window still measured real clipping, because the webview's actual content area (behind VS Code's own
// sidebar/tabs chrome) was narrower than this harness's bare full-viewport render - narrow the viewport below
// the cap to reproduce that squeeze directly. 1000px (panel ~996px) was measured (via a throwaway probe
// against the pre-fix build) as reliably past the threshold where the pre-fix code clipped; 1150px (panel
// ~1146px) was NOT - the panel's own maxContentWidthPx cap (1180px) leaves only a little slack before real
// content genuinely exceeds it, so the constrained width must clear that margin, not just dip below the cap.
await page.setViewportSize({ width: 1000, height: 900 });
const clipConstrained = await measureItemSlotClipping();
check(
    "inventory: no item-slot combobox clips at a constrained (1000px) viewport",
    !clipConstrained.anyClipped,
    clipConstrained.detail,
);
await page.screenshot({ path: shotPath("shot-cre-inventory-narrow.png"), fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });

// Proficiencies and Tracked Objects share the "Proficiencies" tab; Sound Slots is its own "Sounds" tab.
const gridCounts = async (): Promise<{ counts: Record<string, number>; minGridGap: number }> =>
    page.evaluate(() => {
        const counts: Record<string, number> = {};
        for (const p of Array.from(document.querySelectorAll(".layout-root .panel"))) {
            const title = p.querySelector("h3")?.textContent ?? "";
            counts[title] = p.querySelectorAll(".grid .skill").length;
        }
        let minGridGap = Infinity;
        for (const cell of Array.from(document.querySelectorAll(".layout-root .grid .skill"))) {
            const label = cell.querySelector(".nm");
            const control = cell.querySelector(".field-control, input, select");
            if (!label || !control) continue;
            minGridGap = Math.min(
                minGridGap,
                control.getBoundingClientRect().left - label.getBoundingClientRect().right,
            );
        }
        return { counts, minGridGap };
    });

await clickTab("Proficiencies");
// Proficiencies render as a 2-column matrix (Active Class / Original Class), one `.strow` per slot with two
// value cells (`.c`) - not a grid. 20 slots x 2 columns = 40 cells.
const prof = await page.evaluate(() => {
    const matrix = document.querySelector(".layout-root .panel .matrix");
    return {
        rows: matrix ? matrix.querySelectorAll(".strow").length : 0,
        cells: matrix ? matrix.querySelectorAll(".strow .c").length : 0,
        colHeaders: matrix ? Array.from(matrix.querySelectorAll(".sub .bb"), (e) => (e.textContent ?? "").trim()) : [],
        firstRowLabel: matrix?.querySelector(".strow .nm")?.textContent?.trim() ?? "",
    };
});
check(
    "layout: proficiencies matrix renders 20 rows x 2 value columns (40 cells)",
    prof.rows === 20 && prof.cells === 40,
    JSON.stringify(prof),
);
check(
    "layout: proficiencies matrix column headers are Active/Original Class",
    JSON.stringify(prof.colHeaders) === JSON.stringify(["Active Class", "Original Class"]),
    JSON.stringify(prof.colHeaders),
);
check(
    "layout: proficiencies matrix first row labelled 'Large Swords'",
    prof.firstRowLabel === "Large Swords",
    prof.firstRowLabel,
);

await clickTab("Sounds");
const sound = await gridCounts();
check("layout: sound-slots grid renders 100 cells", sound.counts["Sound Slots"] === 100, JSON.stringify(sound.counts));
check(
    "layout: sound-slots grid label/value gap is positive",
    sound.minGridGap >= 4,
    `minGridGap=${sound.minGridGap}px`,
);

// 100 slots is a long scroll, so they pack four across - but a strref control is sized to show its dialog.tlk
// line, and four of those must still fit the panel at this viewport. Guards both halves at once: the column
// count is what makes the block compact, the overflow check is what stops that packing from running off-panel.
// Column count is measured from where the cells actually land, not from the template, so the assertion holds
// whatever mechanism does the fitting.
const measureGrid = async (): Promise<{ columns: number; gridWidth: number; docOverflow: number } | null> =>
    page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>(".layout-root .grid");
        if (!grid) return null;
        const xs = new Set(Array.from(grid.querySelectorAll(".skill"), (s) => Math.round(s.getBoundingClientRect().x)));
        return {
            columns: xs.size,
            gridWidth: Math.round(grid.getBoundingClientRect().width),
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });

const soundGrid = await measureGrid();
check(
    "layout: sound slots pack four columns without overflowing the panel",
    soundGrid !== null && soundGrid.columns === 4 && soundGrid.docOverflow === 0,
    JSON.stringify(soundGrid),
);

// The panel is not always this wide - a narrow window, a split editor, or (with a game open) IDS slot names
// three times longer than "Sound 12". The block must shed columns to fit rather than run off the panel, so the
// schema's column count is a MAXIMUM, not a promise.
await page.setViewportSize({ width: 760, height: 900 });
const narrowGrid = await measureGrid();
await page.setViewportSize({ width: 1280, height: 900 });
check(
    "layout: sound slots shed columns instead of overflowing a narrow panel",
    narrowGrid !== null && narrowGrid.columns < 4 && narrowGrid.columns >= 1 && narrowGrid.docOverflow === 0,
    JSON.stringify(narrowGrid),
);

// ============================================================
// Baseline counts (Node-side ground truth). The spell tables are no longer list sections (they render through
// the spellbook), so they are absent from the sections map; the spellbook block is exercised via getSpellbook.
// ============================================================
const baseEffects = sectionCount(sectionNodeId["Effects"]!);
check("baseline: effects count >= 1", baseEffects >= 1, `count=${baseEffects}`);
// Total memorized spells across the joined view (cleanly-owned slots + any unassigned-bucket entries).
const memorizedTotal = (): number => {
    const r = dispatch({ type: "getSpellbook", sessionId });
    if (r.type !== "spellbook") return -1;
    return (
        r.view.types.reduce((n, t) => n + t.levels.reduce((m, l) => m + l.slots.length, 0), 0) + r.view.bucket.length
    );
};

// ============================================================
// SPELLS: the three spell tables render through the unified spellbook (type subtabs over per-level cards),
// not three flat lists. Assert it renders, then drive a "+ memorize" through the real message path and confirm
// the level gains a memorized slot.
// ============================================================
await clickTab("Spells");
await page.waitForSelector(".spellbook", { timeout: 3000 });
await page.screenshot({ path: shotPath("shot-cre-spells.png"), fullPage: true });
const spellbookTypeTabs = await page.locator(".spellbook .bb-tabs button[role='tab']").allInnerTexts();
check(
    "spells: spellbook renders a spell-type subtab (Wizard for the mage fixture)",
    spellbookTypeTabs.some((t) => /Wizard/i.test(t)),
    JSON.stringify(spellbookTypeTabs),
);
const baseMemorized = memorizedTotal();
const firstLevelCard = page.locator(".spellbook .sb-level").first();
check("spells: at least one level card renders", (await page.locator(".spellbook .sb-level").count()) >= 1, "");
const readSpellsTab = () =>
    page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'));
        const tab = tabs.find((b) => (b.textContent ?? "").trim().startsWith("Spells"));
        return (tab?.textContent ?? "").trim();
    });
const spellsTabBefore = await readSpellsTab();
await firstLevelCard.locator("button.sb-add", { hasText: "memorize" }).first().click();
await page
    .waitForFunction(
        (before) => {
            const tabs = Array.from(document.querySelectorAll('.bb-tabs.primary button[role="tab"]'));
            const tab = tabs.find((b) => (b.textContent ?? "").trim().startsWith("Spells"));
            return !!tab && (tab.textContent ?? "").trim() !== before;
        },
        spellsTabBefore,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const spellsTabAfter = await readSpellsTab();
check(
    "spells: + memorize adds a memorized spell (count +1)",
    memorizedTotal() === baseMemorized + 1,
    `count=${memorizedTotal()}`,
);
check(
    "spells: top-level Spells tab count refreshes after the structure op",
    spellsTabAfter !== spellsTabBefore && /\(\d+\/\d+\)/.test(spellsTabAfter),
    `before="${spellsTabBefore}" after="${spellsTabAfter}"`,
);
await doUndo();
const spellsTabUndone = await readSpellsTab();
check(
    "spells: undo restores the memorized-spell count",
    memorizedTotal() === baseMemorized,
    `count=${memorizedTotal()}`,
);
check(
    "spells: undo also restores the top-level Spells tab count",
    spellsTabUndone === spellsTabBefore,
    `before="${spellsTabBefore}" undone="${spellsTabUndone}"`,
);

// ---- Spellbook card layout: cards must be a uniform width (no flex-grow drift where a trailing odd card on a
// partial row hits max-width and is wider), and a level's Known and Memorized entries must align row-for-row. ----
await page.setViewportSize({ width: 900, height: 1500 });
const cardWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".spellbook .sb-level"), (el) => Math.round(el.getBoundingClientRect().width)),
);
check("spells: all level cards have equal width", new Set(cardWidths).size === 1, JSON.stringify(cardWidths));
await page.setViewportSize({ width: 1280, height: 1000 });
const entryAlign = await page.evaluate(() => {
    for (const c of Array.from(document.querySelectorAll(".spellbook .sb-level"))) {
        const cols = c.querySelectorAll(".sb-col");
        const k = cols[0] ? cols[0].querySelector(".sb-resref") : null;
        const m = cols[1] ? cols[1].querySelector(".sb-resref") : null;
        if (k && m)
            return { known: Math.round(k.getBoundingClientRect().top), mem: Math.round(m.getBoundingClientRect().top) };
    }
    return { known: -1, mem: -2 };
});
check(
    "spells: Known and Memorized first entries align (same top)",
    entryAlign.known === entryAlign.mem,
    JSON.stringify(entryAlign),
);
const xPos = await page.evaluate(() => {
    for (const c of Array.from(document.querySelectorAll(".spellbook .sb-level"))) {
        const row = c.querySelector(".sb-mem-row");
        if (!row) continue;
        const resref = row.querySelector(".sb-resref");
        const x = row.querySelector(".sb-x");
        const cb = row.querySelector(".bb-checkbox-label");
        if (resref && x && cb)
            return {
                resref: Math.round(resref.getBoundingClientRect().left),
                x: Math.round(x.getBoundingClientRect().left),
                cb: Math.round(cb.getBoundingClientRect().left),
            };
    }
    return { resref: 0, x: 0, cb: 0 };
});
check(
    "spells: memorized remove (x) follows the resref slot, before the flags",
    xPos.resref < xPos.x && xPos.x < xPos.cb,
    JSON.stringify(xPos),
);

// ============================================================
// EFFECTS: insert-before / duplicate / remove, each undone
// ============================================================
await clickTab("Effects");
await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Add above");
check(
    "effects: insert-before row0: +1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects + 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

await selectRow(effectsPanel, 0);
await clickAction(effectsPanel, "Duplicate");
check(
    "effects: duplicate row0: +1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects + 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

await selectRow(effectsPanel, 0);
await clickDelete(effectsPanel);
check(
    "effects: remove row0: -1",
    sectionCount(sectionNodeId["Effects"]!) === baseEffects - 1,
    `count=${sectionCount(sectionNodeId["Effects"]!)}`,
);
await doUndo();

// ============================================================
// Effect detail: a CRE v2 effect renders through the SHARED EFF v2 fragment (the same LayoutRenderer panels
// a standalone `.eff` uses), not a generic auto-form - so the detail pane shows `.layout-root` panels, and
// opcode renders as a searchable combobox (every enum does; opcode is enumOpen so it also accepts a custom value).
// ============================================================
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
// The effects list viewport is capped generously (48rem ~= 768px) so it uses the vertical space beside the
// taller effect detail instead of scrolling at ~17 rows (the former 24rem cap). Measure the real px to guard
// against the cap silently reverting; > 500 distinguishes the new cap from the old regardless of root font-size.
const effVlistMax = await effectsPanel
    .locator(".master .vlist")
    .first()
    .evaluate((el) => Math.round(parseFloat(getComputedStyle(el).maxHeight)));
check(
    "effects: list viewport cap uses the height beside the detail (> 500px)",
    effVlistMax > 500,
    `maxHeight=${effVlistMax}px`,
);
// The shared EFF v2 fragment renders through LayoutRenderer (`.detail .layout-root`), not the generic
// auto-form (which has no `.layout-root`) - so the presence of layout fields is the shared-fragment signal.
// The fragment is one untitled wire-byte-order panel: no semantic panel `h3` titles (the Save Type / Resistance
// flag boxes carry their own legends, not panel titles).
const sharedFields = await effectsPanel.locator(".detail .layout-root .field").count();
const sharedPanelTitles = await effectsPanel.locator(".detail .layout-root .panel > h3").count();
check(
    "effects: v2 effect detail renders the shared EFF fragment in wire byte order (no semantic panel titles)",
    sharedFields > 20 && sharedPanelTitles === 0,
    `fields=${sharedFields} panelTitles=${sharedPanelTitles}`,
);
const opcodeCombobox = await effectsPanel.locator(".detail .bb-combobox-input").count();
check("effects: opcode detail field is a searchable combobox", opcodeCombobox >= 1, `count=${opcodeCombobox}`);

// Reserved/padding fields (signature2, version2, unused1-7) are not referenced by the shared fragment, so the
// v2 effect detail must NOT render them (edwin6 uses effStructureVersion 1 = EFF v2 body, which has all of
// them). They stay in the model for the byte round-trip (asserted below) - only the form omits them.
const effectDetailText = (await effectsPanel.locator(".detail").first().innerText()).toLowerCase();
const showsReserved = /signature|version\s*2|unused/.test(effectDetailText);
check(
    "effects: reserved/padding fields are hidden from the detail form",
    !showsReserved,
    `text-has-reserved=${showsReserved}`,
);

// ============================================================
// REGRESSION: open -> serialize round-trips byte-identical (dispatch-level, DOM-independent).
// ============================================================
{
    const r = dispatch({ type: "open", uri: "file:///roundtrip.cre", bytes: creBytes });
    if (r.type !== "opened") {
        check("regression: roundtrip open succeeded", false, `type=${r.type}`);
    } else {
        const s = dispatch({ type: "serialize", sessionId: r.result.sessionId });
        const out = s.type === "serialized" ? s.bytes : new Uint8Array();
        const identical = out.length === creBytes.length && out.every((b, i) => b === creBytes[i]);
        check(
            "regression: save round-trips byte-identical",
            identical,
            `outLen=${out.length} srcLen=${creBytes.length}`,
        );
    }
}

// ---- Screenshots ---- (shot-cre.png = the General tab, captured at load; here capture the Effects tab detail)
await clickTab("Effects");
await selectRow(effectsPanel, 0);
await effectsPanel.locator(".detail .layout-root .field").first().waitFor({ timeout: 3000 });
await page.screenshot({ path: shotPath("shot-cre-effects.png"), fullPage: true });

await browser.close();

console.log("\n=== CRE layout harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL CRE ASSERTIONS PASS" : `\n${failed} CRE ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
