/**
 * Production-path render driver for a compiled dialog whose tree spans several files.
 *
 * A `.dlg` conversation routinely hands off to another dialog and is handed back, so the editor loads the
 * neighbours alongside the file being edited and draws them in ONE graph. This drives that model through the
 * real App root and the real `postMessage` channel, and checks what only a render can answer: that the
 * neighbour's states are drawn as cards (not external stubs), that the round trip closes onto a card, that the
 * foreign cards are marked, and that no tab strip splits the conversation up again.
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts          # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render-dlg-tree.mts
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import path from "node:path";
import { modelFromDlgs, type DlgModelInput } from "../../../../../shared/dialog-model-dlg";
import { harnessPaths, makeChecker } from "./driver-util";

const { appHtml, outDir } = harnessPaths(import.meta.url);
const shot = process.argv[2] ?? path.join(outDir, "dlg-tree-shot.png");

const { check, finish } = makeChecker();

/** A reply going somewhere, in the shape the DLG adapter takes. */
function reply(text: number, nextDialog: string, nextState: number): DlgModelInput["transitions"][number] {
    return {
        text,
        journalText: 0,
        triggerIndex: -1,
        actionIndex: -1,
        nextDialog,
        nextState,
        hasText: true,
        hasTrigger: false,
        hasAction: false,
        hasJournalEntry: false,
        terminatesDialog: false,
    };
}

/** The dialog being edited: state 0 offers a local reply and a hand-off to VICONIA. */
const main: DlgModelInput = {
    resref: "MINSC",
    states: [
        { text: 100, firstTransition: 0, transitionCount: 2, triggerIndex: 0 },
        { text: 101, firstTransition: 2, transitionCount: 0, triggerIndex: -1 },
    ],
    transitions: [
        { ...reply(200, "", 1), triggerIndex: 0, hasTrigger: true, actionIndex: 0, hasAction: true },
        reply(201, "VICONIA", 0),
    ],
    stateTriggers: ["NumTimesTalkedTo(0)"],
    transitionTriggers: ['Global("boo","GLOBAL",1)'],
    actions: ['SetGlobal("boo","GLOBAL",2)'],
};

/** The neighbour, whose own reply goes back into MINSC - the out-and-back shape. */
const neighbour: DlgModelInput = {
    resref: "VICONIA",
    states: [{ text: 300, firstTransition: 0, transitionCount: 1, triggerIndex: -1 }],
    transitions: [reply(400, "MINSC", 1)],
    stateTriggers: [],
    transitionTriggers: [],
    actions: [],
};

