import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase64, receiveDialogAssets } from "../src/dialog-editor/webview/dialog-assets";

/** A message target the test fires events at, standing in for the webview's window. */
function target() {
    const listeners = new Set<(e: MessageEvent) => void>();
    return {
        addEventListener: (_type: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
        removeEventListener: (_type: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
        fire: (data: unknown, origin = globalThis.origin) => {
            for (const fn of listeners) fn({ data, origin } as MessageEvent);
        },
        listening: () => listeners.size,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("receiveDialogAssets", () => {
    it("resolves with the host's assets message and stops listening", async () => {
        const t = target();
        const received = receiveDialogAssets(t, 1000);

        t.fire({ type: "model", model: {} });
        t.fire({ type: "assets", elkWorker: "self.onmessage = null;", onigWasm: "AGFzbQ==" });

        await expect(received).resolves.toEqual({
            type: "assets",
            elkWorker: "self.onmessage = null;",
            onigWasm: "AGFzbQ==",
        });
        expect(t.listening()).toBe(0);
    });

    // The page's own origin is the host's; anything else posting into the frame is not.
    it("ignores an assets message from another origin", async () => {
        vi.useFakeTimers();
        const t = target();
        const received = receiveDialogAssets(t, 1000);

        t.fire({ type: "assets", elkWorker: "x", onigWasm: "" }, "https://elsewhere.example");
        vi.advanceTimersByTime(1000);

        await expect(received).rejects.toThrow("sent no layout/colouring assets within 1s");
    });

    it("ignores a message missing either payload", async () => {
        vi.useFakeTimers();
        const t = target();
        const received = receiveDialogAssets(t, 1000);

        t.fire({ type: "assets", elkWorker: "x" });
        vi.advanceTimersByTime(1000);

        await expect(received).rejects.toThrow("within 1s");
        expect(t.listening()).toBe(0);
    });
});

describe("decodeBase64", () => {
    it("returns the bytes the host encoded", () => {
        const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 255, 128]);
        expect(decodeBase64(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
    });
});
