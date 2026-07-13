import { describe, expect, it } from "vitest";
import { type WebviewToHost, isWebviewToHost } from "../src/dialog-editor/webview/messages";
import type { DialogModel } from "../../shared/dialog-model";

// The union must accept every message shape the webview actually posts (main.ts "ready",
// DialogGraph "revealSource"/"edit"/"notify", installFatalErrorHandler "runtimeError").
describe("message contract", () => {
    it("permits the dialog webview->host messages", () => {
        const model = { sourceLang: "weidu-d" } as unknown as DialogModel;
        const msgs: WebviewToHost[] = [
            { type: "ready" },
            { type: "revealSource", offset: 42 },
            { type: "notify", text: "blocked", level: "warn" },
            { type: "notify", text: "done" },
            { type: "edit", model, seq: 3 },
            { type: "edit", model },
            { type: "runtimeError", message: "boom", stack: "at x" },
            { type: "runtimeError", message: "boom" },
        ];
        expect(msgs.map((m) => m.type)).toEqual([
            "ready",
            "revealSource",
            "notify",
            "notify",
            "edit",
            "edit",
            "runtimeError",
            "runtimeError",
        ]);
    });
});

describe("isWebviewToHost (runtime narrowing)", () => {
    it("accepts every valid WebviewToHost variant", () => {
        const valid: unknown[] = [
            { type: "ready" },
            { type: "revealSource", offset: 0 },
            { type: "notify", text: "hi" },
            { type: "notify", text: "hi", level: "warn" },
            { type: "edit", model: { sourceLang: "weidu-d" }, seq: 1 },
            { type: "edit", model: { sourceLang: "weidu-d" } },
            { type: "runtimeError", message: "boom" },
            { type: "runtimeError", message: "boom", stack: "trace" },
        ];
        for (const m of valid) expect(isWebviewToHost(m), JSON.stringify(m)).toBe(true);
    });

    it("rejects non-objects, unknown discriminants, and wrong-typed fields", () => {
        const invalid: unknown[] = [
            null,
            undefined,
            "ready",
            42,
            {},
            { type: 123 },
            { type: "unknown" },
            { type: "revealSource" }, // missing offset
            { type: "revealSource", offset: "42" }, // offset not a number
            { type: "notify" }, // missing text
            { type: "notify", text: 7 }, // text not a string
            { type: "edit" }, // missing model
            { type: "edit", model: "m" }, // model not an object
            { type: "edit", model: { sourceLang: "weidu-d" }, seq: "1" }, // seq not a number
            { type: "runtimeError" }, // missing message
        ];
        for (const m of invalid) expect(isWebviewToHost(m), JSON.stringify(m)).toBe(false);
    });
});
