/**
 * Guard: the supported-extension lists the published format and transpile Actions hardcode still match
 * the CLIs they wrap.
 *
 * Each Action filters a consumer's changed files before invoking its CLI, and neither `fgfmt` nor `fgtp`
 * exposes an `--extensions` flag for the shell to ask - so the lists are written out by hand, with a
 * "keep in sync" comment and, until now, nothing checking it. Drift here is invisible from inside this
 * repo: the Action simply stops passing a file type the CLI still supports, on someone else's runner.
 *
 * The sibling `actions/binary` needs no entry: it discovers its extensions at runtime via
 * `fgbin --extensions`, which is the better shape and the one to move these two to if either CLI ever
 * grows the flag.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    EXT_FALLOUT_MSG,
    EXT_FALLOUT_SSL,
    EXT_INFINITY_2DA,
    EXT_TBAF,
    EXT_TD,
    EXT_WEIDU_BAF,
    EXT_WEIDU_D,
    EXT_WEIDU_TP2,
    EXT_WEIDU_TRA,
    FILENAME_FALLOUT_SCRIPTS_LST,
} from "../../../shared/languages.ts";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

/** The elements of a `name=(a b c)` bash array assignment, or undefined when the file has no such line. */
function shellArray(file: string, name: string): string[] | undefined {
    const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const match = new RegExp(`^${name}=\\(([^)]*)\\)`, "m").exec(text);
    return match ? match[1]!.split(/\s+/).filter(Boolean) : undefined;
}

const dotless = (ext: string): string => ext.replace(/^\./, "");

describe("published Actions' extension lists", () => {
    it("reads both Action scripts", () => {
        // Positive control: every comparison below is vacuously true if the parse returned nothing, and a
        // renamed variable or a reformatted assignment would do exactly that.
        expect(shellArray("actions/format/scripts/list-changed.sh", "exts")).toBeDefined();
        expect(shellArray("actions/format/scripts/list-changed.sh", "extra_names")).toBeDefined();
        expect(shellArray("actions/transpile/scripts/list-changed.sh", "in_exts")).toBeDefined();
    });

    it("format's list matches @bgforge/format's EXTENSIONS", () => {
        const expected = [
            EXT_FALLOUT_SSL,
            EXT_WEIDU_BAF,
            EXT_WEIDU_D,
            ...EXT_WEIDU_TP2,
            EXT_WEIDU_TRA,
            EXT_FALLOUT_MSG,
            EXT_INFINITY_2DA,
        ].map((ext) => dotless(ext));
        expect(shellArray("actions/format/scripts/list-changed.sh", "exts")!.sort()).toEqual(expected.sort());
    });

    it("format's exact-filename list matches too", () => {
        expect(shellArray("actions/format/scripts/list-changed.sh", "extra_names")).toEqual([
            FILENAME_FALLOUT_SCRIPTS_LST,
        ]);
    });

    it("transpile's input list matches @bgforge/transpile's EXTENSIONS", () => {
        const expected = [EXT_TD, EXT_TBAF].map((ext) => dotless(ext));
        expect(shellArray("actions/transpile/scripts/list-changed.sh", "in_exts")!.sort()).toEqual(expected.sort());
    });

    it("only actions/binary discovers its extensions at runtime", () => {
        // Pins the note in this file's header: if either of the two hardcoding Actions gains the flag, this
        // goes red and the list should move to runtime discovery rather than staying hand-maintained.
        const withFlag = execSync("git ls-files -- 'actions/*/scripts/*.sh'", {
            cwd: repoRoot,
            encoding: "utf8",
            timeout: SPAWN_TIMEOUT_MS,
        })
            .split("\n")
            .filter(Boolean)
            // Non-comment lines only: format's and transpile's own headers explain that their CLI has no
            // `--extensions` flag, and a substring match reads those sentences as the flag being used.
            .filter((file) =>
                fs
                    .readFileSync(path.join(repoRoot, file), "utf8")
                    .split("\n")
                    .some((line) => !/^\s*#/.test(line) && line.includes("--extensions")),
            )
            .map((file) => file.split("/")[1]!);
        expect([...new Set(withFlag)]).toEqual(["binary"]);
    });
});
