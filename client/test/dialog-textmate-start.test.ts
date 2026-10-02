/**
 * Starting the dialog webview's tokenizer when it cannot start. Its own file because the regex engine's wasm
 * loads once per process: a file that has already started the tokenizer reuses it, and the failure is gone.
 */

import { describe, expect, it, vi } from "vitest";
import { startTextmate } from "../src/dialog-editor/webview/highlight/textmate";

describe("starting the tokenizer", () => {
    // Colouring is an enhancement: a failed start must reach the reader as a notice, never as the unhandled
    // rejection that the webview's fatal-error handler turns into a blank panel.
    it("reports a failed start through its callback instead of rejecting", async () => {
        const reported: string[] = [];
        const notWasm = new Uint8Array([0, 1, 2, 3]);

        startTextmate(
            notWasm,
            [],
            { baf: "source.weidu-baf", ssl: "source.fallout-ssl", ts: "source.dialog-tsexpr" },
            (r) => reported.push(r),
        );

        await vi.waitFor(() => expect(reported).toHaveLength(1));
        expect(reported[0]).toContain("expected magic word");
    });
});
