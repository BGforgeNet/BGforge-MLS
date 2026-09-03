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
 * It also covers the webview's own stall reporting (`observeSlowFrames`), which needs a browser for the same
 * reason: node has no long-task entry type. That check drives the observer SEAM rather than waiting for a
 * real stall: the re-render this graph provokes was the trigger until 2026-09-03, when it came in under
 * `SLOW_FRAME_MS` on CI and the check failed on a machine where nothing was wrong. How long a re-render
 * takes is a property of the box, so asserting on it tests the box; the wiring the check exists for -
 * long-task entry to `report` to `postToHost` to the host - is driven directly instead.
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts               # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render-layout-thread.mts
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import type { DialogModel } from "../../../../../shared/dialog-model";
import { SLOW_FRAME_MS } from "../../../webview-utils";
import { harnessPaths, makeChecker } from "./driver-util";

declare global {
    interface Window {
        /** Installed by this driver before any page script runs; read back after the graph renders. */
        layoutProbe?: {
            /** Workers the page constructed - the layout engine's, if it built one. */
            workers: number;
            /** Longest gap between heartbeat ticks, i.e. how long the main thread was held. */
            maxGap: number;
            /** Durations the webview itself reported to the host as slow frames. */
            slowFrames: number[];
            /** Every message type the webview posted up, in order - what a silent run is diagnosed from. */
            posts: string[];
        };
        /** Delivers a synthetic long-task entry to whatever the bundle registered for `longtask`. */
        __injectLongTask?: (durationMs: number) => void;
        /** Whether the REAL PerformanceObserver accepted the `longtask` entry type in this browser. */
        __realLongTaskObserved?: boolean;
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

/**
 * The duration of the synthetic long task fed to the observer seam. Clear of `SLOW_FRAME_MS` so a run that
 * reports nothing means the wiring is broken, never that the value sat on the threshold - and asserted back
 * exactly, which is what proves the reported number is the entry's own duration rather than a constant.
 */
const INJECTED_STALL_MS = SLOW_FRAME_MS + 100;

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
    const probe = { workers: 0, maxGap: 0, slowFrames: [] as number[], posts: [] as string[] };
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

// The observer seam. `observeSlowFrames` takes `globalThis.PerformanceObserver` by default, so replacing it
// before the bundle runs is how a driver reaches the seam its docstring describes. It WRAPS the real
// observer rather than standing in for it - genuine long tasks still flow, and `__realLongTaskObserved`
// records whether this browser accepted the entry type at all, which is the half a synthetic entry cannot
// prove. Injected as SOURCE for the same reason as the host below.
await page.addInitScript(`(() => {
    const Real = window.PerformanceObserver;
    const longTaskCallbacks = [];
    window.__realLongTaskObserved = false;
    window.PerformanceObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.real = Real ? new Real(callback) : undefined;
        }
        observe(options) {
            const types = (options && options.entryTypes) || [];
            if (types.indexOf("longtask") !== -1) longTaskCallbacks.push(this.callback);
            if (!this.real) return;
            try {
                this.real.observe(options);
                if (types.indexOf("longtask") !== -1) window.__realLongTaskObserved = true;
            } catch (e) {
                // An engine that does not implement the entry type throws rather than ignoring it. Swallowed
                // so the wiring under test still runs; __realLongTaskObserved is what records the refusal.
            }
        }
        disconnect() { if (this.real) this.real.disconnect(); }
    };
    window.__injectLongTask = (durationMs) => {
        const list = { getEntries: () => [{ duration: durationMs, entryType: "longtask", name: "self" }] };
        for (const callback of longTaskCallbacks) callback(list);
    };
})();`);

// A fake host, installed before host.ts takes the handle at bundle init: the webview's stall reports are
// outbound messages, so with no host to receive them there is nothing to observe. Injected as SOURCE, not a
// function: this file is transpiled, and a transpiled function carries a `__name` helper the page does not
// have - the resulting throw is swallowed by host.ts's try/catch and leaves the webview silently hostless.
await page.addInitScript(`window.acquireVsCodeApi = () => ({ postMessage: (m) => {
    window.layoutProbe.posts.push(String(m && m.type));
    if (m && m.type === "slowFrame") window.layoutProbe.slowFrames.push(m.ms);
} });`);

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

// Drive the seam: one synthetic long task, delivered to whatever the bundle registered for `longtask`. The
// callback and the post it makes are synchronous, so the probe carries the result by the time this returns.
await page.evaluate((ms) => window.__injectLongTask?.(ms), INJECTED_STALL_MS);
const realLongTaskObserved = await page.evaluate(() => window.__realLongTaskObserved === true);

const probe = await page.evaluate(() => window.layoutProbe ?? { workers: 0, maxGap: 0, slowFrames: [], posts: [] });

check("the layout runs in a real Worker", probe.workers > 0, `${probe.workers} constructed`);
check(
    `re-laying out ${STATE_COUNT} states never blocks the main thread for more than ${MAX_BLOCK_MS}ms`,
    probe.maxGap < MAX_BLOCK_MS,
    `longest block ${probe.maxGap.toFixed(0)}ms`,
);
// Two halves, because a synthetic entry cannot prove the first: that this browser reports long tasks at all,
// and that an entry over the threshold reaches the host carrying its own duration.
check(
    "the browser accepts the longtask entry type (the observer is really subscribed)",
    realLongTaskObserved,
    realLongTaskObserved
        ? "observe() accepted longtask"
        : "nothing subscribed to longtask - either the call was dropped or the engine refused the entry type",
);
check(
    "the webview reports its own stalls to the host",
    probe.slowFrames.includes(INJECTED_STALL_MS),
    probe.slowFrames.includes(INJECTED_STALL_MS)
        ? `reported ${probe.slowFrames.map((ms) => `${ms}ms`).join(", ")}`
        : `expected ${INJECTED_STALL_MS}ms; got [${probe.slowFrames.join(", ")}] and the webview posted ${probe.posts.join(", ") || "nothing at all"}`,
);
check("no CSP violation (worker-src must admit the blob:)", cspViolations.length === 0, cspViolations.join(" | "));

await browser.close();
finish(pageErrors);
