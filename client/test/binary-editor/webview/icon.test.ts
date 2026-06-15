import { describe, expect, it } from "vitest";
import { codiconClass } from "../../../src/binary-editor/webview/components/icon-name";

describe("codicon mapping", () => {
    it("maps a name to the codicon class", () => {
        expect(codiconClass("add")).toBe("codicon codicon-add");
    });

    it("produces the codicon- prefix format for any input, including unknown names", () => {
        // codiconClass is a pure string template: `codicon codicon-${name}`.
        // There is no validation - unknown names are passed through as-is so
        // VS Code can render them (or show a blank glyph) rather than the
        // extension throwing. Verify the format contract holds for an unknown name.
        expect(codiconClass("unknown-glyph-xyz")).toBe("codicon codicon-unknown-glyph-xyz");
    });
});
