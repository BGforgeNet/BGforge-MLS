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
import { installCspGate } from "./csp-gate";
import { shotPath } from "./out-dir";
import { buildBamFixture } from "./image-fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const view = buildBamFixture();

function hostUp(m: WebviewToHost): HostToWebview[] {
    return m.type === "ready" ? [{ type: "init", view }] : [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertNoCsp = installCspGate(page, "BAM");

await page.exposeFunction("__hostUpImage", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
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

await browser.close();

console.log("\n=== BAM render harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL BAM ASSERTIONS PASS" : `\n${failed} BAM ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
