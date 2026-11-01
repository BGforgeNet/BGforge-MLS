/**
 * Unit tests for the engine procedure documentation the plugin appends to hovers.
 */

import { describe, expect, it } from "vitest";
import { type QuickInfoLike, appendEngineProcDoc } from "../src/engine-proc-hover";

describe("appendEngineProcDoc", () => {
    function makePart(kind: string, text: string) {
        return { kind, text };
    }

    function makeQuickInfo(
        displayParts: readonly { kind: string; text: string }[],
        documentation?: readonly { kind: string; text: string }[],
    ): QuickInfoLike {
        return { displayParts, documentation };
    }

    it("returns undefined when info is undefined", () => {
        expect(appendEngineProcDoc(undefined, undefined)).toBeUndefined();
    });

    it("returns info unchanged when displayParts is undefined", () => {
        const info = makeQuickInfo([]);
        expect(appendEngineProcDoc(info, undefined)).toBe(info);
    });

    it("returns info unchanged when no functionName/localName part", () => {
        const parts = [makePart("keyword", "function")];
        const info = makeQuickInfo(parts);
        expect(appendEngineProcDoc(info, parts)).toBe(info);
    });

    it("returns info unchanged for non-engine procedure names", () => {
        const parts = [makePart("functionName", "my_custom_func")];
        const info = makeQuickInfo(parts);
        expect(appendEngineProcDoc(info, parts)).toBe(info);
    });

    it("appends documentation for engine procedure", () => {
        const parts = [makePart("functionName", "start")];
        const info = makeQuickInfo(parts);
        const result = appendEngineProcDoc(info, parts);
        expect(result).not.toBe(info);
        expect(result?.documentation).toHaveLength(1);
        expect(result?.documentation?.[0]?.kind).toBe("text");
        expect(result?.documentation?.[0]?.text).toContain("engine");
    });

    it("appends to existing documentation", () => {
        const parts = [makePart("functionName", "start")];
        const existingDoc = [makePart("text", "existing doc")];
        const info = makeQuickInfo(parts, existingDoc);
        const result = appendEngineProcDoc(info, parts);
        expect(result?.documentation).toHaveLength(2);
        expect(result?.documentation?.[0]?.text).toBe("existing doc");
    });

    it("matches localName parts", () => {
        const parts = [makePart("localName", "start")];
        const info = makeQuickInfo(parts);
        const result = appendEngineProcDoc(info, parts);
        expect(result?.documentation).toHaveLength(1);
    });

    it("returns new object (immutable)", () => {
        const parts = [makePart("functionName", "start")];
        const info = makeQuickInfo(parts);
        const result = appendEngineProcDoc(info, parts);
        expect(result).not.toBe(info);
    });
});
