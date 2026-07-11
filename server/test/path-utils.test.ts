/**
 * Tests for path-utils workspace discovery: the shared scan-exclusion set and
 * single- vs multi-extension globbing. Exercises the REAL fast-glob path (this
 * file deliberately does not mock path-utils) against a temp fixture tree.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findFiles, findFilesByExtensions } from "../src/path-utils";

describe("findFiles / findFilesByExtensions discovery", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "bgforge-scan-"));
        // Normal indexable sources.
        await writeFile(join(root, "main.ssl"), "// main");
        await mkdir(join(root, "lib"), { recursive: true });
        await writeFile(join(root, "lib", "util.ssl"), "// util");
        await writeFile(join(root, "table.2da"), "2DA");
        // Excluded: dependency tree (a real hit against the unfiltered walk).
        await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
        await writeFile(join(root, "node_modules", "pkg", "vendored.ssl"), "// vendored");
        // Excluded: dot-directory.
        await mkdir(join(root, ".git", "hooks"), { recursive: true });
        await writeFile(join(root, ".git", "hooks", "hook.ssl"), "// hook");
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("excludes node_modules and dot-directories from single-extension discovery", async () => {
        const files = await findFiles(root, "ssl");
        expect(files.sort()).toEqual(["lib/util.ssl", "main.ssl"]);
    });

    it("walks multiple extensions in one pass, excluding the same trees", async () => {
        const files = await findFilesByExtensions(root, ["ssl", "2da"]);
        expect(files.sort()).toEqual(["lib/util.ssl", "main.ssl", "table.2da"]);
    });

    it("returns an empty list for no extensions without walking", async () => {
        expect(await findFilesByExtensions(root, [])).toEqual([]);
    });
});
