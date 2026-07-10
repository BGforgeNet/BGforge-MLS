/**
 * Edit round-trip driver: the PRODUCTION webview (real App via the real postMessage channel, driven in
 * Chromium) wired to the real host session core (DialogHostCore via fake-host.ts) over an in-memory
 * document - the full emit -> splice -> reparse -> adopt (+ editing overlay) -> .tra flush protocol.
 * This is the only automated tier that exercises that protocol at all (the render/edit-behavior drivers
 * run hostless), and it pins the once-live-only regression chain: a pending option's committed text must
 * reach the .d splice (fresh-parse range anchoring), its emit must never be swallowed,
 * and its minted `@N` must be APPENDED to the .tra, not just rewritten over existing entries.
 * e2e-tier: not part of `pnpm test`. Prereqs: Playwright + a Chromium browser on PATH.
 *
 *   pnpm exec tsx client/src/dialog-editor/test/harness/edit-roundtrip.mts
 */
import { chromium } from "playwright";
import type { DialogModel } from "../../../../../shared/dialog-model";
import { createFakeHost, currentModel } from "./fake-host";
import { harnessPaths, makeChecker, pollUntil } from "./driver-util";

const { appHtml } = harnessPaths(import.meta.url);
const { check, finish } = makeChecker();

// A minimal but real D dialog: one state, one exit option, with the say text resolved from the .tra.
const D_SOURCE = `BEGIN ~roundtrip~

IF ~~ THEN BEGIN start
  SAY @0
  IF ~~ THEN EXIT
END
`;
const TRA_SOURCE = `@0 = ~Hello there.~\n`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const host = await createFakeHost({
    documentPath: "/roundtrip.d",
    docText: D_SOURCE,
    traText: TRA_SOURCE,
    postToWebview: (msg) => void page.evaluate((m) => window.postMessage(m, "*"), msg),
});

// Count of webview->host "edit" messages, to assert emit hygiene (no echo storm) after settling.
let editCount = 0;

// The webview's outbound channel: host.ts captures acquireVsCodeApi at bundle init, so the init script
// (which runs before page scripts) provides it, forwarding into the Node-side core via the binding.
await page.exposeFunction("__hostPost", (msg: unknown) => {
    const m = msg as { type?: string; model?: DialogModel; seq?: number };
    if (m?.type === "ready") host.core.handleReady();
    else if (m?.type === "edit" && m.model) {
        editCount++;
        host.core.handleEdit(m.model, m.seq ?? 0);
    }
    // revealSource/notify are vscode-surface concerns; the protocol under test does not need them.
});
// A string, not a function: tsx's esbuild transform decorates a serialized function with a `__name`
// helper that does not exist inside the page, so the injected acquireVsCodeApi would THROW on first
// call - and host.ts's try/catch turns that into a silent hasHost()===false (no ready, no emits).
await page.addInitScript("window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__hostPost(m) });");

await page.goto("file://" + appHtml);

// The ready handshake itself is under test: main.ts posts {type:"ready"}, the core parses and posts the
// model, App mounts the tree with the .tra text joined.
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
check(
    "ready handshake: model arrives and the .tra say text renders",
    await page.evaluate(() => document.body.textContent?.includes("Hello there.") ?? false),
);

/** Add an option on the first state via the context menu and commit `text` in the inline editor. */
async function addOptionWithText(text: string): Promise<void> {
    await page.locator(".st[data-sid]").first().click({ button: "right" });
    await page.waitForSelector(".ctxitem", { timeout: 5000 });
    await page.locator(".ctxitem", { hasText: "Add option" }).first().click();
    const input = page.locator("input.rtextedit").first();
    await input.waitFor({ timeout: 5000 });
    await input.fill(text);
    await input.press("Enter");
}

