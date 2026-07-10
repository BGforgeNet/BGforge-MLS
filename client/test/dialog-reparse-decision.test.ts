/**
 * Tests for the re-parse decision kernel (DialogGraph's onReparse routing). The listener's ordering
 * rules - stale-seq drop, wholesale adopt - previously lived inline in the component and were guarded
 * only by the manual e2e harness; the pure kernel gates them in pnpm test the same way app-messages.ts
 * gates the root's message routing. An open inline edit no longer changes the routing: every accepted
 * reparse adopts, and the draft survives via adoptModel's overlay (exercised by the edit-roundtrip
 * harness driver, since it is DOM behavior).
 */

import { describe, expect, test } from "vitest";
import { decideReparse } from "../src/dialog-editor/webview/reparse-decision";
import type { DialogModel } from "../../shared/dialog-model";

const MODEL = { sourceLang: "d", editable: true, roots: [] } as DialogModel;
const ALLOC = { "opt-1": "@42" };
const MSGS = { "@42": "hello" };

describe("decideReparse", () => {
    test("adopts a matching-seq re-parse wholesale, carrying allocations and messages", () => {
        const d = decideReparse(
            { type: "model", reparse: true, model: MODEL, seq: 3, allocations: ALLOC, messages: MSGS },
            3,
        );
        expect(d).toEqual({ kind: "adopt", model: MODEL, allocations: ALLOC, messages: MSGS });
    });

    test("drops a stale re-parse whose seq is behind the latest emit (a newer optimistic edit supersedes it)", () => {
        expect(decideReparse({ type: "model", reparse: true, model: MODEL, seq: 2 }, 3)).toEqual({
            kind: "ignore",
        });
    });

    test("ignores everything that is not a well-formed re-parse (plain models are App's, not this listener's)", () => {
        expect(decideReparse({ type: "model", model: MODEL, seq: 3 }, 3)).toEqual({ kind: "ignore" });
        expect(decideReparse({ type: "model", reparse: true, seq: 3 }, 3)).toEqual({ kind: "ignore" });
        expect(decideReparse({ type: "edit", reparse: true, model: MODEL, seq: 3 }, 3)).toEqual({
            kind: "ignore",
        });
        expect(decideReparse(null, 3)).toEqual({ kind: "ignore" });
    });
});
