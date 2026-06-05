import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

type AssetCacheEntry = {
    extensionPath: string;
    html?: string;
    css?: string;
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

export function getCachedCssAsset(cacheKey: string, extensionPath: string, relativePaths: readonly string[]): string {
    const cacheEntry = getCacheEntry(cacheKey, extensionPath);
    if (!cacheEntry.css) {
        cacheEntry.css = relativePaths.map((relativePath) => loadAsset(extensionPath, relativePath)).join("\n");
    }
    return cacheEntry.css;
}

export function getCachedJsAsset(cacheKey: string, extensionPath: string, relativePath: string): string {
    const cacheEntry = getCacheEntry(cacheKey, extensionPath);
    if (!cacheEntry.js) {
        cacheEntry.js = loadAsset(extensionPath, relativePath);
    }
    return cacheEntry.js;
}

/**
 * Generate a base64 nonce for a webview's CSP. Both webviews lock their inline
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
 * mutating the inlined code. Svelte 5 / esbuild output contains hundreds of `$$` identifiers (`$$props`,
 * `$$anchor`, ...): a string replacement collapses every `$$` to `$`. That particular mutation happens to stay
 * self-consistent (every occurrence is rewritten the same way) so it does not currently break execution, but
 * `$&`/`` $` ``/`$'` - or a future `$$`-vs-`$` identifier collision - would corrupt the script for real. Inlining
 * verbatim removes the hazard entirely. The nonce is base64 (no `$`), so its replaceAll is safe as a plain string.
 */
export function inlineWebviewScript(html: string, script: string, nonce: string): string {
    return html.replace("/* __SCRIPT__ */", () => script).replaceAll("{{nonce}}", nonce);
}
