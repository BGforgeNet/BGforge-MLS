import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

describe("binaryEditor-webview source", () => {
    it("routes update and validation messages by fieldId before display path", () => {
        const source = fs.readFileSync(path.resolve("client/src/editors/binaryEditor-webview.ts"), "utf8");

        expect(source).toContain("updateField(msg.fieldId, msg.displayValue, msg.rawValue);");
        expect(source).toContain("showFieldError(msg.fieldId ?? msg.fieldPath, msg.message);");
    });

    it("rejects postMessage events from foreign origins", () => {
        // CodeQL js/missing-origin-check: the message handler must guard against
        // messages from origins other than the webview itself. VSCode delivers
        // host-to-webview messages with origin === globalThis.origin.
        const source = fs.readFileSync(path.resolve("client/src/editors/binaryEditor-webview.ts"), "utf8");
        expect(source).toContain("event.origin !== globalThis.origin");
    });
});
