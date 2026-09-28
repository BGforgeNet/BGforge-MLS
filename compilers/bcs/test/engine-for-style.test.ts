import { describe, expect, test } from "vitest";
import { bcsEngineForScriptStyle, type BcsEngine } from "@bgforge/bcs";

describe("bcsEngineForScriptStyle", () => {
    // The two Baldur's Gate styles share one object layout; every other style is its own engine.
    test.each<[Parameters<typeof bcsEngineForScriptStyle>[0], BcsEngine]>([
        ["bg1", "bg"],
        ["bg2", "bg"],
        ["iwd1", "iwd"],
        ["iwd2", "iwd2"],
        ["pst", "pst"],
    ])("reads a %s install as the %s engine", (style, engine) => {
        expect(bcsEngineForScriptStyle(style)).toBe(engine);
    });
});
