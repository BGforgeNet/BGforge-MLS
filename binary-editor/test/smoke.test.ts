import { describe, expect, it } from "vitest";
import { parserRegistry } from "@bgforge/binary";

describe("environment", () => {
    it("can reach the binary library from the core package", () => {
        expect(parserRegistry.getByExtension("map")).toBeDefined();
    });
});
