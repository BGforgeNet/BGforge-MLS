/**
 * Theme-comparison driver: renders the production dialog-editor webview once with the harness's
 * baked-in Dark+ fallback (see build.mts) and once with the Light+ fallback (theme-vars.ts) injected
 * over it via page.addStyleTag(), so a themed color regression - a re-introduced hardcoded hex, a
 * component left unthemed - is visible in a light theme, not just the dark one every other driver
 * exercises. Screenshots both to repo tmp/ for manual pixel review.
 *
 * e2e-tier, run out of process (not under pnpm test):
 *   pnpm exec tsx client/src/dialog-editor/test/harness/build.mts               # rebuild app.html
 *   pnpm exec tsx client/src/dialog-editor/test/harness/render-theme-compare.mts # this driver
 * Prereqs (environment, not repo deps): Playwright + a Chromium browser on PATH.
 */

import { chromium } from "playwright";
import path from "node:path";
import { REAL_MODEL } from "./real-model";
import { LIGHT_THEME_VARS } from "./theme-vars";
import { harnessPaths, makeChecker } from "./driver-util";

const { appHtml, outDir } = harnessPaths(import.meta.url);
const darkShot = path.join(outDir, "dialog-harness-dark.png");
const lightShot = path.join(outDir, "dialog-harness-light.png");

const { check, finish } = makeChecker();

const browser = await chromium.launch();
const pageErrors: string[] = [];
const cspViolations: string[] = [];

async function render(shot: string, lightOverride: boolean): Promise<string> {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    page.on("pageerror", (e) => pageErrors.push(`[${lightOverride ? "light" : "dark"}] ${String(e)}`));
    page.on("console", (m) => {
        const t = m.text();
        if (/Content Security Policy/i.test(t) || /Refused to/i.test(t))
            cspViolations.push(`[${lightOverride ? "light" : "dark"}] ${t}`);
    });
    await page.goto("file://" + appHtml);
    // A later <style> tag with an equal-specificity :root selector wins the cascade, so this overrides
    // every --vscode-* fallback build.mts baked in without needing a second app.html build.
    if (lightOverride) await page.addStyleTag({ content: LIGHT_THEME_VARS });
    await page.evaluate((model) => window.postMessage({ type: "model", model }, "*"), REAL_MODEL);
    await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".dialog-graph")!).backgroundColor);
    await page.screenshot({ path: shot });
    await page.close();
    return bg;
}

const darkBg = await render(darkShot, false);
const lightBg = await render(lightShot, true);

// rgb(30, 30, 30) = --vscode-editor-background Dark+ default (#1e1e1e); rgb(255, 255, 255) = Light+ (#ffffff).
check("dark render uses the Dark+ editor background", darkBg === "rgb(30, 30, 30)", `got ${darkBg}`);
check("light render uses the Light+ editor background", lightBg === "rgb(255, 255, 255)", `got ${lightBg}`);
check("light override actually changed the rendered background", darkBg !== lightBg, `dark=${darkBg} light=${lightBg}`);

await browser.close();

finish([...pageErrors, ...cspViolations], `Dark screenshot: ${darkShot}\nLight screenshot: ${lightShot}`);
