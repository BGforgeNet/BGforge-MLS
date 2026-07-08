/**
 * Tests for the App.svelte message-handling kernel. App holds {model, error, timedOut}
 * reactive state and is otherwise DOM wiring (covered by the e2e harness); the branching
 * logic - which host message updates what, the reset-on-model, the timeout predicate -
 * lives in this pure module so it gates in pnpm test. These are the bug-3 (fail-loud /
 * never-hang) decisions: a malformed message must not clear a shown error, and "neither
 * model nor error yet" is exactly the timeout condition.
 */

import { describe, expect, test } from "vitest";
import { reduceDialogView, shouldTimeOut, type DialogView } from "../src/dialog-editor/webview/app-messages";
import type { DialogModel } from "../../shared/dialog-model";

const MODEL = { sourceLang: "d", editable: true, roots: [] } as DialogModel;
const EMPTY: DialogView = { model: null, error: null };

describe("reduceDialogView", () => {
    test("a model message sets the model and clears any prior error", () => {
        const next = reduceDialogView({ model: null, error: "stale" }, { type: "model", model: MODEL });
        expect(next).toEqual({ model: MODEL, error: null });
    });

    test("an error message sets the error and keeps the existing model", () => {
        const next = reduceDialogView({ model: MODEL, error: null }, { type: "error", message: "boom" });
        expect(next).toEqual({ model: MODEL, error: "boom" });
    });

    test("a later model message recovers from an error state", () => {
        const afterErr = reduceDialogView(EMPTY, { type: "error", message: "boom" });
        const afterModel = reduceDialogView(afterErr, { type: "model", model: MODEL });
        expect(afterModel).toEqual({ model: MODEL, error: null });
    });

    test("a self-edit re-parse post (reparse:true) is left for DialogGraph, not routed through the prop", () => {
        // The host tags a self-edit's faithful parse `reparse:true`; the root must ignore it so it does not
        // reset the view - DialogGraph adopts it directly, preserving selection / an in-progress inline edit.
        const prev: DialogView = { model: MODEL, error: null };
        const other = { sourceLang: "d", editable: true, roots: [{ id: "x" }] } as unknown as DialogModel;
        expect(reduceDialogView(prev, { type: "model", reparse: true, model: other, seq: 1 })).toEqual(prev);
    });

    test.each([
        ["no type", {}],
        ["unknown type", { type: "ready" }],
        ["model type without a model", { type: "model" }],
        ["error type without a message", { type: "error" }],
        ["not an object", "nope"],
        ["null", null],
    ])("a malformed message (%s) leaves the view unchanged", (_label, data) => {
        const prev: DialogView = { model: MODEL, error: "keep me" };
        // Identity: a junk message must not clear a shown error or model (the never-hang/
        // never-flicker guarantee).
        expect(reduceDialogView(prev, data)).toEqual(prev);
    });
});

describe("shouldTimeOut", () => {
    test("times out only when neither a model nor an error has arrived", () => {
        expect(shouldTimeOut(EMPTY)).toBe(true);
        expect(shouldTimeOut({ model: MODEL, error: null })).toBe(false);
        expect(shouldTimeOut({ model: null, error: "boom" })).toBe(false);
    });
});
