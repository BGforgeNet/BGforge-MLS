/**
 * Unit tests for the bounded init-timeout helper shared by the dialog and binary-editor webviews
 * (client/src/webview-utils.ts). Before this helper existed, the binary editor's App.svelte had no
 * timeout at all - a dropped/failed "init" reply left it on "Loading..." forever (frontend.md: a loading
 * state waiting on an out-of-process reply must carry a bounded timeout). The dialog webview already had
 * an inline 8s timeout in App.svelte; this pulls the timer mechanics out into a pluggable helper both
 * Apps consume, tested here without a Svelte runtime.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installInitTimeout, isBenignWebviewError } from "../src/webview-utils";

describe("isBenignWebviewError", () => {
    // Chromium fires a window `error` event for "ResizeObserver loop completed with undelivered
    // notifications" (and the older "ResizeObserver loop limit exceeded") on ordinary layout churn - a
    // scheduling notice, not an application failure. installFatalErrorHandler must not treat it as fatal
    // (observed live: it blanked the dialog editor webview during the render harness's Duplicate-state
    // flow, which triggers Tree.svelte's tooltip-clip ResizeObserver). A guard that fires on a benign,
    // non-broken page is worse than no guard - see coding.md "A guard that false-positives is worse than
    // no guard".
    test("recognizes both known ResizeObserver-loop notice spellings, with or without the trailing period", () => {
        // The live Chromium wording ("... notifications.") carries a trailing period; the older
        // "limit exceeded" wording observed in some Chromium versions does not - accept both.
        expect(isBenignWebviewError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
        expect(isBenignWebviewError("ResizeObserver loop completed with undelivered notifications")).toBe(true);
        expect(isBenignWebviewError("ResizeObserver loop limit exceeded")).toBe(true);
    });

    test("does not swallow a real error whose message merely mentions ResizeObserver", () => {
        // Demonstrates the guard stays silent ONLY on the two exact known-benign strings, not on any
        // message containing the word "ResizeObserver" (which would mask a genuine bug in observer code).
        expect(isBenignWebviewError("TypeError: cannot read property of undefined in ResizeObserver callback")).toBe(
            false,
        );
    });

    test("does not swallow an unrelated real error", () => {
        expect(isBenignWebviewError("Cannot read properties of undefined (reading 'foo')")).toBe(false);
    });
});

describe("installInitTimeout", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("fires onTimeout after ms elapses when isResolved stays false", () => {
        const onTimeout = vi.fn();
        installInitTimeout({ ms: 8000, isResolved: () => false, onTimeout });

        vi.advanceTimersByTime(7999);
        expect(onTimeout).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test("does not fire onTimeout when isResolved is true at the deadline", () => {
        const onTimeout = vi.fn();
        installInitTimeout({ ms: 8000, isResolved: () => true, onTimeout });

        vi.advanceTimersByTime(8000);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    test("the returned cleanup cancels the pending timer", () => {
        const onTimeout = vi.fn();
        const cleanup = installInitTimeout({ ms: 8000, isResolved: () => false, onTimeout });

        cleanup();
        vi.advanceTimersByTime(8000);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    test("isResolved is evaluated at the deadline, not at install time", () => {
        // Mirrors how the dialog/binary Apps use this: a mutable flag flipped by a message handler between
        // install and the deadline must be read fresh, not captured once up front.
        let resolved = false;
        const onTimeout = vi.fn();
        installInitTimeout({ ms: 8000, isResolved: () => resolved, onTimeout });

        resolved = true;
        vi.advanceTimersByTime(8000);
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
