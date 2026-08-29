/**
 * Layout-thread driver: proves the graph layout does not run on the webview's main thread.
 *
 * elkjs lays out on the CALLING thread unless it is constructed with a real worker - and a companion-sized
 * dialog is a few hundred milliseconds of it, during which the webview cannot paint or take input. That is
 * a browser-only property: node has no `Worker`, so the unit tests (client/test/dialog-layout.test.ts)
 * exercise the inline fallback and cannot see it. This driver is the tier that can.
 *
 * Two checks, because neither alone is enough: a Worker really is constructed (deterministic - it fails
 * outright if the CSP blocks the blob:, or if the factory is dropped), and the main thread's longest
 * uninterrupted block while the graph lays out stays under a frame budget with generous headroom (the
 * observable a user feels, thresholded loosely so a loaded CI box does not flake).
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts               # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render-layout-thread.mts
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import type { DialogModel } from "../../../../../shared/dialog-model";
import { harnessPaths, makeChecker } from "./driver-util";

declare global {
    interface Window {
        /** Installed by this driver before any page script runs; read back after the graph renders. */
        layoutProbe?: {
            /** Workers the page constructed - the layout engine's, if it built one. */
            workers: number;
            /** Longest gap between heartbeat ticks, i.e. how long the main thread was held. */
            maxGap: number;
        };
    }
}

/**
 * States in the generated dialog. Large enough that a synchronous layout is unmissable (elk is a few
 * hundred ms at this size), and shaped as a hub with returning replies rather than a long chain - a deep
 * chain does not render at all today, which is its own defect and not what this driver is measuring.
 */
const STATE_COUNT = 150;

/**
 * The longest main-thread block tolerated across a re-layout.
 *
 * The window covers more than elk: once the layout returns, the main thread rebuilds the node array and
 * Svelte Flow re-renders every card, which is itself ~200 ms at this size. That is real work and a real
 * cost, but it is not what this driver guards - so the threshold sits above it, still far below the ~1900 ms
 * this graph measured when the layout ran inline. A regression to an inline layout fails by a wide margin;
 * the re-render cost is left to whoever takes that on.
 */
const MAX_BLOCK_MS = 400;

/** A hub offering every other state, each returning to it - the shape a busy conversation node really has. */
function bigModel(): DialogModel {
    const leaves = STATE_COUNT - 1;
    const states = [
        {
            id: "hub",
            speaker: "NPC",
            text: "What would you ask of me?",
            choices: Array.from({ length: leaves }, (_, i) => ({
                id: `hub#${i}`,
                text: `Ask about ${i}.`,
                target: { kind: "state" as const, stateId: `s${i}` },
            })),
        },
        ...Array.from({ length: leaves }, (_, i) => ({
            id: `s${i}`,
            speaker: "NPC",
            text: `Line ${i}`,
            choices: [{ id: `s${i}#0`, text: "Back.", target: { kind: "state" as const, stateId: "hub" } }],
        })),
    ];
    return { sourceLang: "d", editable: true, roots: [{ id: "dialog", label: "big", kind: "dialog", states }] };
}

const { appHtml } = harnessPaths(import.meta.url);
const { check, finish } = makeChecker();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const pageErrors: string[] = [];
const cspViolations: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) || /Refused to/i.test(t)) cspViolations.push(t);
});

// Installed before any page script runs, so it sees the layout engine's own Worker construction. The
// heartbeat records the longest gap between ticks, which is exactly how long the main thread was held.
await page.addInitScript(() => {
    const probe = { workers: 0, maxGap: 0 };
    window.layoutProbe = probe;
    const RealWorker = Worker;
    window.Worker = class extends RealWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            probe.workers++;
        }
    };
    let last = performance.now();
    setInterval(() => {
        const now = performance.now();
        if (now - last > probe.maxGap) probe.maxGap = now - last;
        last = now;
    }, 10);
});

await page.goto("file://" + appHtml);

// Get the model in and the graph on screen first. Posting a model also renders the tree outline, and at
// this size that is its own long chunk of main-thread work - measuring across it would say nothing about
// the layout.
await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), bigModel());
await page.waitForSelector('[role="treeitem"]', { timeout: 60_000 });
await page.getByRole("tab", { name: "Graph" }).click();
await page.waitForSelector(".svelte-flow__node", { timeout: 60_000 });

// Re-layout re-runs elk over the graph already on screen and re-renders nothing else, so the window
// between resetting the heartbeat and the button settling is the layout and little besides.
await page.evaluate(() => {
    if (window.layoutProbe) window.layoutProbe.maxGap = 0;
});
await page.getByRole("button", { name: "Re-layout" }).click();
await page.waitForTimeout(3000); // long enough for a synchronous layout of this graph to have finished

const probe = await page.evaluate(() => window.layoutProbe ?? { workers: 0, maxGap: 0 });

check("the layout runs in a real Worker", probe.workers > 0, `${probe.workers} constructed`);
check(
    `re-laying out ${STATE_COUNT} states never blocks the main thread for more than ${MAX_BLOCK_MS}ms`,
    probe.maxGap < MAX_BLOCK_MS,
    `longest block ${probe.maxGap.toFixed(0)}ms`,
);
check("no CSP violation (worker-src must admit the blob:)", cspViolations.length === 0, cspViolations.join(" | "));

await browser.close();
finish(pageErrors);