const model = {
    ...modelFromDlgs(main, [{ dlg: neighbour, include: [0] }]),
    messages: {
        "100": "Go for the eyes, Boo! GO FOR THE EYES!",
        "101": "Minsc will remember this.",
        "200": "Steady on, ranger.",
        "201": "What does Viconia say?",
        "300": "The surface holds no love for me.",
        "400": "Come back to Minsc.",
    },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto("file://" + appHtml);
await page.evaluate((m) => window.postMessage({ type: "model", model: m }, "*"), model);
await page.getByRole("tab", { name: "Graph" }).click();
await page.waitForSelector(".svelte-flow__node", { timeout: 10_000 });

const cards = await page.locator(".svelte-flow__node .card").count();
check("every state of both dialogs is drawn as a card", cards === 3, `cards=${cards}`);

const foreign = await page.locator(".svelte-flow__node .card.foreign").count();
check("the neighbour's state is marked as belonging to another dialog", foreign === 1, `foreign=${foreign}`);

const chip = (await page.locator(".card.foreign .rmark.foreign").first().textContent())?.trim() ?? "";
check("the foreign card names the dialog it belongs to", chip === "VICONIA", JSON.stringify(chip));

// A hand-off that resolves is an edge between two cards; an unresolved one would be a `.ext` stub instead.
const stubs = await page.locator(".svelte-flow__node .ext").count();
check("no hand-off is left as a dead-end stub", stubs === 0, `stubs=${stubs}`);

const edges = await page.locator(".svelte-flow__edge").count();
check("the round trip closes: three replies, three edges", edges === 3, `edges=${edges}`);

const tabs = await page.locator(".tabbar .tab").count();
check("one conversation, not one tab per file", tabs === 0, `tabs=${tabs}`);

// Selecting the neighbour's card must offer no control that would write a file this editor did not open.
await page.locator(".card.foreign").first().click();
const note = (await page.locator(".ronote").first().textContent())?.trim() ?? "";
check("the inspector says why the neighbour cannot be edited", /belongs to/i.test(note), JSON.stringify(note));
const pick = await page.locator("button.pickstr").count();
const detach = await page.getByRole("button", { name: "Detach state" }).count();
check("no string picker or detach on a foreign state", pick === 0 && detach === 0, `pick=${pick} detach=${detach}`);

const tgt = page.locator("select.tgt").first();
check("the foreign state's reply cannot be retargeted", await tgt.isDisabled(), "target select enabled");

// The code fields on a state this editor cannot write stay locked, and say why in the right terms.
const foreignTrigger = page.locator(".inspector textarea.ta").first();
check("a foreign state's trigger is locked", await foreignTrigger.isDisabled(), "foreign trigger enabled");
const foreignReason = (await foreignTrigger.getAttribute("title")) ?? "";
check(
    "and the reason names the other dialog rather than read-only",
    /another dialog/i.test(foreignReason) && !/read-only/i.test(foreignReason),
    JSON.stringify(foreignReason),
);

const heads = await page.locator(".svelte-flow__node .card .who").allTextContents();
check(
    "each card is headed by its own dialog, not by the file that is open",
    heads.includes("VICONIA - VICONIA:0"),
    JSON.stringify(heads),
);

// A compiled dialog holds its trigger, condition and action as TEXT and the save path writes an edited one
// back, so the file-wide "not free text" flag - which is about its LINES being strrefs - must not lock them.
await page.locator(".svelte-flow__node .card:not(.foreign)").first().click({ force: true });

const stateTrigger = page.locator(".inspector textarea.ta").first();
check("a compiled state's own trigger can be typed into", await stateTrigger.isEnabled(), "trigger disabled");
check(
    "the trigger shows the text the file holds",
    (await stateTrigger.inputValue()) === "NumTimesTalkedTo(0)",
    JSON.stringify(await stateTrigger.inputValue()),
);

const codeFields = await page.locator(".inspector textarea.ta").all();
const codeStates = await Promise.all(codeFields.map((f) => f.isEnabled()));
check(
    "its replies' conditions and actions are editable too",
    codeFields.length >= 3 && codeStates.every(Boolean),
    `fields=${codeFields.length} enabled=${codeStates.filter(Boolean).length}`,
);

// The number IS the address other dialogs hold, so this field must refuse rather than silently drop the edit.
const idField = page.locator(".inspector input.iv.code").first();
check("a compiled state's number cannot be renamed", await idField.isDisabled(), "id field enabled");
const idReason = (await idField.getAttribute("title")) ?? "";
check(
    "and it says the number is the address, not that the file is read-only",
    /number/i.test(idReason) && !/read-only/i.test(idReason),
    JSON.stringify(idReason),
);

// Weight is a `.d` construct; an always-empty box invites an edit with nowhere to go.
const weight = await page.locator(".inspector .wcol").count();
check("no weight field on a compiled dialog", weight === 0, `wcol=${weight}`);

// The second reply hands off to VICONIA:0, which the tree holds and the writer can store (it writes that
// file's resref). A picker listing only the open file's states shows the hand-off as an EMPTY selection.
const handoff = page.locator(".inspector select.tgt").nth(1);
check(
    "a reply into another dialog shows that dialog's state as its target",
    (await handoff.inputValue()) === "state:VICONIA:0",
    JSON.stringify(await handoff.inputValue()),
);
const targetOptions = await handoff.locator("option").allTextContents();
check(
    "and the picker offers the states of every dialog in the tree",
    targetOptions.some((t) => t.includes("VICONIA:0")) && targetOptions.some((t) => t.includes("MINSC:1")),
    JSON.stringify(targetOptions),
);

const removes = await page.locator(".inspector .trbtns button.del").count();
check("a reply carrying a trigger can still be removed", removes === 2, `removes=${removes}`);

await page.locator(".svelte-flow__node .card:not(.foreign)").first().click({ force: true });
await page.screenshot({ path: shot, fullPage: false });
console.log(`screenshot: ${shot}`);

await browser.close();
finish(pageErrors);
