/**
 * BAM render-harness driver: mounts the real animation-editor webview against a synthetic
 * non-directional fixture (image-fixtures.ts; every sequence's facing is "none", so compass-layout
 * falls back to the cycle grid) and proves the grid renders one tile per sequence, each with its own
 * "Cycle N" label and a distinct color. Never gated on an external corpus - the fixture is in-memory.
 */
import { chromium, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HostToWebview, WebviewToHost } from "../../../client/src/image-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";
import {
    buildBamFixture,
    buildDirectionalBamFixture,
    buildMultiSequenceBamFixture,
    buildRgbaBamFixture,
} from "./image-fixtures";
import { postHarnessWire, toHarnessWire } from "./image-wire";

const here = path.dirname(fileURLToPath(import.meta.url));
const view = buildBamFixture();
// Swapped before the reload below, so the same host stub serves both fixtures.
let currentView = view;

function hostUp(m: WebviewToHost): HostToWebview[] {
    return m.type === "ready" ? [{ type: "init", view: currentView }] : [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertPageClean = installPageGate(page, "BAM");

await page.exposeFunction("__hostUpImage", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) {
        // eslint-disable-next-line no-await-in-loop -- replies must reach the page in order
        await page.evaluate(postHarnessWire, toHarnessWire(reply));
    }
});
await page.goto("file://" + path.join(here, "image-app.html"));
await page.waitForSelector(".cycle-grid canvas", { timeout: 5000 });

const tileCount = await page.locator(".cycle-grid canvas").count();
check(
    "grid: every non-directional sequence renders a tile",
    tileCount === view.sequences.length,
    `count=${tileCount} expected=${view.sequences.length}`,
);

const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".cycle-cell-label"), (el) => el.textContent ?? ""),
);
check(
    "grid: tiles fall back to 'Cycle N' labels (facing 'none' has no compass direction)",
    labels.length === view.sequences.length && labels.every((label) => /^Cycle \d+$/.test(label)),
    JSON.stringify(labels),
);

// Sampled at the canvas center, clear of the marker block in either of its two corner positions (see
// image-fixtures.ts makeFrame), so this reads the sequence's base fill color, not the shared marker white.
const colors = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLCanvasElement>(".cycle-grid canvas"), (canvas) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return "";
        const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        return `${pixel[0]},${pixel[1]},${pixel[2]}`;
    }),
);
check("grid: every sequence renders a distinct color", new Set(colors).size === colors.length, JSON.stringify(colors));

await page.screenshot({ path: shotPath("shot-bam.png"), fullPage: true });

// Multi-sequence fixture: past the >8-cycle threshold the manual grid-columns control must mount,
// seed the grid from the heuristic's suggestion, and re-lay the grid on a manual override.
currentView = buildMultiSequenceBamFixture();
await page.reload();
await page.waitForSelector(".cycle-grid canvas", { timeout: 5000 });

const multiTiles = await page.locator(".cycle-grid canvas").count();
check("multi: all 12 cycles render", multiTiles === 12, `count=${multiTiles}`);

const layoutGroupCount = await page.locator('[aria-label="Cycle layout"]').count();
check("multi: cycle-layout control mounts for >8 cycles", layoutGroupCount === 1, `count=${layoutGroupCount}`);

async function gridColumnCount(): Promise<number> {
    return page.evaluate(() => {
        const grid = document.querySelector(".cycle-grid");
        return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    });
}
const columnsInput = page.getByLabel("Cycle grid columns (0 for auto)");
const seededValue = await columnsInput.inputValue();
check("multi: columns seeded from the 12-cycle suggestion", seededValue === "6", `value=${seededValue}`);
check(
    "multi: grid lays out with the seeded column count",
    (await gridColumnCount()) === 6,
    `tracks=${await gridColumnCount()}`,
);

await columnsInput.fill("4");
await columnsInput.press("Enter");
await page
    .waitForFunction(
        () => {
            const grid = document.querySelector(".cycle-grid");
            return !!grid && getComputedStyle(grid).gridTemplateColumns.split(" ").length === 4;
        },
        undefined,
        { timeout: 3000 },
    )
    .catch(() => undefined);
check(
    "multi: manual column override re-lays the grid",
    (await gridColumnCount()) === 4,
    `tracks=${await gridColumnCount()}`,
);

await page.screenshot({ path: shotPath("shot-bam-multi.png"), fullPage: true });

// Directional fixture (IE base-file fingerprint): the editor must OPEN in the rose layout - the
// detected default - with the layout selector mounted, show one 5-tile direction block, switch blocks
// via the group picker, and flip to the flat grid via the selector.
currentView = buildDirectionalBamFixture();
await page.reload();
await page.waitForSelector(".compass-rose canvas", { timeout: 5000 });

