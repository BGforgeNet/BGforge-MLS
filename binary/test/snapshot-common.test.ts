import { describe, expect, it } from "vitest";
import { parseScalarFieldValue } from "../src/snapshot-common";
import type { ParsedField } from "../src/types";

describe("snapshot-common", () => {
    it("parses MAP presentation values through stable field keys instead of display paths", () => {
        const field: ParsedField = {
            name: "Rotation",
            value: "NE",
            offset: 0,
            size: 4,
            type: "enum",
        };

        expect(parseScalarFieldValue("map", "map.objects.elevations[].objects[].base.rotation", field)).toBe(0);
    });
});
