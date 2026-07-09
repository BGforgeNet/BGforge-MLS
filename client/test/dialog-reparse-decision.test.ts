/**
 * Tests for the re-parse decision kernel (DialogGraph's onReparse routing). The listener's ordering
 * rules - stale-seq drop, editing-open draft preservation, wholesale adopt - previously lived inline
 * in the component and were guarded only by the manual e2e harness; the pure kernel gates them in
 * pnpm test the same way app-messages.ts gates the root's message routing.
 */

import { describe, expect, test } from "vitest";
import { decideReparse } from "../src/dialog-editor/webview/reparse-decision";
import type { DialogModel } from "../../shared/dialog-model";

const MODEL = { sourceLang: "d", editable: true, roots: [] } as DialogModel;
const ALLOC = { "opt-1": "@42" };
const MSGS = { "@42": "hello" };

describe("decideReparse", () => {
    test("adopts a matching-seq re-parse wholesale when no inline edit is open", () => {
        const d = decideReparse(
            { type: "model", reparse: true, model: MODEL, seq: 3, allocations: ALLOC, messages: MSGS },
            3,
            false,
        );
        expect(d).toEqual({ kind: "adopt", model: MODEL, allocations: ALLOC, messages: MSGS });
    });

    test("reconciles in place (allocations only) while an inline edit is open, defaulting allocations to {}", () => {
        const withAlloc = decideReparse(
            { type: "model", reparse: true, model: MODEL, seq: 3, allocations: ALLOC },
            3,
            true,
        );
        expect(withAlloc).toEqual({ kind: "reconcile", allocations: ALLOC, messages: undefined });
        const withoutAlloc = decideReparse({ type: "model", reparse: true, model: MODEL, seq: 3 }, 3, true);
        expect(withoutAlloc).toEqual({ kind: "reconcile", allocations: {}, messages: undefined });
    });

    test("drops a stale re-parse whose seq is behind the latest emit (a newer optimistic edit supersedes it)", () => {
        expect(decideReparse({ type: "model", reparse: true, model: MODEL, seq: 2 }, 3, false)).toEqual({
            kind: "ignore",
        });
        expect(decideReparse({ type: "model", reparse: true, model: MODEL, seq: 2 }, 3, true)).toEqual({
            kind: "ignore",
        });
    });

    test("ignores everything that is not a well-formed re-parse (plain models are App's, not this listener's)", () => {
        expect(decideReparse({ type: "model", model: MODEL, seq: 3 }, 3, false)).toEqual({ kind: "ignore" });
        expect(decideReparse({ type: "model", reparse: true, seq: 3 }, 3, false)).toEqual({ kind: "ignore" });
        expect(decideReparse({ type: "edit", reparse: true, model: MODEL, seq: 3 }, 3, false)).toEqual({
            kind: "ignore",
        });
        expect(decideReparse(null, 3, false)).toEqual({ kind: "ignore" });
    });
});
