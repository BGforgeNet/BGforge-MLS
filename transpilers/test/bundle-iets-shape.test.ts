/**
 * The bundler's handling of an iets-shaped dependency: declarations and runtime values side by side.
 *
 * No committed .tbaf/.td sample imports anything, so until this file the bundling path had coverage only
 * from synthetic inline sources - and the real corpus that does exercise it lives under the gitignored
 * external/. That gap is what let "the dependency could just be externalised" look plausible: it holds
 * for the .d.ts half and silently drops the class the transpiler needs from the other half.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { bundle } from "../common/bundle";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "transpilers/test/fixtures/iets-shape");
const ENTRY = path.join(FIXTURE, "main.tbaf");
const source = fs.readFileSync(ENTRY, "utf-8");

describe("bundling a dependency that mixes declarations with runtime values", () => {
    it("inlines the runtime half, so the transpiler sees the value bodies", async () => {
        const { code } = await bundle(ENTRY, source);

        // Asserted on the lowered form esbuild actually emits (`var X = class {`), not on the source
        // spelling: the transpiler reads this text, so the test is pinned to what it will be handed.
        // Externalising the dependency would leave a bare import here and no body at all.
        expect(code).toContain("ObjectRef = class");
        expect(code).toContain("this.id = id");
        expect(code).toContain("function nearest");
    });

    it("keeps the declaration half out of the bundle while its symbols stay callable", async () => {
        const { code } = await bundle(ENTRY, source);

        // engine.d.ts is externalised, and cleanupEsbuildOutput then strips the import line, so the
        // engine names survive as free identifiers - which is the form the TBAF transpiler turns into
        // triggers and actions. Nothing of the declaration file's own text may appear.
        expect(code).not.toContain("declare");
        expect(code).not.toContain("engine.d.ts");
        expect(code).toMatch(/if \(See\(Player1\)\)/);
        expect(code).toMatch(/Attack\(Player1\)/);
    });

    it("strips the enum prefix, using a name collected while externalising the declarations", async () => {
        const { code } = await bundle(ENTRY, source);

        // The failure this pins is silent: treating the dependency as declarations-only still emits a
        // script, with `Animate.MAGE_MALE_HUMAN` where the engine needs the bare member. Verified against
        // the real corpus - that substitution is exactly what a bare-specifier externalisation produced.
        expect(code).toContain("Polymorph(MAGE_MALE_HUMAN)");
        expect(code).not.toContain("Animate.MAGE_MALE_HUMAN");
    });

    it("drops a module whose only import is unused, top-level side effect included", async () => {
        const entry = path.join(FIXTURE, "unused-import.tbaf");
        const { code } = await bundle(entry, fs.readFileSync(entry, "utf-8"));

        // The transpiler emits BAF, so a retained module's top-level call would land in the script as a
        // stray action. Measured note for whoever touches the plugin list: this holds with or without
        // noSideEffectsPlugin - esbuild drops the module either way, here and across the real corpus -
        // so the test pins the OUTPUT, and is not evidence that the plugin is doing the dropping.
        expect(code).not.toContain("39321");
        expect(code).not.toContain("0x9999");
        expect(code).not.toContain("neverCalled");
        // The entry's own logic must survive the same pass.
        expect(code).toMatch(/if \(See\(Player1\)\)/);
    });

    it("gives every bundled line an origin in a file that exists", async () => {
        const { code, origins } = await bundle(ENTRY, source);

        expect(origins.length).toBeGreaterThan(0);
        const lines = code.split("\n");
        expect(origins.length).toBeLessThanOrEqual(lines.length);
        for (const origin of origins) {
            if (origin === undefined) continue;
            expect(fs.existsSync(origin.file)).toBe(true);
            // An origin past the end of its file is the failure mode a composed line map produces, and it
            // reads as plausible until the line is fetched back out of the named file.
            expect(origin.line).toBeLessThan(fs.readFileSync(origin.file, "utf-8").split("\n").length);
        }
    });
});
