/**
 * Pins the (spec, mode) memo in `toZodSchema`. Nothing else in the suite fails if it regresses - a
 * freshly derived schema behaves identically, it just costs the derivation again, and the shipped
 * formats derive the same spec several times over (PRO builds its document schema twice per mode, and
 * ITM/SPL/CRE each derive the shared IE effect spec).
 */

import { describe, expect, it } from "vitest";
import { u8, u16 } from "typed-binary";
import { toZodSchema } from "../src/spec/derive-zod";
import type { FieldSpec } from "../src/spec/types";

const spec = {
    kind: { codec: u8 },
    value: { codec: u16 },
} satisfies Record<string, FieldSpec>;

/** Structurally identical to `spec`, and a distinct object - the cache key is identity. */
const otherSpec = {
    kind: { codec: u8 },
    value: { codec: u16 },
} satisfies Record<string, FieldSpec>;

describe("toZodSchema derivation cache", () => {
    it("returns one instance per (spec, mode)", () => {
        expect(toZodSchema(spec, { mode: "strict" })).toBe(toZodSchema(spec, { mode: "strict" }));
        expect(toZodSchema(spec, { mode: "permissive" })).toBe(toZodSchema(spec, { mode: "permissive" }));
    });

    it("does not share across modes", () => {
        // The modes differ in real refinements (domain bounds, closed-enum membership), so a cache
        // collapsing them would silently apply save-time strictness to the tolerant read path.
        expect(toZodSchema(spec, { mode: "strict" })).not.toBe(toZodSchema(spec, { mode: "permissive" }));
    });

    it("defaults to strict, and hits the same entry as an explicit strict", () => {
        expect(toZodSchema(spec)).toBe(toZodSchema(spec, { mode: "strict" }));
    });

    it("gives a structurally identical spec its own entry, keyed on identity", () => {
        // A WeakMap on the spec object, so two structurally identical specs are distinct callers. The
        // `toBe` half is what can fail: without a cache every call returns a fresh object and the
        // `not.toBe` below passes on its own, which would make this assertion vacuous.
        expect(toZodSchema(otherSpec)).toBe(toZodSchema(otherSpec));
        expect(toZodSchema(otherSpec)).not.toBe(toZodSchema(spec));
    });

    it("still validates against the spec after caching", () => {
        const schema = toZodSchema(spec);
        expect(schema.safeParse({ kind: 255, value: 65535 }).success).toBe(true);
        expect(schema.safeParse({ kind: 256, value: 0 }).success).toBe(false);
        expect(schema.safeParse({ kind: 0, value: 0, extra: 1 }).success).toBe(false);
    });
});
