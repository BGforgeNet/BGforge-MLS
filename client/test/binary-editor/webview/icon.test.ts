import { describe, expect, it } from "vitest";
import { codiconClass } from "../../../src/binary-editor/webview/components/icon-name";

describe("codicon mapping", () => {
    it("maps a name to the codicon class", () => {
        expect(codiconClass("add")).toBe("codicon codicon-add");
    });
});
