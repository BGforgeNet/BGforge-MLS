/**
 * Unit tests for handlers/rename-suppression.ts -- rename-affected URI tracker.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenameSuppression } from "../../src/handlers/rename-suppression";
import { normalizeUri } from "../../src/core/normalized-uri";

const uriA = normalizeUri("file:///a.ssl");
const uriB = normalizeUri("file:///b.ssl");
const uriC = normalizeUri("file:///c.ssl");

// The safety timeout is an internal constant (RENAME_SUPPRESS_MS = 3000) documented in the
// module's header comment; it is not exported, so the tests pin the documented value directly.
const RENAME_SUPPRESS_MS = 3000;

describe("createRenameSuppression", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("isAffected returns false for a URI that was never marked", () => {
        const suppression = createRenameSuppression();
        expect(suppression.isAffected(uriA)).toBe(false);
    });

    it("markAffected tracks every URI in the given iterable", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA, uriB]);
        expect(suppression.isAffected(uriA)).toBe(true);
        expect(suppression.isAffected(uriB)).toBe(true);
        expect(suppression.isAffected(uriC)).toBe(false);
    });

    it("markAffected replaces the previous set rather than unioning it", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);
        suppression.markAffected([uriB]);
        expect(suppression.isAffected(uriA)).toBe(false);
        expect(suppression.isAffected(uriB)).toBe(true);
    });

    it("consumeAffected removes the URI and returns true when it was tracked", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);
        expect(suppression.consumeAffected(uriA)).toBe(true);
        expect(suppression.isAffected(uriA)).toBe(false);
    });

    it("consumeAffected returns false when the URI was never tracked", () => {
        const suppression = createRenameSuppression();
        expect(suppression.consumeAffected(uriA)).toBe(false);
    });

    it("consuming one URI leaves sibling URIs from the same markAffected call tracked", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA, uriB]);
        suppression.consumeAffected(uriA);
        expect(suppression.isAffected(uriA)).toBe(false);
        expect(suppression.isAffected(uriB)).toBe(true);
    });

    it("isAffected does not consume -- repeated calls keep returning true", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);
        expect(suppression.isAffected(uriA)).toBe(true);
        expect(suppression.isAffected(uriA)).toBe(true);
    });

    it("the safety timer clears the tracked set after RENAME_SUPPRESS_MS with no consume", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);

        vi.advanceTimersByTime(RENAME_SUPPRESS_MS - 1);
        expect(suppression.isAffected(uriA)).toBe(true);

        vi.advanceTimersByTime(1);
        expect(suppression.isAffected(uriA)).toBe(false);
    });

    it("markAffected resets the safety timer instead of letting the earlier one fire", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);

        vi.advanceTimersByTime(2000);
        suppression.markAffected([uriB]);

        // 2000ms after the second mark: total elapsed since the first mark would be 4000ms
        // (past the 3000ms window) if the timer had NOT been reset by the second markAffected.
        vi.advanceTimersByTime(2000);
        expect(suppression.isAffected(uriB)).toBe(true);

        // 3000ms after the second mark -- now the reset timer fires.
        vi.advanceTimersByTime(1000);
        expect(suppression.isAffected(uriB)).toBe(false);
    });

    it("dispose() clears the timer and the tracked set", () => {
        const suppression = createRenameSuppression();
        suppression.markAffected([uriA]);

        suppression.dispose();

        expect(suppression.isAffected(uriA)).toBe(false);
        // The pending safety timer must have been cancelled, not merely superseded --
        // advancing well past RENAME_SUPPRESS_MS must not throw or resurrect state.
        expect(() => vi.advanceTimersByTime(RENAME_SUPPRESS_MS * 2)).not.toThrow();
        expect(suppression.isAffected(uriA)).toBe(false);
    });

    it("dispose() is a no-op-safe call when nothing was ever marked (no pending timer)", () => {
        const suppression = createRenameSuppression();
        expect(() => suppression.dispose()).not.toThrow();
        expect(suppression.isAffected(uriA)).toBe(false);
    });
});
