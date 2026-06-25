import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appHtml = path.join(here, "app.html");
const out = process.argv[2] ?? path.join(here, "shot.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors: string[] = [];
page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("file://" + appHtml);
// Wait for Svelte Flow to render the laid-out nodes (async elk layout + mount).
await page.waitForSelector(".svelte-flow__node", { timeout: 10_000 });
await page.waitForTimeout(400);
// Click a card node to exercise selection -> inspector panel.
const card = page.locator(".svelte-flow__node").first();
await card.click();
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();

console.log("wrote " + out);
const nodeCount = errors.length;
if (nodeCount) {
    console.log("console/page errors:\n" + errors.join("\n"));
    process.exitCode = 1;
}
