import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

type AssetCacheEntry = {
    extensionPath: string;
    html?: string;
    js?: string;
};

const assetCache = new Map<string, AssetCacheEntry>();

function loadAsset(extensionPath: string, relativePath: string): string {
    const fullPath = path.join(extensionPath, relativePath);
    return fs.readFileSync(fullPath, "utf8");
}

function getCacheEntry(cacheKey: string, extensionPath: string): AssetCacheEntry {
    const cached = assetCache.get(cacheKey);
    if (cached && cached.extensionPath === extensionPath) {
        return cached;
    }

    const entry: AssetCacheEntry = { extensionPath };
    assetCache.set(cacheKey, entry);
    return entry;
}

export function getCachedHtmlAsset(cacheKey: string, extensionPath: string, relativePath: string): string {
    const cacheEntry = getCacheEntry(cacheKey, extensionPath);
    if (!cacheEntry.html) {
        cacheEntry.html = loadAsset(extensionPath, relativePath);
    }
    return cacheEntry.html;
}

export function getCachedJsAsset(cacheKey: string, extensionPath: string, relativePath: string): string {
    const cacheEntry = getCacheEntry(cacheKey, extensionPath);
    if (!cacheEntry.js) {
        cacheEntry.js = loadAsset(extensionPath, relativePath);
    }
    return cacheEntry.js;
}

/**
 * Generate a base64 nonce for a webview's CSP. The webviews lock their inline
 * <style>/<script> to a fresh per-load nonce; 16 random bytes is the standard
 * width.
 */
export function generateNonce(): string {
    return randomBytes(16).toString("base64");
}

/**
 * Inline a bundled script into an HTML template at the `/* __SCRIPT__ *​/` placeholder and stamp the CSP nonce.
 *
 * The script MUST be supplied as a *function* replacement so it is inlined verbatim. A plain string replacement
 * lets `String.prototype.replace` interpret `$$`/`$&`/`` $` ``/`$'` inside the bundle as special patterns, silently
 * mutating the inlined code. The minified production bundle contains a `$&` sequence, which expands to the matched
 * placeholder text - splicing `/* __SCRIPT__ *​/` into the JS, producing a syntax error so the webview script never
 * parses and the panel renders blank (the original symptom; the un-minified dev bundle lacks `$&` and so masked it).
 * `$$` (hundreds in Svelte 5 output) collapses to `$`, and `` $` ``/`$'` splice surrounding HTML. Inlining verbatim
 * removes the hazard. The nonce is base64 (no `$`), so its replaceAll is safe as a plain string.
 */
export function inlineWebviewScript(html: string, script: string, nonce: string): string {
    return html.replace("/* __SCRIPT__ */", () => script).replaceAll("{{nonce}}", nonce);
}
