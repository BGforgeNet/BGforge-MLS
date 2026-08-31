/**
 * Unit tests for dialog-editor/webview/deep-read.ts.
 *
 * The graph's emit effect must re-run on ANY nested model mutation, which it achieves by reading
 * every nested field so Svelte registers a dependency on each. It used to get that read as a
 * side effect of $state.snapshot - a full deep CLONE, which on a large dialog costs hundreds of
 * milliseconds of main-thread time per mutation. deepRead does the reading half alone.
 */

import { describe, expect, it } from "vitest";
import { deepRead } from "../src/dialog-editor/webview/deep-read";

/** Builds a value whose every leaf is a getter, so we can count exactly which ones were read. */
function countingLeaf(reads: string[], name: string): { get leaf(): string } {
    return {
        get leaf(): string {
            reads.push(name);
            return name;
        },
    };
}

describe("deepRead", () => {
    it("reads a leaf property of a plain object", () => {
        const reads: string[] = [];
        deepRead({ a: countingLeaf(reads, "a") });
        expect(reads).toEqual(["a"]);
    });

    it("reads leaves nested several levels deep", () => {
        const reads: string[] = [];
        deepRead({ one: { two: { three: countingLeaf(reads, "deep") } } });
        expect(reads).toEqual(["deep"]);
    });

    it("reads every element of an array, including nested objects", () => {
        const reads: string[] = [];
        deepRead([countingLeaf(reads, "0"), countingLeaf(reads, "1"), { inner: countingLeaf(reads, "2") }]);
        expect(reads.sort()).toEqual(["0", "1", "2"]);
    });

    it("reads every field of a dialog-model-shaped value", () => {
        const reads: string[] = [];
        deepRead({
            roots: [{ kind: "dlg", label: "x", states: [{ id: 1, text: countingLeaf(reads, "state-text") }] }],
            messages: { 1: countingLeaf(reads, "message") },
        });
        expect(reads.sort()).toEqual(["message", "state-text"]);
    });

    it("tolerates null and undefined without throwing", () => {
        expect(() => deepRead({ a: null, b: undefined, c: [null] })).not.toThrow();
        expect(() => deepRead(null)).not.toThrow();
        expect(() => deepRead(undefined)).not.toThrow();
    });

    it("does not copy the value it reads", () => {
        // The whole point: reading is not cloning. A large model must not be duplicated.
        const source = { roots: [{ states: [{ id: 1 }] }] };
        const result = deepRead(source) as unknown;
        expect(result).toBeUndefined();
    });
});
