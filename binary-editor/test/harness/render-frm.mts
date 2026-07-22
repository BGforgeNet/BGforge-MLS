/**
 * FRM render-harness driver: mounts the real animation-editor webview against a synthetic 6-facing
 * fixture (image-fixtures.ts - never gated on the external/fallout corpus, so this always renders) and
 * proves the compass rose renders one tile per facing, the three background modes switch, and a zoom
 * change WHILE PAUSED actually redraws every tile rather than leaving it blank (a prior zoom-while-paused
 * regression in FrameCanvas.svelte).
 */
import { chromium, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HostToWebview, WebviewToHost } from "../../../client/src/image-editor/webview/messages";
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";
import { buildFrmFixture, TILE_SIZE } from "./image-fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const view = buildFrmFixture();

function hostUp(m: WebviewToHost): HostToWebview[] {
    return m.type === "ready" ? [{ type: "init", view }] : [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "FRM");

await page.exposeFunction("__hostUpImage", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});
await page.goto("file://" + path.join(here, "image-app.html"));
await page.waitForSelector(".compass-rose canvas", { timeout: 5000 });

const tileCount = await page.locator(".compass-rose canvas").count();
check("compass: all 6 facing tiles render", tileCount === 6, `count=${tileCount}`);

// Sampled at the canvas center, clear of the marker block in either of its two corner positions (see
// image-fixtures.ts makeFrame), so this reads the sequence's base fill color, not the shared marker white.
async function tileColors(): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLCanvasElement>(".compass-rose canvas"), (canvas) => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return "";
            const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
            return `${pixel[0]},${pixel[1]},${pixel[2]}`;
        }),
    );
}
const defaultColors = await tileColors();
check(
    "compass: every direction renders a distinct color",
    new Set(defaultColors).size === defaultColors.length,
    JSON.stringify(defaultColors),
);

await page.screenshot({ path: shotPath("shot-frm-transparent.png"), fullPage: true });

async function selectBackground(label: string): Promise<void> {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    const pressed = await button.getAttribute("aria-pressed");
    check(`background: ${label} activates`, pressed === "true", `aria-pressed=${pressed}`);
}

await selectBackground("Checkered");
await page.screenshot({ path: shotPath("shot-frm-checkered.png"), fullPage: true });

await selectBackground("Green");
await page.screenshot({ path: shotPath("shot-frm-green.png"), fullPage: true });

// Zoom-redraw regression: the player is paused (the default playback state - no autoplay was started),
// so nothing else drives a redraw. Bump the zoom and confirm the tile canvas resized AND repainted.
await page.selectOption('select[aria-label="Zoom level"]', "4");
await page
    .waitForFunction(
        (expected) => {
            const canvas = document.querySelector<HTMLCanvasElement>(".compass-rose canvas");
            return !!canvas && canvas.width === expected;
        },
        TILE_SIZE * 4,
        { timeout: 3000 },
    )
    .catch(() => undefined);

const zoomed = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".compass-rose canvas");
    if (!canvas) return { width: 0, height: 0, hasOpaquePixel: false, distinctColors: 0 };
    const ctx = canvas.getContext("2d");
    if (!ctx) return { width: canvas.width, height: canvas.height, hasOpaquePixel: false, distinctColors: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hasOpaquePixel = false;
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) > 0) {
            hasOpaquePixel = true;
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        }
    }
    return { width: canvas.width, height: canvas.height, hasOpaquePixel, distinctColors: colors.size };
});
check(
    "zoom: tile canvas resizes to the new zoom level",
    zoomed.width === TILE_SIZE * 4 && zoomed.height === TILE_SIZE * 4,
    `${zoomed.width}x${zoomed.height}`,
);
check(
    "zoom: tile canvas redraws while paused, not left blank (zoom-while-paused regression)",
    zoomed.hasOpaquePixel && zoomed.distinctColors >= 2,
    JSON.stringify(zoomed),
);

// The stage scrolls internally (`.stage { overflow: auto }` inside a fixed-height flex column), so
// `fullPage` alone would crop the third tile row at 4x zoom - grow the viewport first so everything fits.
await page.setViewportSize({ width: 1280, height: 1400 });
await page.screenshot({ path: shotPath("shot-frm-zoomed.png"), fullPage: true });

await browser.close();

console.log("\n=== FRM render harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL FRM ASSERTIONS PASS" : `\n${failed} FRM ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