const roseTiles = await page.locator(".compass-rose canvas").count();
check(
    "rose: detected directional BAM opens as a 5-tile rose (west arc of block 0)",
    roseTiles === 5,
    `count=${roseTiles}`,
);

const roseButton = page.getByRole("button", { name: "Rose", exact: true });
check(
    "rose: layout selector mounts with Rose active",
    (await roseButton.count()) === 1 && (await roseButton.getAttribute("aria-pressed")) === "true",
    `pressed=${await roseButton.getAttribute("aria-pressed")}`,
);

async function roseColors(): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLCanvasElement>(".compass-rose canvas"), (canvas) => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return "";
            const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
            return `${pixel[0]},${pixel[1]},${pixel[2]}`;
        }),
    );
}
const block0Colors = await roseColors();
check(
    "rose: the 5 tiles render 5 distinct colors",
    new Set(block0Colors).size === block0Colors.length,
    JSON.stringify(block0Colors),
);

await page.screenshot({ path: shotPath("shot-bam-rose.png"), fullPage: true });

const groupSelect = page.getByLabel("Sequence group");
check("rose: group picker mounts for the 2-block animation", (await groupSelect.count()) === 1, "");
await groupSelect.selectOption({ index: 1 });
await page
    .waitForFunction(
        (before) => {
            const canvas = document.querySelector<HTMLCanvasElement>(".compass-rose canvas");
            const ctx = canvas?.getContext("2d");
            if (!canvas || !ctx) return false;
            const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
            return `${pixel[0]},${pixel[1]},${pixel[2]}` !== before;
        },
        block0Colors[0],
        { timeout: 3000 },
    )
    .catch(() => undefined);
const block1Colors = await roseColors();
check(
    "rose: switching the group re-renders the rose with the other block's cycles",
    (await page.locator(".compass-rose canvas").count()) === 5 &&
        JSON.stringify(block1Colors) !== JSON.stringify(block0Colors),
    `block0=${JSON.stringify(block0Colors)} block1=${JSON.stringify(block1Colors)}`,
);

await page.getByRole("button", { name: "Grid", exact: true }).click();
await page.waitForSelector(".cycle-grid canvas", { timeout: 5000 });
const gridTileCount = await page.locator(".cycle-grid canvas").count();
check(
    "rose->grid: the selector flips to the flat grid with all 16 cycles",
    gridTileCount === 16,
    `count=${gridTileCount}`,
);
const gridControlCount = await page.locator('[aria-label="Cycle layout"]').count();
check(
    "rose->grid: the manual columns control appears in grid mode",
    gridControlCount === 1,
    `count=${gridControlCount}`,
);

await page.screenshot({ path: shotPath("shot-bam-rose-grid.png"), fullPage: true });

// True-colour (BAM v2): the second colour model the editor renders, and the one whose draw path has
// no palette to fall back on. Reading a pixel is what separates a working rgba path from one that
// silently routed through the indexed reader - the tile would still be drawn, just wrong.
currentView = buildRgbaBamFixture();
await page.reload();
await page.waitForSelector(".cycle-grid canvas", { timeout: 5000 });

const rgbaTiles = await page.locator(".cycle-grid canvas").count();
check("rgba: every true-colour cycle renders a tile", rgbaTiles === 4, `count=${rgbaTiles}`);

// Sampled in the top-left quadrant, which the fixture writes at alpha 128, and in the body, which is
// opaque. An indexed read of the same bytes cannot produce this pair.
const rgbaSamples = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLCanvasElement>(".cycle-grid canvas"), (canvas) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return "no-ctx";
        const q = ctx.getImageData(Math.floor(canvas.width * 0.3), Math.floor(canvas.height * 0.3), 1, 1).data;
        const body = ctx.getImageData(Math.floor(canvas.width * 0.7), Math.floor(canvas.height * 0.7), 1, 1).data;
        return `${q[3]}/${body[3]}`;
    }),
);
check(
    "rgba: a partly transparent quadrant keeps its alpha, the body stays opaque",
    rgbaSamples.every((sample) => sample === "128/255"),
    JSON.stringify(rgbaSamples),
);

// A palette control on a format with no palette would offer an edit that could never be stored.
const paletteControls = await page
    .locator('[aria-label="Transparent palette index"], [aria-label="Use external palette"]')
    .count();
check(
    "rgba: no palette control is offered for a format with no palette",
    paletteControls === 0,
    `count=${paletteControls}`,
);

// The frame rate IS offered - a BAM stores none, but retuning playback is the point of the control.
const fpsControls = await page.locator('[aria-label="Frames per second"]').count();
check("rgba: the playback rate stays available", fpsControls === 1, `count=${fpsControls}`);

await page.screenshot({ path: shotPath("shot-bam-truecolour.png"), fullPage: true });

await browser.close();

console.log("\n=== BAM render harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL BAM ASSERTIONS PASS" : `\n${failed} BAM ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
