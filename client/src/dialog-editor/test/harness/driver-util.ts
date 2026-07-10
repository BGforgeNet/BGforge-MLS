/**
 * Shared plumbing for the harness driver scripts (render.mts / render-search.mts / edit-behavior.mts):
 * app.html resolution with a fail-loud missing-bundle guard, the repo-level tmp/ output dir, and the
 * PASS/FAIL check accumulator + end-of-run report each driver previously carried as its own copy.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the generated app.html and the screenshot output dir for a driver. app.html is a build
 * artifact (gitignored, not committed), so a fresh checkout must build it before driving; failing
 * here with the build command beats Playwright's opaque net::ERR_FILE_NOT_FOUND.
 */
export function harnessPaths(importMetaUrl: string): { appHtml: string; outDir: string } {
    const here = path.dirname(fileURLToPath(importMetaUrl));
    const appHtml = path.join(here, "app.html");
    if (!existsSync(appHtml)) {
        console.error(
            "app.html not found - it is a generated bundle (gitignored). Build it first:\n" +
                "  pnpm exec tsx client/src/dialog-editor/test/harness/build.mts",
        );
        process.exit(1);
    }
    // Runtime artefacts go under the repo-level tmp/, never the source tree (project convention).
    const outDir = path.resolve(here, "../../../../../tmp");
    mkdirSync(outDir, { recursive: true });
    return { appHtml, outDir };
}

/** Parse a WeiDU `.tra` (`@N = ~text~`, optional trailing `[SOUND]`) into a {N: text} map. */
export function parseTra(text: string): Record<string, string> {
    const messages: Record<string, string> = {};
    const re = /@(\d+)\s*=\s*~([\s\S]*?)~/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        messages[m[1]!] = m[2]!.trim();
    }
    return messages;
}

/**
 * Poll `cond` until it returns true or `timeoutMs` elapses; returns the final outcome instead of
 * throwing so a driver can feed it straight into a PASS/FAIL check line.
 */
export async function pollUntil(cond: () => boolean, timeoutMs = 5000, stepMs = 50): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (cond()) return true;
        await new Promise((r) => setTimeout(r, stepMs));
    }
    return cond();
}

/**
 * PASS/FAIL accumulator shared by the drivers. `finish` prints every check line, appends any
 * collected page errors, and exits non-zero when anything failed.
 */
export function makeChecker(): {
    check: (label: string, ok: boolean, detail?: string) => void;
    finish: (pageErrors?: string[], note?: string) => never;
} {
    const results: Array<{ line: string; ok: boolean }> = [];
    function check(label: string, ok: boolean, detail = ""): void {
        results.push({ line: `${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`, ok });
    }
    function finish(pageErrors: string[] = [], note = ""): never {
        for (const r of results) console.log(r.line);
        if (pageErrors.length > 0) {
            console.log("\nPAGE ERRORS:");
            for (const e of pageErrors) console.log("  " + e);
        }
        const failed = results.filter((r) => !r.ok).length + pageErrors.length;
        console.log(
            `\n${failed === 0 ? "OK" : "FAILED"}: ${results.length} checks, ${failed} problem(s).${note ? " " + note : ""}`,
        );
        process.exit(failed === 0 ? 0 : 1);
    }
    return { check, finish };
}
