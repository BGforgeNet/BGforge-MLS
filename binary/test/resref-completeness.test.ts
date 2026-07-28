/**
 * Completeness guard for resref declarations.
 *
 * `external-refs.test.ts` pins the declarations that EXIST; it cannot say a field that should carry one is
 * missing it. This closes that half for the one ref kind with a checkable signature: a resref is `char[8]`, so
 * every 8-char field either names what it points at (`resource`), records that its type is chosen elsewhere
 * (`deferred`), or is listed below as naming nothing at all.
 *
 * Static, over the specs rather than parsed fixtures, so it covers fields no fixture happens to exercise and
 * runs without the external corpus checked out.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effectSpecAnnotated } from "../src/ie-common/specs/effect.overrides";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { effHeaderSpec } from "../src/eff/specs/header";
import { creHeaderSpecAnnotated } from "../src/cre/specs/header.overrides";
import { creItemSpecAnnotated } from "../src/cre/specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "../src/cre/specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "../src/cre/specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "../src/cre/specs/spell-mem-info.overrides";
import { itmAbilitySpecAnnotated } from "../src/itm/specs/ability.overrides";
import { itmHeaderSpecAnnotated } from "../src/itm/specs/header.overrides";
import { splAbilitySpecAnnotated } from "../src/spl/specs/ability.overrides";
import { splHeaderSpecAnnotated } from "../src/spl/specs/header.overrides";
import { REPO_ROOT } from "./repo-root";
import type { CharsFieldSpec, FieldSpec } from "../src/spec/types";

/** Every record spec that can hold a resref, annotated (the plain specs carry no `ref`). */
const SPECS: Record<string, Record<string, FieldSpec>> = {
    "itm.header": itmHeaderSpecAnnotated,
    "itm.ability": itmAbilitySpecAnnotated,
    "spl.header": splHeaderSpecAnnotated,
    "spl.ability": splAbilitySpecAnnotated,
    "cre.header": creHeaderSpecAnnotated,
    "cre.item": creItemSpecAnnotated,
    "cre.knownSpell": creKnownSpellSpecAnnotated,
    "cre.memorizedSpell": creMemorizedSpellSpecAnnotated,
    "cre.spellMemInfo": creSpellMemInfoSpecAnnotated,
    "eff.header": effHeaderSpec,
    "eff.body": effBodySpecAnnotated,
    "ie-common.effect": effectSpecAnnotated,
};

/**
 * 8-char fields that point at nothing, with why. Deliberately not marked `deferred` - that kind means the
 * target type is chosen by another field, which is a different statement from "there is no target".
 */
const NAMES_NOTHING: Record<string, string> = {
    "spl.header.unused16": "IESDP marks it unused; it holds no resref",
    "spl.header.unused19": "IESDP marks it unused; it holds no resref",
};

const RESREF_CHARS = 8;

/** Returns the chars-narrowed spec alongside the name, so callers can read `ref` without re-narrowing. */
function resrefShapedFields(spec: Record<string, FieldSpec>): [string, CharsFieldSpec][] {
    const out: [string, CharsFieldSpec][] = [];
    for (const [field, fieldSpec] of Object.entries(spec)) {
        if (fieldSpec.kind === "chars" && fieldSpec.count === RESREF_CHARS) out.push([field, fieldSpec]);
    }
    return out;
}

describe("every resref-shaped field declares what it points at", () => {
    it("leaves no 8-char field undeclared and unexplained", () => {
        const undeclared: string[] = [];
        for (const [specName, spec] of Object.entries(SPECS)) {
            for (const [field, fieldSpec] of resrefShapedFields(spec)) {
                const key = `${specName}.${field}`;
                if (key in NAMES_NOTHING) continue;
                const kind = fieldSpec.ref?.kind;
                if (kind !== "resource" && kind !== "deferred") undeclared.push(key);
            }
        }

        expect(undeclared).toEqual([]);
    });

    // An allowlist nobody prunes turns into a place undeclared fields hide. Each entry has to still name a
    // field that is still 8 chars wide and still carries no ref - otherwise it has outlived its reason.
    it("keeps no stale entry in the names-nothing list", () => {
        const stale: string[] = [];
        for (const key of Object.keys(NAMES_NOTHING)) {
            const lastDot = key.lastIndexOf(".");
            const spec = SPECS[key.slice(0, lastDot)];
            const fieldSpec = spec?.[key.slice(lastDot + 1)];
            if (fieldSpec === undefined || fieldSpec.kind !== "chars" || fieldSpec.count !== RESREF_CHARS) {
                stale.push(`${key}: no longer an 8-char field`);
            } else if (fieldSpec.ref !== undefined) {
                stale.push(`${key}: now declares a ref, so it no longer belongs here`);
            }
        }

        expect(stale).toEqual([]);
    });

    // The map above is hand-maintained, so a new spec module reaches this guard only if someone adds it. The
    // sources are the oracle: every `charsSpec(8)` written under a format's `specs/` must be a field the walk
    // above actually sees. A mismatch means a module is missing from SPECS, not that the count is wrong.
    it("walks every 8-char field the spec sources declare", () => {
        const specDirs = ["itm", "spl", "cre", "eff", "ie-common"].map((f) =>
            path.join(REPO_ROOT, "binary/src", f, "specs"),
        );
        let inSources = 0;
        for (const dir of specDirs) {
            for (const entry of fs.readdirSync(dir)) {
                // Base specs only: an overrides module spreads its base, so counting both would double up.
                if (!entry.endsWith(".ts") || entry.endsWith(".overrides.ts")) continue;
                inSources += fs.readFileSync(path.join(dir, entry), "utf-8").split("charsSpec(8)").length - 1;
            }
        }
        const walked = Object.values(SPECS).reduce((n, spec) => n + resrefShapedFields(spec).length, 0);

        expect(walked).toBe(inSources);
    });
});
