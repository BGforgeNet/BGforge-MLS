/**
 * MAP partial-decode banner harness pass.
 *
 * Opens a map whose object tail could not be fully decoded (arcaves - the parser bails to an `objects-tail`
 * opaque range), and asserts the editor shows the non-blocking "partially decoded" warning banner above the
 * content (rather than silently presenting fewer objects).
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { installCspGate } from "./csp-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../client/testFixture/maps/arcaves.map");
const mapBytes = new Uint8Array(fs.readFileSync(FIXTURE));

let sessionId = "";
function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: mapBytes });
        if (r.type === "opened") {
            sessionId = r.result.sessionId;
            return [{ type: "init", open: r.result }];
        }
        return [];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({ type: "getChildren", sessionId, nodeId: m.nodeId, start: m.start, end: m.end });
        if (r.type === "children") {
            return [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }];
        }
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const assertNoCsp = installCspGate(page, "MAP-banner");
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) await page.evaluate((rr) => window.postMessage(rr, "*"), reply);
});

await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root", { timeout: 5000 });
await page.waitForTimeout(150);

const banner = await page.evaluate(() => {
    const b = document.querySelector(".banner.warning");
    if (!b) return null;
    return {
        summary: b.querySelector(".banner-summary")?.textContent ?? "",
        items: Array.from(b.querySelectorAll("li"), (e) => e.textContent ?? ""),
    };
});

check("a partial-decode warning banner is shown", banner !== null, JSON.stringify(banner));
if (banner) {
    check("banner summarises the partial decode", /partial/i.test(banner.summary), banner.summary);
    check(
        "banner lists the truncated object range",
        banner.items.some((t) => /could not be fully decoded/i.test(t)),
        JSON.stringify(banner.items),
    );
}

await page.screenshot({ path: path.join(here, "shot-map-banner.png"), fullPage: false });
await browser.close();

console.log("\n=== MAP banner harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL MAP BANNER ASSERTIONS PASS" : `\n${failed} MAP BANNER ASSERTIONS FAILED`);
assertNoCsp();
if (failed > 0) process.exit(1);
