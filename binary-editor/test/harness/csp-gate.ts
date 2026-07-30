/**
 * Shared page-health gate for all headless harness drivers: CSP violations and uncaught page errors.
 *
 * Install once per Playwright page after the browser is launched. The returned
 * assertNoViolations() function must be called before browser.close(); it logs
 * each captured message and exits non-zero if any were captured.
 *
 * Usage:
 *   const assertNoViolations = installCspGate(page, "MAP");
 *   // ... drive the page ...
 *   assertNoViolations();  // at the end of the run
 *   await browser.close();
 */
import type { Page } from "playwright";

/** True when the console or page-error message text looks like a CSP violation report. */
function isCspViolation(text: string): boolean {
    return /Content Security Policy/i.test(text) || /Refused to/i.test(text);
}

/**
 * Registers CSP-violation listeners on `page` and returns a function that checks
 * whether any violations were captured. The check function logs and exits non-zero
 * on a violation; it is a no-op when the run is clean.
 *
 * @param page - The Playwright page to instrument.
 * @param label - Short driver label used in log messages (e.g. "MAP", "ITM").
 */
export function installCspGate(page: Page, label: string): () => void {
    const violations: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
        const text = msg.text();
        if (isCspViolation(text)) violations.push("[console:" + msg.type() + "] " + text);
    });
    page.on("pageerror", (e) => {
        if (isCspViolation(e.message)) violations.push("[pageerror] " + e.message);
        // An uncaught error fails the run rather than logging it: the usual source is a driver's own
        // waitForFunction predicate throwing, which the `.catch(() => undefined)` convention swallows - the wait
        // silently never happens and every assertion after it still reports green. Two stack frames, since the
        // message alone does not say whether the throw came from the app or from a predicate.
        else pageErrors.push([e.message, ...(e.stack ?? "").split("\n").slice(1, 3)].join("\n    "));
    });

    return function assertNoViolations(): void {
        if (violations.length === 0 && pageErrors.length === 0) {
            console.log("PAGE GATE: no CSP violations, no page errors");
            return;
        }
        for (const m of violations) console.log("  CSP VIOLATION: " + m);
        for (const m of pageErrors) console.log("  PAGE ERROR: " + m);
        console.log("\n" + label + " PAGE GATE FAILED");
        process.exit(1);
    };
}
