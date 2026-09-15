/**
 * Guard: nothing in this repo invokes the npm-series tools; every command goes through pnpm.
 *
 * The lockfile and `packageManager` name one resolver, and a stray `npx`/`npm`/`yarn` reads a different
 * one - it can leave a second lockfile or a flat `node_modules` the project never declared, with nothing
 * failing at the time. The rule is stated in the repo's instruction file; this is what checks it.
 *
 * The four published composite Actions are the deliberate exception: they install the CLI they wrap onto a
 * CONSUMER's runner, where pnpm is not present and the consumer's own package manager is none of our
 * business. Those lines carry a `zizmor: ignore[adhoc-packages]` comment at the site for the same reason.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function git(args: string): string[] {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
        .split("\n")
        .filter(Boolean);
}

/**
 * `npm`/`npx`/`yarn` in COMMAND position - line start, or after `&&`, `||`, `;`, a command substitution,
 * or a YAML `run:`. Anchoring this way is what keeps the guard off the many prose mentions ("npm version
 * specifier", "the @bgforge npm org"), which are the reason a bare word match would flood.
 *
 * A bare `(` and a bare `|` are deliberately NOT openers here, though both are real command positions in
 * shell. They also open a regex group and separate an alternation, and this repo keeps grep patterns in
 * shell variables - `WARNING_MARKERS` in scripts/parallel-lib.sh contains the literal `(npm |pnpm )`, which
 * a `(`-anchored match reads as an invocation. Losing the subshell and pipe positions costs little: an
 * npm-series call in either still has to be written somewhere, and every other position is covered.
 */
const INVOCATION = /(?:^|&&|\|\||;|\$\(|`|run:)\s*(?:sudo\s+)?(npm|npx|yarn)\s/;

/** Shell and YAML comment lines: a mention inside one is prose, not an invocation. */
function isComment(line: string): boolean {
    return /^\s*#/.test(line);
}

/**
 * The consumer-runner installs in the published Actions. Matched on the whole line rather than the file so
 * a NEW npm call added to one of these files is still caught.
 */
function isPublishedActionInstall(file: string, line: string): boolean {
    return /^actions\/[^/]+\/action\.yml$/.test(file) && /npm install -g "@bgforge\//.test(line);
}

const SCANNED = ["'*.sh'", "'*.yml'", "'*.yaml'", "'*.mjs'", "'*.mts'", "'*.cjs'"].join(" ");

const offenders = git(`ls-files -- ${SCANNED}`)
    .filter((file) => !file.split("/").some((seg) => seg === "node_modules" || seg === "out" || seg === "dist"))
    .flatMap((file) =>
        fs
            .readFileSync(path.join(repoRoot, file), "utf8")
            .split("\n")
            .flatMap((line, i) => {
                if (isComment(line) || isPublishedActionInstall(file, line)) return [];
                const hit = INVOCATION.exec(line);
                return hit ? [`${file}:${i + 1} runs ${hit[1]}`] : [];
            }),
    );

describe("package manager", () => {
    it("finds the files to check", () => {
        // Positive control: the sweep means nothing if it never reached the shell and workflow files.
        expect(git(`ls-files -- ${SCANNED}`).length).toBeGreaterThan(50);
    });

    it("catches an npm-series invocation", () => {
        // Falsification: the matcher fires on the shapes it is meant to catch, in each command position,
        // and stays off the prose that surrounds them in this repo.
        expect(INVOCATION.test("npx tsc --noEmit")).toBe(true);
        expect(INVOCATION.test("        run: npm ci")).toBe(true);
        expect(INVOCATION.test("pnpm build && yarn test")).toBe(true);
        expect(INVOCATION.test('  description: "npm version specifier for @bgforge/format."')).toBe(false);
        expect(INVOCATION.test("#   - @bgforge npm org must exist")).toBe(false);
        // A grep pattern held in a shell variable, not a command - the shape that made a `(`-anchored
        // first draft of this matcher flag scripts/parallel-lib.sh.
        expect(INVOCATION.test("WARNING_MARKERS='^ *(npm |pnpm )?(WARN|warn) '")).toBe(false);
    });

    it("is never invoked outside the published Actions", () => {
        expect([...new Set(offenders)].sort()).toEqual([]);
    });
});
