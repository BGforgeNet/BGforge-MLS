/**
 * Differential for the command-line switches themselves, against the reference compiler.
 *
 * The corpus differentials cover the optimisation levels over real scripts, and `test/args.test.ts`
 * covers how a command line parses - but that one asserts a reading of the reference's source back to
 * itself, which cannot catch a misreading. This runs both compilers with the same switches and compares
 * the bytes, so every claim `args.ts` and the README make about matching the reference is observed.
 *
 * Only the switches where sameness is the goal are here. `-P`, `-D`, `-d` and `-F` produce output in a
 * format this compiler deliberately does not copy, `-b` is refused, and `-O3` is honoured as `-O2`; the
 * README's table is where those live, and the last of them is pinned below as our own contract rather
 * than against the reference's experimental tier.
 */

import { execFileSync } from "child_process";
import { createRequire } from "module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";

/**
 * Exercises all three levels: an unreferenced global and an uncalled procedure go at `-O1`, and the
 * constant fold, dead store and dead local go at `-O2`. A fixture whose levels all agree would let every
 * mapping case below pass without discriminating anything, so `distinguishes the levels` guards it.
 */
const LEVELS_SSL = `variable unused_global := 7;
variable used_global := 0;

procedure never_called;
procedure start;

procedure never_called begin
   display_msg("dead");
end

procedure start begin
   variable a := 0;
   variable b := 0;
   a := 2 + 3;
   a := 10;
   used_global := a;
   if (used_global == 10 and b != 1) then display_msg("y");
end
`;

const CONDITIONAL_SSL = `#ifdef GREET
procedure start begin display_msg("hi"); end
#else
procedure start begin end
#endif
`;

const INCLUDING_SSL = `#include "greet.h"
procedure start begin display_msg(GREETING); end
`;

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
    }
}

const reference = findCompiler();
const cli = path.join(REPO_ROOT, "compilers/ssl/out/cli.js");
// The CLI bundle is built in the phase before this suite runs; without it there is nothing to compare.
const ready = reference !== null && fs.existsSync(cli);
const workDir = ready ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-switches-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

function run(command: string, args: string[]): void {
    execFileSync(process.execPath, [command, ...args], {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: SPAWN_TIMEOUT_MS,
    });
}

/**
 * Compiles `source` with both compilers under `switches` and returns the two outputs.
 *
 * `-p` goes to the reference because that is what puts its preprocessor in the path at all: without it
 * `-m` and `-I` reach nothing, and a `#ifdef` is not evaluated - its own lexer compiles both arms. This
 * compiler always preprocesses, so it takes no equivalent. `-q` and `-l` only silence the two of them.
 */
function compileBoth(source: string, switches: string[]): { reference: Buffer; ours: Buffer } {
    fs.writeFileSync(path.join(workDir, "in.ssl"), source);
    run(reference as string, ["-q", "-p", ...switches, "in.ssl", "-o", "ref.int"]);
    run(cli, ["-l", ...switches, "in.ssl", "-o", "ours.int"]);
    return {
        reference: fs.readFileSync(path.join(workDir, "ref.int")),
        ours: fs.readFileSync(path.join(workDir, "ours.int")),
    };
}

/** Byte size of the reference's output, for the level-discrimination guard. */
function referenceSize(source: string, switches: string[]): number {
    return compileBoth(source, switches).reference.length;
}

