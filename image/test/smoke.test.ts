import { describe, expect, it } from "vitest";
import { IMAGE_LIB_VERSION } from "@bgforge/image";

describe("@bgforge/image", () => {
    it("exports a version", () => {
        expect(IMAGE_LIB_VERSION).toBe("0.1.0");
    });
});
