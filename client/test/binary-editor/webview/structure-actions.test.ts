import { describe, expect, it } from "vitest";
import { rowActions } from "../../../src/binary-editor/webview/state/structure-actions";

describe("rowActions", () => {
    const caps = { canAdd: true, canModify: true };
    it("disables every action when the section is not modifiable", () => {
        expect(rowActions(2, 5, { canAdd: true, canModify: false })).toEqual({
            insert: false,
            duplicate: false,
            up: false,
            down: false,
            remove: false,
        });
    });
    it("disables up at the first row and down at the last", () => {
        expect(rowActions(0, 3, caps)).toMatchObject({ up: false, down: true });
        expect(rowActions(2, 3, caps)).toMatchObject({ up: true, down: false });
    });
    it("enables insert/duplicate/remove for any modifiable row", () => {
        expect(rowActions(1, 3, caps)).toMatchObject({ insert: true, duplicate: true, remove: true });
    });
    it("disables both directions for a lone entry", () => {
        expect(rowActions(0, 1, caps)).toMatchObject({ up: false, down: false, insert: true, remove: true });
    });
});
