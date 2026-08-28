/**
 * An import that resolves to nothing fails the transpile, whatever form the specifier takes.
 *
 * rolldown splits the two by default: a relative path that resolves to no file is a build error, but an
 * unresolvable BARE specifier is treated as external and merely warned about - and the transpiler asks
 * for no logs, so nothing surfaces at all. The bundle then keeps the identifier the import would have
 * bound, and the emitted mod file carries a name that resolves to nothing in the game:
 *
 *     SetGlobal("unresolved", "GLOBAL", Missing)
 *
 * The previous bundler failed the build for both forms, so this is the behaviour being held, not a new
 * strictness. The only imports legitimately left unresolved here are `.d.ts` declarations, which the
 * resolver plugin marks external by name rather than by falling through.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bundle } from "../common/bundle";
import { REPO_ROOT } from "./repo-root";

const BARE = path.join(REPO_ROOT, "transpilers/test/fixtures/unresolved-import/bare-package.tbaf");

describe("an import that resolves to nothing", () => {
    it("fails the transpile when the specifier is a bare package name", async () => {
        await expect(bundle(BARE, fs.readFileSync(BARE, "utf-8"))).rejects.toThrow(/@bgforge\/no-such-package-exists/);
    });

    it("fails the transpile when the specifier is a relative path", async () => {
        // Written to a temp dir rather than committed: a relative import naming no file is exactly what
        // a fixture directory cannot hold without the missing file looking like an oversight.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-unresolved-"));
        const entry = path.join(dir, "typo.tbaf");
        fs.writeFileSync(entry, 'import { Missing } from "./nowhere";\n\nSetGlobal("g", "GLOBAL", Missing);\n');
        try {
            await expect(bundle(entry, fs.readFileSync(entry, "utf-8"))).rejects.toThrow(/nowhere/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("still resolves a .d.ts import, which is external on purpose", async () => {
        // Positive control for the two above: a bundler that refused every import it did not inline
        // would pass them both while breaking every real mod file.
        const entry = path.join(REPO_ROOT, "transpilers/test/fixtures/iets-shape/main.tbaf");

        const { code } = await bundle(entry, fs.readFileSync(entry, "utf-8"));

        expect(code).toContain("ObjectRef");
    });
});
