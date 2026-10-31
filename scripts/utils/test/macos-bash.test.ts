/**
 * The tool-provisioning scripts run on stock macOS, whose `/bin/bash` is 3.2 and which has `shasum` but no
 * `sha256sum`.
 *
 * These scripts carry darwin pins, so a macOS host is meant to run them; under bash 3.2 a bash-4 construct
 * fails at the line that uses it (`declare -A` is an invalid option there), which no Linux run can show.
 * shellcheck has no bash-version dialect to catch it, hence this scan.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");

/** Every script that sources tool-download-lib.sh, which promises its sourcers stay within bash 3.2. */
const TOOL_DOWNLOAD_USERS = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((name) => name.endsWith(".sh"))
    .filter((name) =>
        /^\s*(source|\.)\s+\S*tool-download-lib\.sh/m.test(fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8")),
    )
    .map((name) => `scripts/${name}`);

/** The timing and job-runner libraries, which the provisioning scripts' callers share with these. */
const SHARED_LIBS = ["scripts/timing-lib.sh", "scripts/parallel-lib.sh"];

const SCRIPTS = ["scripts/tool-download-lib.sh", ...TOOL_DOWNLOAD_USERS, ...SHARED_LIBS];

/** Constructs bash 3.2 lacks. */
const UNPORTABLE: Record<string, RegExp> = {
    "associative array": /\b(declare|local|typeset)\s+-[a-zA-Z]*A/,
    nameref: /\b(declare|local|typeset)\s+-[a-zA-Z]*n\b/,
    "mapfile/readarray": /\b(mapfile|readarray)\b/,
    "wait -n": /\bwait\s+-n\b/,
    "case conversion expansion": /\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?(,,?|\^\^?)\}/,
    "&>> redirection": /&>>/,
    // BSD date has no %N: `+%s%3N` prints the digits then a literal "3N", which breaks the arithmetic downstream.
    "GNU-only date width (%3N)": /%[0-9]+N/,
};

describe("scripts meant for stock macOS", () => {
    it("covers every sourcer of tool-download-lib.sh", () => {
        expect(TOOL_DOWNLOAD_USERS).toEqual(
            expect.arrayContaining(["scripts/lint-shell.sh", "scripts/lint-workflows.sh", "scripts/ensure-weidu.sh"]),
        );
    });

    it.each(SCRIPTS)("%s uses nothing bash 3.2 or macOS lacks", (script) => {
        const code = fs
            .readFileSync(path.join(REPO_ROOT, script), "utf8")
            .split("\n")
            .map((line, index) => ({ line: line.replace(/^\s*#.*$/, ""), number: index + 1 }));

        const hits = code.flatMap(({ line, number }) =>
            Object.entries(UNPORTABLE)
                .filter(([, pattern]) => pattern.test(line))
                .map(([name]) => `${number}: ${name}`),
        );

        expect(hits).toEqual([]);
    });

    it.each(SCRIPTS)("%s computes a sha256 only where shasum stands in for sha256sum", (script) => {
        const code = fs.readFileSync(path.join(REPO_ROOT, script), "utf8").replaceAll(/^\s*#.*$/gm, "");

        expect(/\bsha256sum\b/.test(code) && !/\bshasum -a 256\b/.test(code)).toBe(false);
    });
});
