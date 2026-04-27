/**
 * `findEditableField` is the binary-package gate every editor surface must
 * route field edits through. It walks the parsed tree by JSON-encoded segment
 * path and returns the leaf field only when no enclosing group carries
 * `editingLocked: true`. Edits targeting fields inside a locked subtree
 * receive `undefined` and must not be applied; the parser couldn't fully
 * decode the surrounding record, so width-preserving field changes are not
 * interpretation-preserving.
 */

import { describe, expect, it } from "vitest";
import { findEditableField } from "../src/field-edit-policy";
import type { ParsedField, ParsedGroup } from "../src/types";

function field(name: string, value = 0): ParsedField {
    return { name, value, rawValue: value, offset: 0, size: 4, type: "uint32" };
}

function fieldId(segments: readonly string[]): string {
    return JSON.stringify(segments);
}

describe("findEditableField", () => {
    const tree: ParsedGroup = {
        name: "Root",
        fields: [
            {
                name: "Globals",
                fields: [field("Var 0", 1), field("Var 1", 2)],
            },
            {
                name: "Object 0.60 (Scenery)",
                editingLocked: true,
                fields: [field("PID", 0x02000020), field("Tile", 12345), field("Inventory Header", 0)],
            },
            {
                name: "Object 0.59 (Misc)",
                fields: [field("PID", 0x05000000), field("Tile", 99)],
            },
        ],
    };

    it("returns the field for unlocked paths", () => {
        const f = findEditableField(tree, fieldId(["Globals", "Var 1"]));
        expect(f?.name).toBe("Var 1");
        expect(f?.rawValue).toBe(2);
    });

    it("returns undefined for fields inside an editingLocked group", () => {
        expect(findEditableField(tree, fieldId(["Object 0.60 (Scenery)", "PID"]))).toBeUndefined();
        expect(findEditableField(tree, fieldId(["Object 0.60 (Scenery)", "Tile"]))).toBeUndefined();
    });

    it("propagates lock to nested groups", () => {
        const nested: ParsedGroup = {
            name: "Outer",
            editingLocked: true,
            fields: [{ name: "Inner", fields: [field("Locked Field", 7)] }],
        };
        expect(findEditableField(nested, fieldId(["Outer", "Inner", "Locked Field"]))).toBeUndefined();
    });

    it("treats sibling unlocked groups independently", () => {
        const f = findEditableField(tree, fieldId(["Object 0.59 (Misc)", "Tile"]));
        expect(f?.rawValue).toBe(99);
    });

    it("returns undefined for malformed fieldIds", () => {
        expect(findEditableField(tree, "not-json")).toBeUndefined();
        expect(findEditableField(tree, JSON.stringify({ not: "an array" }))).toBeUndefined();
        expect(findEditableField(tree, JSON.stringify(["does", "not", "exist"]))).toBeUndefined();
    });
});