describe.skipIf(!ready)("command-line switches against the reference", () => {
    it("distinguishes the levels, so the mapping cases below can discriminate", () => {
        const sizes = ["-O0", "-O1", "-O2"].map((level) => referenceSize(LEVELS_SSL, [level]));
        expect(new Set(sizes).size).toBe(3);
    });

    describe("optimisation level", () => {
        it.each(["-O0", "-O1", "-O2"])("compiles %s to the same bytes", (level) => {
            const { reference: ref, ours } = compileBoth(LEVELS_SSL, [level]);
            expect(ours.equals(ref)).toBe(true);
        });

        it("reads a bare -O as full optimisation", () => {
            const bare = compileBoth(LEVELS_SSL, ["-O"]);
            expect(bare.ours.equals(bare.reference)).toBe(true);
            expect(bare.ours.equals(compileBoth(LEVELS_SSL, ["-O2"]).ours)).toBe(true);
        });

        it("reads an unparseable level as none, like atoi", () => {
            const garbage = compileBoth(LEVELS_SSL, ["-Ox"]);
            expect(garbage.ours.equals(garbage.reference)).toBe(true);
            expect(garbage.ours.equals(compileBoth(LEVELS_SSL, ["-O0"]).ours)).toBe(true);
        });

        it("takes the last of several", () => {
            const last = compileBoth(LEVELS_SSL, ["-O2", "-O0"]);
            expect(last.ours.equals(last.reference)).toBe(true);
            expect(last.ours.equals(compileBoth(LEVELS_SSL, ["-O0"]).ours)).toBe(true);
        });

        it("honours -O3 as -O2, which is where we part company with the reference", () => {
            const experimental = compileBoth(LEVELS_SSL, ["-O3"]);
            expect(experimental.ours.equals(compileBoth(LEVELS_SSL, ["-O2"]).ours)).toBe(true);
            expect(experimental.ours.equals(experimental.reference)).toBe(false);
        });
    });

    it("compiles -s to the same bytes, and to something other than without it", () => {
        const short = compileBoth(LEVELS_SSL, ["-O0", "-s"]);
        expect(short.ours.equals(short.reference)).toBe(true);
        expect(short.ours.equals(compileBoth(LEVELS_SSL, ["-O0"]).ours)).toBe(false);
    });

    it("defines a macro for -m the same way", () => {
        const defined = compileBoth(CONDITIONAL_SSL, ["-mGREET"]);
        expect(defined.ours.equals(defined.reference)).toBe(true);
        // The other arm, so the comparison above is not passing on a macro neither compiler honoured.
        expect(defined.ours.equals(compileBoth(CONDITIONAL_SSL, []).ours)).toBe(false);
    });

    it("searches an -I directory the same way", () => {
        fs.mkdirSync(path.join(workDir, "hdr"), { recursive: true });
        fs.writeFileSync(path.join(workDir, "hdr/greet.h"), '#define GREETING "hi"\n');
        const included = compileBoth(INCLUDING_SSL, ["-Ihdr"]);
        expect(included.ours.equals(included.reference)).toBe(true);
    });

    it("leaves the output alone for the switches that only change reporting", () => {
        const quiet = compileBoth(LEVELS_SSL, ["-O1", "-n", "-w"]);
        expect(quiet.ours.equals(quiet.reference)).toBe(true);
        expect(quiet.ours.equals(compileBoth(LEVELS_SSL, ["-O1"]).ours)).toBe(true);
    });

    it("names the output the same way when no -o says otherwise", () => {
        fs.writeFileSync(path.join(workDir, "named.ssl"), LEVELS_SSL);
        for (const [command, extra] of [
            [reference as string, ["-q", "-p"]],
            [cli, ["-l"]],
        ] as const) {
            fs.rmSync(path.join(workDir, "named.int"), { force: true });
            run(command, [...extra, "named.ssl"]);
            expect(fs.existsSync(path.join(workDir, "named.int"))).toBe(true);
        }
    });

    it("stops reading switches at the first file name", () => {
        // `-O0` here is a file name to both compilers, so both compile at the default level instead of
        // level 0 - and both say the file is missing, the reference as a warning and this as an error.
        fs.writeFileSync(path.join(workDir, "in.ssl"), LEVELS_SSL);
        fs.rmSync(path.join(workDir, "in.int"), { force: true });
        run(reference as string, ["-q", "-p", "in.ssl", "-O0"]);
        const referenceDefault = fs.readFileSync(path.join(workDir, "in.int"));

        fs.rmSync(path.join(workDir, "in.int"), { force: true });
        expect(() => run(cli, ["-l", "in.ssl", "-O0"])).toThrow();
        expect(fs.readFileSync(path.join(workDir, "in.int")).equals(referenceDefault)).toBe(true);
        expect(referenceDefault.equals(compileBoth(LEVELS_SSL, ["-O0"]).ours)).toBe(false);
    });
});
