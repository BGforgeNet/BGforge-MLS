/**
 * Remapping a failure's position from the bundle back to the file the author wrote.
 *
 * Everything after bundling reads one concatenated text, so a line a transpiler reports is a line of
 * that text. Reported as-is against the source it would point at whatever happens to sit there.
 */
import { describe, it, expect } from "vitest";
import { TranspileError } from "../common/transpile-error";
import type { SourcePosition } from "../common/line-map";

const ORIGINS: Array<SourcePosition | undefined> = [
    { file: "/w/main.ts", line: 0 },
    { file: "/w/main.ts", line: 4 },
    undefined,
    { file: "/w/helper.ts", line: 2 },
];

describe("TranspileError.remap", () => {
    it("reports the file and line the author wrote, not the one in the bundle", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 2 });
        const remapped = TranspileError.remap(error, ORIGINS);
        expect(remapped).toBeInstanceOf(TranspileError);
        expect((remapped as TranspileError).location).toEqual({ file: "/w/main.ts", line: 5 });
    });

    it("names the imported file a bundled line came from", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 4 });
        const remapped = TranspileError.remap(error, ORIGINS) as TranspileError;
        expect(remapped.location.file).toBe("/w/helper.ts");
        expect(remapped.location.line).toBe(3);
    });

    it("drops a line the bundle cannot account for rather than pointing at the wrong one", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 3 });
        const remapped = TranspileError.remap(error, ORIGINS) as TranspileError;
        expect(remapped.location.line).toBeUndefined();
        expect(remapped.location.file).toBe("/w/main.tssl");
    });

    it("drops a line past the end of the bundle", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 99 });
        const remapped = TranspileError.remap(error, ORIGINS) as TranspileError;
        expect(remapped.location.line).toBeUndefined();
    });

    it("drops a column, which belongs to the bundle and means nothing in another file", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 2, column: 17 });
        const remapped = TranspileError.remap(error, ORIGINS) as TranspileError;
        expect(remapped.location.column).toBeUndefined();
    });

    it("keeps the message and the original error as the cause", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl", line: 2 });
        const remapped = TranspileError.remap(error, ORIGINS) as TranspileError;
        expect(remapped.message).toBe("bad call");
        expect(remapped.cause).toBe(error);
    });

    it("leaves an error that carries no line alone", () => {
        const error = new TranspileError("bad call", { file: "/w/main.tssl" });
        expect(TranspileError.remap(error, ORIGINS)).toBe(error);
    });

    it("leaves a plain Error alone, so the pipeline still wraps it with what it knows", () => {
        const error = new Error("boom");
        expect(TranspileError.remap(error, ORIGINS)).toBe(error);
    });
});
