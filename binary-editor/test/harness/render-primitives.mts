/**
 * Primitives showcase + CSP gate (the bits-ui adoption de-risk).
 *
 * Builds the showcase bundle (Showcase.svelte -> Select wrapper -> bits-ui) with esbuild-svelte, writes a
 * standalone HTML page that enforces the SAME strict CSP as the real binary-editor webview - with a real
 * nonce applied to the inlined <script> and <style> - then loads it in Chromium. It captures browser console
 * messages and page errors, renders the Select, programmatically opens it (clicks the trigger, waits for the
 * listbox content), and asserts that NO CSP-violation message appeared. On success it prints PRIMITIVES CSP OK
 * and the screenshot path; on any CSP violation it prints the offending messages and exits non-zero.
 *
 * CSP de-risk result (bits-ui@2.15.0, esbuild-svelte@0.9.5 default css: "external"):
 *   - bits-ui's Select.Viewport ships a component <style> block. With css: "external" (the production
 *     default) that CSS is emitted to a separate file the webview does not load, so NO non-nonced <style>
 *     element is injected -> no CSP violation. (With css: "injected" the same CSS would be injected as a
 *     non-nonced <style> at runtime and IS refused under style-src 'nonce-...' - so do not use "injected".)
 *   - bits-ui's floating positioning (Content/Viewport) is applied via element.style.* CSSOM mutations,
 *     which CSP does not govern, plus a few static inline style= attributes that did not trip the policy.
 * Net: bits-ui Select renders AND opens with zero CSP violations under the strict nonce CSP, provided the
 * bundle uses css: "external" (default) and the component CSS file stays unloaded - exactly the production
 * shape. This gate keeps that guarantee honest by failing if any CSP violation reappears.
 */
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Bundle the showcase (production-faithful: esbuild-svelte default css: "external"). ----
// Component <style> blocks (e.g. bits-ui's Select.Viewport) are emitted to a SEPARATE .css file that the
// production binary-editor webview does NOT load - provider.ts inlines only styles.css + codicons into nonced
// <style> tags. We deliberately leave the emitted component CSS unloaded here to mirror that. External-css
// requires an on-disk output path, so we build to a temp dir (write: false errors on the fake-css import).
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-primitives-"));
await build({
    entryPoints: [path.join(here, "showcase-main.ts")],
    bundle: true,
    format: "iife",
    write: true,
    outdir,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true } })],
});
const js = fs.readFileSync(path.join(outdir, "showcase-main.js"), "utf8");

const css = fs.readFileSync(path.join(here, "../../../client/src/binary-editor/webview/styles.css"), "utf8");

// VS Code Dark+ fallbacks for the --vscode-* vars the theme (and .bb-select* block) consume, so the showcase
// renders themed outside the real webview. Same set build.mjs uses.
const rootVars = `:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
    --vscode-font-size: 13px;
    --vscode-editor-font-family: "Droid Sans Mono", "monospace", monospace;
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-panel-border: #2b2b2b;
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
}
.showcase-root { padding: 1rem; }`;

// ---- Assemble the page with the REAL strict CSP and a real nonce on every nonced tag ----
const nonce = crypto.randomBytes(16).toString("base64");
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
${rootVars}
${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

const htmlPath = path.join(here, "showcase.html");
fs.writeFileSync(htmlPath, html);
console.log("wrote showcase.html (" + (html.length / 1024).toFixed(0) + " kb)");

// ---- Drive it under Chromium, capturing console + page errors ----
const cspMessages: string[] = [];
const isCspViolation = (text: string): boolean => /Content Security Policy/i.test(text) || /Refused to/i.test(text);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 480 } });

page.on("console", (msg) => {
    const text = msg.text();
    if (isCspViolation(text)) cspMessages.push("[console:" + msg.type() + "] " + text);
});
page.on("pageerror", (e) => {
    if (isCspViolation(e.message)) cspMessages.push("[pageerror] " + e.message);
    else console.log("[pageerror]", e.message);
});

await page.goto("file://" + htmlPath);

// The Select trigger renders as a button with our wrapper class.
await page.waitForSelector(".bb-select-trigger", { timeout: 5000 });

// ---- Open the Select: click the trigger, wait for the listbox content to appear ----
await page.locator(".bb-select-trigger").click();
await page.waitForSelector(".bb-select-content", { timeout: 5000 });
await page.waitForSelector(".bb-select-item", { timeout: 5000 });
const itemCount = await page.locator(".bb-select-item").count();
await page.waitForTimeout(150);

await page.screenshot({ path: path.join(here, "shot-primitives.png") });

// Diagnostic: enumerate elements carrying a style attribute and any injected <style> tags, to attribute
// the CSP violation to the precise source (inline style= attribute vs JS-injected <style> element).
const diag = await page.evaluate(() => {
    const styled = Array.from(document.querySelectorAll("[style]")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute("class") ?? "",
        style: el.getAttribute("style") ?? "",
    }));
    const styleTags = Array.from(document.querySelectorAll("style")).map((el) => ({
        nonce: (el as HTMLStyleElement).nonce || "(none)",
        head: (el.textContent ?? "").slice(0, 60),
    }));
    // Did the inline positioning style actually APPLY to CSSOM, or was it blocked? Read computed position
    // of the floating wrapper (bits-ui sets position:fixed + a transform inline).
    const floatWrap = document.querySelector(".bb-select-content")?.parentElement;
    const applied = floatWrap
        ? {
              position: getComputedStyle(floatWrap).position,
              transform: getComputedStyle(floatWrap).transform,
          }
        : null;
    return { styled, styleTags, applied };
});
console.log("\n[diag] elements with style= attribute:");
for (const s of diag.styled) console.log("  <" + s.tag + ' class="' + s.cls + '"> style="' + s.style + '"');
console.log("[diag] <style> tags present:");
for (const s of diag.styleTags) console.log("  nonce=" + s.nonce + " :: " + s.head);
console.log("[diag] floating wrapper computed (did inline style apply?):", JSON.stringify(diag.applied));

await browser.close();

// ---- Verdict ----
console.log("\n=== Primitives CSP gate ===");
console.log("rendered trigger + opened content; visible items: " + itemCount);
if (cspMessages.length > 0) {
    console.log("\nCSP VIOLATION(S) detected:");
    for (const m of cspMessages) console.log("  " + m);
    console.log("\nPRIMITIVES CSP FAILED");
    process.exit(1);
}
console.log("\nPRIMITIVES CSP OK");
console.log("screenshot: " + path.join(here, "shot-primitives.png"));