// --- The regression chain: + option -> type -> Enter -> the .d gains the spliced option and the .tra
// gains the minted entry. The structural emit fires while the inline editor is OPEN, the text commit
// fires after - the exact live sequence that once lost the text.
await addOptionWithText("Round trip works.");
check(
    "committed option is spliced into the .d with a minted @N",
    await pollUntil(() => /\+\+ @1 EXIT/.test(host.doc.text)),
    JSON.stringify(host.doc.text),
);
check(
    "minted @N text is APPENDED to the .tra by the debounced flush",
    await pollUntil(() => host.tra.text.includes("@1 = ~Round trip works.~")),
    JSON.stringify(host.tra.text),
);
check("existing .tra entries survive the flush byte-for-byte", host.tra.text.startsWith(TRA_SOURCE));

// --- Multi-invocation: a second option against the state the first sequence just mutated. The carried-over
// state (fresh ids, new ranges from the reparse) is exactly where stale-range anchoring used to break.
await addOptionWithText("Second option here.");
check(
    "second option splices with the next id against the mutated document",
    await pollUntil(() => /\+\+ @2 EXIT/.test(host.doc.text)),
    JSON.stringify(host.doc.text),
);
check(
    "second minted entry appends too",
    await pollUntil(() => host.tra.text.includes("@2 = ~Second option here.~")),
    JSON.stringify(host.tra.text),
);
check(
    "first option is spliced exactly once (no pending re-splice duplicate)",
    (host.doc.text.match(/\+\+ @1 EXIT/g) ?? []).length === 1,
    JSON.stringify(host.doc.text),
);

// --- The editing overlay: an adopt lands while the inline editor is open with an uncommitted draft.
// The pending option has EMPTY model text, so its structural emit is a deliberate no-op splice (the
// writer defers empty pending options - no `++ ~~ EXIT` husk) and the adopted parse cannot contain it:
// the webview must carry the row AND the DOM draft across the adopt (the job the old reconcile branch
// existed for). The adopt is driven the external-edit way (a plain same-file model post through App).
await page.locator(".st[data-sid]").first().click({ button: "right" });
await page.waitForSelector(".ctxitem", { timeout: 5000 });
await page.locator(".ctxitem", { hasText: "Add option" }).first().click();
const overlayInput = page.locator("input.rtextedit").first();
await overlayInput.waitFor({ timeout: 5000 });
await overlayInput.fill("Overlay draft");
// Let the structural emit fire (250ms debounce) and round-trip: it must NOT splice a husk.
await new Promise((r) => setTimeout(r, 700));
check("an empty pending option does not splice a `++ ~~` husk", !host.doc.text.includes("~~ EXIT"), host.doc.text);
// External same-file adopt while the draft is open (what a text-side edit does in production).
await page.evaluate((m) => window.postMessage({ type: "model", model: m }, "*"), currentModel(host, "roundtrip"));
await new Promise((r) => setTimeout(r, 400));
check(
    "inline editor survives the adopt with its draft intact",
    (await page.locator("input.rtextedit").count()) === 1 &&
        (await page.locator("input.rtextedit").inputValue()) === "Overlay draft",
    `value=${JSON.stringify(
        await page
            .locator("input.rtextedit")
            .inputValue()
            .catch(() => "(gone)"),
    )}`,
);
check(
    "the draft input keeps focus across the adopt",
    await page.evaluate(() => document.activeElement?.classList.contains("rtextedit") ?? false),
);
await page.locator("input.rtextedit").first().press("End");
await page.keyboard.type(" survives.");
await page.locator("input.rtextedit").first().press("Enter");
check(
    "the draft commits after the adopt: .d gains the option, .tra its text",
    (await pollUntil(() => /\+\+ @3 EXIT/.test(host.doc.text))) &&
        (await pollUntil(() => host.tra.text.includes("@3 = ~Overlay draft survives.~"))),
    JSON.stringify(host.tra.text),
);

// --- Emit hygiene: once everything settles, no further edits may fire (an echo loop would keep the
// count climbing: model post -> emit -> reparse -> emit -> ...).
await host.core.drainEdits();
const settledCount = editCount;
await new Promise((r) => setTimeout(r, 900)); // > EMIT_DEBOUNCE_MS + flush debounce
check("no echo loop: edit count stable after settling", editCount === settledCount, `edits=${editCount}`);
check("no host-side errors surfaced", host.errors.length === 0, host.errors.join(" | "));

await browser.close();
finish(pageErrors);
