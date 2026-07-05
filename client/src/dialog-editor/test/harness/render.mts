/**
 * Production-path render driver for the dialog editor webview.
 *
 * Loads the real App.svelte root (app.html, built by build.mts) in Chromium and drives it
 * through the SAME channel the live webview uses: the host's messages arrive via
 * `window.postMessage`, App holds the model in a Svelte $state proxy, and passes that proxy
 * to DialogGraph. This is the path that hid three bugs behind a green DialogGraph-only
 * harness (external <script> blanking the panel, structuredClone($state) DataCloneError,
 * silent hang). The driver asserts the panel actually renders, a structural edit
 * (Duplicate state - which deep-clones a $state proxy) works, and the fail-loud error
 * state surfaces. A page error (e.g. a re-introduced DataCloneError) or a CSP violation
 * fails the run.
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts   # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render.mts  # this driver
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { REAL_MODEL } from "./real-model";

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = path.join(here, "app.html");
// Runtime artefacts go under the repo-level tmp/, never the source tree (project convention).
const outDir = path.resolve(here, "../../../../../tmp");
mkdirSync(outDir, { recursive: true });
const shot = process.argv[2] ?? path.join(outDir, "dialog-harness-shot.png");

const results: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

// Fail-loud gates: an uncaught page error (a re-introduced DataCloneError lands here) or a
// CSP violation must fail the run, not be swallowed.
const pageErrors: string[] = [];
const cspViolations: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) || /Refused to/i.test(t)) cspViolations.push(t);
});

// The default view is now Tree; most assertions below drive the node graph, so this posts the model and
// then switches to the Graph tab. A fresh page.goto() resets to the Tree default, so every reload block
// that needs the graph calls showGraph() after posting.
async function postModel(): Promise<void> {
    await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), REAL_MODEL);
}
async function showGraph(): Promise<void> {
    await page.getByRole("tab", { name: "Graph" }).click();
    await page.waitForSelector(".svelte-flow__node", { timeout: 10_000 });
}

await page.goto("file://" + appHtml);

// Before any message arrives, App shows the loading state (not an error, not a graph).
const loadingText = (await page.locator("#app").textContent())?.trim() ?? "";
check("initial state is the loading placeholder", /Parsing dialog/i.test(loadingText), JSON.stringify(loadingText));

// Deliver the model through the real channel App listens on. App wraps it in $state and
// hands the proxy to DialogGraph.cloneModel ($state.snapshot) - the path that crashed.
await postModel();
// Default view is Tree: the model first renders the tree outline.
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const treeItems = await page.locator('[role="treeitem"]').count();
check("model posted via postMessage renders the default (tree) view", treeItems > 0, `items=${treeItems}`);
const afterModelText = (await page.locator("#app").textContent()) ?? "";
check("loading placeholder is gone once the model renders", !/Parsing dialog/i.test(afterModelText));
// Switch to Graph for the node-graph assertions below.
await showGraph();
const nodeCount = await page.locator(".svelte-flow__node").count();
check("switching to Graph renders the node graph", nodeCount > 0, `nodes=${nodeCount}`);

// Exercise a structural edit that deep-clones a $state proxy: select a card, Duplicate it.
// duplicateState uses JSON.parse(JSON.stringify(...)) precisely because structuredClone
// throws on the proxy; this drives that path end to end.
await page.locator(".svelte-flow__node").first().click();
const dupBtn = page.getByRole("button", { name: "Duplicate state" });
await dupBtn.waitFor({ timeout: 5000 });
const before = await page.locator(".svelte-flow__node").count();
await dupBtn.click();
await page.waitForTimeout(400);
const after = await page.locator(".svelte-flow__node").count();
check(
    "Duplicate state adds a node (deep-clones the $state proxy)",
    after === before + 1,
    `before=${before} after=${after}`,
);

// Spotlight overlay (1B): toggling it dims fully-authored cards (no badge) while the
// flagged ones stay fully opaque - the author's "which parts are projections?" lens.
await page.getByRole("button", { name: "Spotlight" }).click();
await page.waitForTimeout(250);
const spot = await page.evaluate(() => {
    // No named inner functions here: tsx/esbuild keepNames would inject a __name helper
    // that is undefined in the page context. Inline the opacity read instead.
    const cards = Array.from(document.querySelectorAll(".card"));
    const flagged = cards.filter((c) => c.classList.contains("flagged"));
    const trusted = cards.filter((c) => !c.classList.contains("flagged"));
    return {
        flaggedCount: flagged.length,
        trustedCount: trusted.length,
        flaggedAllOpaque: flagged.every((c) => parseFloat(getComputedStyle(c).opacity) > 0.9),
        someTrustedDimmed: trusted.some((c) => parseFloat(getComputedStyle(c).opacity) < 0.5),
    };
});
check(
    "spotlight dims trusted cards and keeps flagged ones opaque",
    spot.flaggedCount > 0 && spot.trustedCount > 0 && spot.flaggedAllOpaque && spot.someTrustedDimmed,
    JSON.stringify(spot),
);

await page.screenshot({ path: shot });

// Panel layout - render-STATE coverage (testing.md) at the PRODUCTION container's real width.
// The live dialog editor is a webview that shares the VS Code window (a side/split panel), so it is
// far narrower than a standalone harness - realistically ~270-540px. The busiest graph frame has the
// selection inspector + Source + Issues overlays open at once, sharing the canvas with the fixed
// minimap and zoom controls; overlay/floating panels collide only when the container is narrow, so a
// harness rendered wide is a false green (this exact miss shipped as commit 312cf03c). Drive the busy
// state at the real min (~300px) and a mid (~520px) width and assert no two overlays collide at either.
async function measureCollisionsAt(width: number): Promise<string[]> {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("file://" + appHtml); // fresh load so earlier interactions don't bleed in
    await postModel();
    await showGraph();
    await page.locator(".svelte-flow__node").first().click({ force: true }); // show the inspector
    for (const name of ["Source", "Issues"]) {
        const b = page.getByRole("button", { name: new RegExp("^" + name) });
        // force: a floating overlay may intercept the button at narrow width - that is the very
        // collision under test, so open the panels regardless and let the box-check report it.
        if (await b.count()) await b.first().click({ force: true });
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, `dialog-harness-${width}.png`) });
    return page.evaluate(() => {
        // Inline only (no named fns): tsx/esbuild keepNames would inject an undefined __name in the page.
        const sels = [
            ".dialogtoolbar", // shared docked toolbar header
            ".inspector",
            ".svelte-flow__minimap",
            ".svelte-flow__controls",
            ".dsource", // D source preview
            ".issues",
        ];
        const boxes = sels
            .map((s) => {
                const el = document.querySelector(s);
                return el ? { s, r: el.getBoundingClientRect() } : null;
            })
            .filter((x) => x !== null);
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]!.r,
                    b = boxes[j]!.r;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1)
                    hits.push(`${boxes[i]!.s} x ${boxes[j]!.s} (${Math.round(ox)}x${Math.round(oy)})`);
            }
        return hits;
    });
}
// 300/520 are the narrow real webview widths (minimap hidden); 900 is a wide case where the minimap
// IS shown, so the minimap-vs-controls placement is exercised too rather than skipped.
for (const width of [300, 520, 900]) {
    const panelCollisions = await measureCollisionsAt(width);
    check(
        `no dialog graph overlays collide at ${width}px (inspector + source + issues + minimap + controls)`,
        panelCollisions.length === 0,
        panelCollisions.join("; "),
    );
}

// Delete confirmation: deleting a referenced state used to SILENTLY redirect its inbound
// transitions to EXIT. Selecting a referenced state and deleting must now pop a confirm naming the
// redirect, cancel must keep the node, and only confirm removes it.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 1000, height: 700 });
await postModel();
await showGraph();
const beforeDel = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.getByRole("button", { name: "Delete state" }).click();
const confirmMsg = (await page.locator(".confirm .confirmmsg").textContent()) ?? "";
check(
    "deleting a referenced state confirms and names the EXIT redirect",
    (await page.locator(".confirm").isVisible()) && /redirected to\s+EXIT/i.test(confirmMsg),
    JSON.stringify(confirmMsg.trim().slice(0, 120)),
);
await page.locator(".confirm .toolbtn:not(.confirmdel)").click(); // Cancel
const afterCancel = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.getByRole("button", { name: "Delete state" }).click();
await page.locator(".confirm .confirmdel").click(); // confirm Delete
await page.waitForTimeout(300);
const afterDel = await page.locator(".svelte-flow__node").count();
const returnBrielGone = (await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).count()) === 0;
check(
    "cancel keeps the graph; confirm removes the state",
    // Cancel is a no-op; confirm removes returnBriel (and may prune a now-orphaned external stub too,
    // so assert the graph shrank and the target node itself is gone rather than an exact delta).
    afterCancel === beforeDel && afterDel < beforeDel && returnBrielGone,
    `before=${beforeDel} afterCancel=${afterCancel} afterDel=${afterDel} gone=${returnBrielGone}`,
);

// Keyboard delete goes through the SAME guarded path: svelte-flow's built-in delete key is disabled
// (deleteKey={null}), so selecting a referenced node and pressing Backspace must pop the confirm, not
// silently drop the node and leave dangling GOTOs (the live-review bug).
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 1000, height: 700 });
await postModel();
await showGraph();
const beforeKbd = await page.locator(".svelte-flow__node").count();
await page.locator(".svelte-flow__node", { hasText: "returnBriel" }).first().click();
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
const kbdConfirm = await page.locator(".confirm").isVisible();
const afterKbdNoConfirm = await page.locator(".svelte-flow__node").count();
check(
    "Backspace on a selected referenced node confirms (does not silently delete)",
    kbdConfirm && afterKbdNoConfirm === beforeKbd,
    `confirm=${kbdConfirm} before=${beforeKbd} after=${afterKbdNoConfirm}`,
);

// Tree keyboard navigation: state rows are treeitems with roving tabindex (the expand caret is out of the
// tab order - one focusable per row, not two). ArrowUp/Down move SELECTION between visible rows (focus AND
// select, so the docked inspector follows the keyboard); ArrowLeft/Right collapse/expand the focused row.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 900, height: 700 });
await postModel();
// Tree is the default view now, so no tab switch is needed.
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const treeA11y = await page.evaluate(() => ({
    trees: document.querySelectorAll('[role="tree"]').length,
    items: document.querySelectorAll('[role="treeitem"]').length,
    // Carets must be out of the tab order so each row is a single tab stop.
    tabbableCarets: Array.from(document.querySelectorAll(".caret")).filter((c) => (c as HTMLElement).tabIndex >= 0)
        .length,
}));
const firstItem = page.locator('[role="treeitem"]').first();
await firstItem.click();
const firstSid = await firstItem.getAttribute("data-sid");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(80);
// Navigation interleaves state rows and selectable options in DOM order, so ArrowDown off the first state
// lands on either its first option (a .rep row, carrying data-choice) or - if it has none - the next
// state row. Either way the landing target must be BOTH focused and selected, proving selection follows:
// a state row reads aria-selected="true"; a selected option's row carries the .repsel class.
const down = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { key: null as string | null, selected: false };
    const isState = a.getAttribute("role") === "treeitem";
    const selected = isState
        ? a.getAttribute("aria-selected") === "true"
        : (a.closest(".rep")?.classList.contains("repsel") ?? false);
    return { key: a.getAttribute("data-sid") ?? a.getAttribute("data-choice"), selected };
});
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(80);
// ArrowUp steps back to the first state row (data-sid === firstSid).
const upSid = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-sid"));
check(
    "tree roles + no tabbable carets; ArrowUp/Down move selection across rows and options",
    treeA11y.trees === 1 &&
        treeA11y.items > 1 &&
        treeA11y.tabbableCarets === 0 &&
        !!down.key &&
        down.key !== firstSid &&
        down.selected &&
        upSid === firstSid,
    JSON.stringify({ ...treeA11y, firstSid, ...down, upSid }),
);
// ArrowLeft collapses the focused parent row; ArrowRight re-expands it (first state has children).
await firstItem.focus();
const expInit = await firstItem.getAttribute("aria-expanded");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(120);
const expCollapsed = await firstItem.getAttribute("aria-expanded");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(120);
const expReExpanded = await firstItem.getAttribute("aria-expanded");
check(
    "ArrowLeft collapses and ArrowRight expands the focused row",
    expInit === "true" && expCollapsed === "false" && expReExpanded === "true",
    JSON.stringify({ expInit, expCollapsed, expReExpanded }),
);

// Tooltips. Option text (.rtext) shows a title ONLY when clipped - a fitting option would just echo the
// visible text. A conversation line (.line) ALWAYS carries the state id (the NodeXXX dropped from the inline
// row) as its title, with the full text appended when the line is clipped. Drive a narrow viewport so long
// text clips and short text ("(no line)"/"(continue)") fits.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 360, height: 800 });
await postModel();
await page.waitForSelector(".tree .line", { timeout: 10_000 });
await page.waitForTimeout(150); // let each line's ResizeObserver run its initial clipped-or-not sync
const tips = await page.evaluate(() => {
    const opts = [...document.querySelectorAll<HTMLElement>(".tree .rtext")];
    let fitNoTitle = 0;
    let fitWithTitle = 0;
    let clipWithTitle = 0;
    let clipNoTitle = 0;
    for (const el of opts) {
        const clipped = el.scrollWidth > el.clientWidth;
        const hasTitle = el.hasAttribute("title");
        if (clipped) hasTitle ? clipWithTitle++ : clipNoTitle++;
        else hasTitle ? fitWithTitle++ : fitNoTitle++;
    }
    const lines = [...document.querySelectorAll<HTMLElement>(".tree .line")];
    return {
        optTotal: opts.length,
        fitNoTitle,
        fitWithTitle,
        clipWithTitle,
        clipNoTitle,
        lineCount: lines.length,
        linesAllTitled: lines.length > 0 && lines.every((el) => el.hasAttribute("title")),
    };
});
check(
    "option tooltips appear only when clipped; every conversation line carries a tooltip (the id)",
    tips.optTotal > 0 &&
        tips.fitWithTitle === 0 &&
        tips.clipNoTitle === 0 &&
        tips.fitNoTitle > 0 &&
        tips.clipWithTitle > 0 &&
        tips.linesAllTitled,
    JSON.stringify(tips),
);

// State id is no longer an inline "NodeXXX" label, nor a row-wide tooltip: no .sid spans, the row carries no
// title, and each state's conversation line exposes the id as its tooltip (title starts with the data-sid).
const sidCheck = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>(".tree .st[data-sid]")].find((r) =>
        r.querySelector(".line"),
    );
    const line = row?.querySelector<HTMLElement>(".line");
    return {
        sidSpans: document.querySelectorAll(".tree .sid").length,
        rowHasNoTitle: !!row && !row.hasAttribute("title"),
        lineTitleStartsWithId:
            !!line && (line.getAttribute("title") ?? "").startsWith(row!.getAttribute("data-sid") ?? "\0"),
    };
});
check(
    "state id is the line's tooltip (starts with the id), not an inline label or row-wide tooltip",
    sidCheck.sidSpans === 0 && sidCheck.rowHasNoTitle && sidCheck.lineTitleStartsWithId,
    JSON.stringify(sidCheck),
);

// Tree inline add/remove option: the "+ option" row appends a player option to an editable state,
// and the per-row hover "x" removes one - both through the production path (App -> $state proxy ->
// DialogGraph.addReplyToState/removeReplyFromState -> the shared ops -> rebuild). REAL_MODEL is a D
// dialogue, so every non-derived state is structurally editable and every option's "x" is enabled.
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 640, height: 800 });
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const repsBefore = await page.locator(".rep").count();
await page.locator(".addbtn").first().click(); // "+ option" on the first editable state
await page.waitForTimeout(200);
const repsAfterAdd = await page.locator(".rep").count();
check(
    'tree "+ option" appends a player option (add through the production path)',
    repsAfterAdd === repsBefore + 1,
    `before=${repsBefore} afterAdd=${repsAfterAdd}`,
);
// Remove: hover a reply row to reveal its "x", then click it.
const firstRep = page.locator(".rep").first();
await firstRep.hover();
await firstRep.locator(".delopt:not([disabled])").click();
await page.waitForTimeout(200);
const repsAfterRemove = await page.locator(".rep").count();
check(
    'tree hover "x" removes a player option (remove through the production path)',
    repsAfterRemove === repsAfterAdd - 1,
    `afterAdd=${repsAfterAdd} afterRemove=${repsAfterRemove}`,
);

// Tree option selection: clicking anywhere on an option row (the whole .rep row is the selection target)
// selects that individual option - it highlights the tree row (.rep.repsel), docks the Inspector for its
// owner state, and highlights the matching option row there (.trow.choicesel). Drives the full production
// path (App -> $state proxy -> DialogGraph.selectReplyInTree -> Inspector effect).
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 900, height: 800 });
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const optRow = page.locator(".rep[data-choice]").first();
await optRow.click();
await page.waitForTimeout(200);
const selState = await page.evaluate(() => ({
    treeSel: document.querySelectorAll(".rep.repsel").length,
    inspectorSel: document.querySelectorAll(".trow.choicesel").length,
}));
check(
    "clicking an option selects it: tree row + inspector row both highlight",
    selState.treeSel === 1 && selState.inspectorSel === 1,
    JSON.stringify(selState),
);

// Focused-option Inspector (dedicated option panel): selecting an option collapses the docked Inspector to a
// breadcrumb ("<state> > option #N") + just that option's fields. The whole-state chrome (NPC line, sibling
// options, Referenced-by, state ops) is hidden - so exactly one option row and no NPC-line field remain.
await page.waitForSelector(".inspector .crumbs", { timeout: 5_000 });
const focused = await page.evaluate(() => ({
    crumbs: document.querySelectorAll(".inspector .crumbs").length,
    crumbText: document.querySelector(".inspector .crumbcur")?.textContent?.trim() ?? "",
    npc: document.querySelectorAll(".inspector .iv.npc").length,
    rows: document.querySelectorAll(".inspector .trow").length,
    // Only the option highlights: the owner node is NOT highlighted (.st.sel) while an option is selected.
    nodeSel: document.querySelectorAll(".st.sel").length,
}));
await page.screenshot({ path: path.join(outDir, "dlg-focused-panel.png") });
check(
    "selecting an option focuses the Inspector on it: breadcrumb shown, whole-state chrome hidden, node not highlighted",
    focused.crumbs === 1 &&
        focused.crumbText.startsWith("option #") &&
        focused.npc === 0 &&
        focused.rows === 1 &&
        focused.nodeSel === 0,
    JSON.stringify(focused),
);
// The breadcrumb's state crumb returns to the whole-state editor (NPC line back, breadcrumb gone, node
// highlight restored).
await page.locator(".inspector .crumb").click();
await page.waitForTimeout(150);
const restored = await page.evaluate(() => ({
    crumbs: document.querySelectorAll(".inspector .crumbs").length,
    npc: document.querySelectorAll(".inspector .iv.npc").length,
    nodeSel: document.querySelectorAll(".st.sel").length,
}));
check(
    "the breadcrumb state crumb returns to the whole-state editor and re-highlights the node",
    restored.crumbs === 0 && restored.npc === 1 && restored.nodeSel === 1,
    JSON.stringify(restored),
);

// Inline text editing: double-click an option row -> an input appears, focused; type + Enter commits the
// new text (through DialogGraph.commitEditReply -> the .msg/.tra or choice.text write-back + reproject).
const editRow = page.locator(".rep[data-choice]").first();
const oldText = (await editRow.locator(".rtext").textContent())?.trim() ?? "";
await editRow.dblclick();
await page.waitForTimeout(150);
const inputAppeared = await page.locator(".rtextedit").count();
const inputFocused = await page.evaluate(() => document.activeElement?.classList.contains("rtextedit") ?? false);
await page.locator(".rtextedit").first().fill("EDITED INLINE");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const newText = (await page.locator(".rep[data-choice]").first().locator(".rtext").textContent())?.trim() ?? "";
check(
    "double-click edits an option inline and Enter commits the new text",
    inputAppeared === 1 && inputFocused && newText === "EDITED INLINE" && newText !== oldText,
    JSON.stringify({ inputAppeared, inputFocused, oldText, newText }),
);

// After the inline edit commits (Enter), focus returns to the just-edited option row so the arrows keep
// working - the pre-fix regression was that the input blurred to <body> and Up/Down stopped. ArrowDown must
// now move focus/selection to a neighbouring row (a treeitem), not scroll.
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(100);
const afterEditNav = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
        key: a?.getAttribute("data-sid") ?? a?.getAttribute("data-choice") ?? null,
        isRow: a?.getAttribute("role") === "treeitem",
    };
});
check(
    "after an inline edit commits, arrow keys still navigate (focus restored to the edited row)",
    !!afterEditNav.key && afterEditNav.isRow,
    JSON.stringify(afterEditNav),
);

// Inline NPC-line editing: a state's NPC line is a <button> (like the option text) when editable;
// double-click it -> a focused input; type + Enter commits (through DialogGraph.commitEditState -> the
// .msg/.tra or state.text write-back + reproject). Select the owning row first so the docked inspector's
// one-time appearance doesn't reflow the tree mid-double-click (a synthetic-driver artifact; F2 is the
// reflow-immune keyboard path).
await page.goto("file://" + appHtml);
await page.setViewportSize({ width: 900, height: 800 });
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
await page.locator('[role="treeitem"]').first().click();
await page.waitForTimeout(150);
const npcBtn = page.locator('[role="treeitem"]').first().locator(".linebtn").first();
const npcOld = (await npcBtn.textContent())?.trim() ?? "";
await npcBtn.dblclick();
await page.waitForTimeout(150);
const npcInput = await page.locator(".lineedit").count();
const npcFocused = await page.evaluate(() => document.activeElement?.classList.contains("lineedit") ?? false);
await page.locator(".lineedit").first().fill("NPC EDITED INLINE");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const npcNew =
    (await page.locator('[role="treeitem"]').first().locator(".linebtn").first().textContent())?.trim() ?? "";
check(
    "double-click edits a state's NPC line inline and Enter commits the new text",
    npcInput === 1 && npcFocused && npcNew === "NPC EDITED INLINE" && npcNew !== npcOld,
    JSON.stringify({ npcInput, npcFocused, npcOld, npcNew }),
);

// Adding an option drops straight into inline edit: click "+ option" -> a focused input appears for the
// new (empty) option, no extra gesture needed.
await page.goto("file://" + appHtml);
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const repsBeforeAdd = await page.locator(".rep").count();
await page.locator(".addbtn").first().click();
await page.waitForTimeout(200);
const addEdit = await page.evaluate(() => ({
    reps: document.querySelectorAll(".rep").length,
    inputs: document.querySelectorAll(".rtextedit").length,
    focused: document.activeElement?.classList.contains("rtextedit") ?? false,
}));
check(
    "a newly added option opens directly in an inline text input",
    addEdit.reps === repsBeforeAdd + 1 && addEdit.inputs === 1 && addEdit.focused,
    JSON.stringify(addEdit),
);

// Node inline "+": clicking a state row's node-add grows a connected child - a new state (one more
// treeitem) plus a new option here that leads to it, dropping into inline edit on that option's text.
await page.goto("file://" + appHtml);
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const statesBeforeAdd = await page.locator(".st").count();
const firstRow = page.locator(".st").first();
await firstRow.hover();
await firstRow.locator(".addnode").click();
await page.waitForTimeout(250);
const nodeAdd = await page.evaluate(() => ({
    // Count state rows (.st) specifically - option rows are also [role=treeitem] now, so a plain treeitem
    // count would jump by 2 (the new child state AND the new option leading to it).
    states: document.querySelectorAll(".st").length,
    editing: document.activeElement?.classList.contains("rtextedit") ?? false,
}));
check(
    'node "+" adds a connected child state and opens the new option for editing',
    nodeAdd.states === statesBeforeAdd + 1 && nodeAdd.editing,
    JSON.stringify({ before: statesBeforeAdd, ...nodeAdd }),
);

// Node inline "-": clicking an enabled delete on a state row goes through the guarded delete path - a
// state with inbound transitions pops the redirect-to-EXIT confirm rather than silently dropping refs.
await page.goto("file://" + appHtml);
await postModel();
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
const statesBeforeDel = await page.locator(".st").count();
const rowWithDel = page
    .locator(".st")
    .filter({ has: page.locator(".delnode:not([disabled])") })
    .first();
await rowWithDel.hover();
await rowWithDel.locator(".delnode:not([disabled])").click();
await page.waitForTimeout(200);
// A referenced state pops the redirect-to-EXIT confirm; an unreferenced one is removed straight away.
// Either proves the guarded delete path is wired from the tree.
const delOutcome = await page.evaluate(() => ({
    confirm: !!document.querySelector(".confirm"),
    states: document.querySelectorAll(".st").length,
}));
check(
    'node "-" routes through the guarded delete (confirm on inbound refs, else immediate)',
    delOutcome.confirm || delOutcome.states < statesBeforeDel,
    JSON.stringify({ before: statesBeforeDel, ...delOutcome }),
);

// Fail-loud error state: a fresh App that receives {type:"error"} shows the message, not a
// perpetual spinner.
await page.goto("file://" + appHtml);
await page.evaluate(() => window.postMessage({ type: "error", message: "PARSE BOOM 42" }, "*"));
await page.waitForTimeout(150);
const errText = (await page.locator("#app").textContent()) ?? "";
check(
    "an error message renders the fail-loud error state",
    errText.includes("PARSE BOOM 42"),
    JSON.stringify(errText.slice(0, 80)),
);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("no CSP violations", cspViolations.length === 0, cspViolations.join(" | "));

await browser.close();

console.log("wrote " + shot);
console.log("\n=== dialog production-path harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL DIALOG PRODUCTION-PATH ASSERTIONS PASS" : `\n${failed} ASSERTION(S) FAILED`);
if (failed > 0) process.exit(1);
