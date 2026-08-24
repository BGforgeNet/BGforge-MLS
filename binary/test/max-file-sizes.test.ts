import { describe, expect, test } from "vitest";
import "../src/index"; // side-effect: registers the bundled parsers
import { MAX_FILE_SIZES } from "../src/max-file-sizes";
import { parserRegistry } from "../src/registry";

/**
 * The CLI's size check is `MAX_FILE_SIZES[ext] !== undefined` - a missing entry does not fall back to a
 * default, it skips the check entirely. Registering a parser without adding its budget therefore silently
 * removes the pre-allocation cap for that extension rather than failing anywhere visible.
 */
describe("MAX_FILE_SIZES", () => {
    test("every registered extension has a size budget", () => {
        const missing = parserRegistry.getExtensions().filter((ext) => MAX_FILE_SIZES[ext] === undefined);
        expect(missing).toEqual([]);
    });

    test("every budget is a positive integer", () => {
        for (const [ext, size] of Object.entries(MAX_FILE_SIZES)) {
            expect(Number.isInteger(size), `${ext} budget is not an integer`).toBe(true);
            expect(size, `${ext} budget is not positive`).toBeGreaterThan(0);
        }
    });
});
