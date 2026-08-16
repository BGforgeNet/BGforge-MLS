/**
 * Command-line parsing against the reference compiler's own grammar, including the quirks it is worth
 * being bug-compatible with (switches only before the first file, `atoi` digits, unknown switches
 * surviving) and the places this compiler deliberately parts company with it.
 */

import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args";

describe("parseArgs", () => {
    it("defaults to level 1 with no switches, as the reference executable does", () => {
        const args = parseArgs(["script.ssl"]);
        expect(args.level).toBe(1);
        expect(args.shortCircuit).toBe(false);
        expect(args.inputs).toEqual([{ file: "script.ssl" }]);
        expect(args.notices).toEqual([]);
    });

    it("reads a bare -O as full optimisation", () => {
        expect(parseArgs(["-O", "a.ssl"]).level).toBe(2);
    });

    it.each([
        ["-O0", 0],
        ["-O1", 1],
        ["-O2", 2],
    ])("reads %s as level %i", (flag, level) => {
        expect(parseArgs([flag, "a.ssl"]).level).toBe(level);
    });

    it("honours -O3 as level 2 and says so", () => {
        const args = parseArgs(["-O3", "a.ssl"]);
        expect(args.level).toBe(2);
        expect(args.notices).toEqual([{ fatal: false, message: expect.stringContaining("-O3 is honoured as -O2") }]);
    });

    it("reads unparseable and negative levels as none, like atoi", () => {
        expect(parseArgs(["-Ox", "a.ssl"]).level).toBe(0);
        expect(parseArgs(["-O-1", "a.ssl"]).level).toBe(0);
    });

    it("takes the last -O when several are given", () => {
        expect(parseArgs(["-O2", "-O0", "a.ssl"]).level).toBe(0);
    });

    it("keeps reading a command line whose switches change nothing", () => {
        const args = parseArgs(["-q", "-n", "-p", "-F", "-w", "--", "a.ssl"]);
        // Four of the six do nothing and say so. `-n` suppresses warnings, and `--` is the reference's
        // own ignored argument rather than a switch anyone passed for an effect.
        expect(args.notices.map((notice) => notice.noop)).toEqual([true, true, true, true]);
        expect(args.inputs).toEqual([{ file: "a.ssl" }]);
    });

    it("reports an unknown switch without making it fatal", () => {
        const args = parseArgs(["-Z", "a.ssl"]);
        expect(args.notices).toEqual([{ fatal: false, message: "Unknown option -Z" }]);
        expect(args.inputs).toEqual([{ file: "a.ssl" }]);
    });

    it("refuses -b, naming what it would change and that the reference can do it", () => {
        const args = parseArgs(["-b", "a.ssl"]);
        // `unsupported` is what separates "this compiler cannot" from "that argument is malformed": a
        // caller able to offer the reference compiler reads it to name the switch in its own remedy.
        expect(args.notices).toEqual([
            { fatal: true, unsupported: "-b", message: expect.stringContaining("backward compatibility") },
        ]);
    });

    it("sets the flags that reach the compiler", () => {
        const args = parseArgs(["-s", "-P", "-l", "-d", "-D", "-n", "a.ssl"]);
        expect(args).toMatchObject({
            shortCircuit: true,
            preprocessOnly: true,
            noLogo: true,
            debug: true,
            dumpTree: true,
            noWarnings: true,
        });
    });

    it("leaves warnings on when -n is absent", () => {
        // `-n` was accepted and ignored while this compiler had no warnings to suppress; it means
        // something now, so the default has to be the one that still reports them.
        expect(parseArgs(["a.ssl"]).noWarnings).toBe(false);
    });

    describe("macros", () => {
        it("defines a valueless macro as 1", () => {
            expect(parseArgs(["-mDEBUG", "a.ssl"]).defines).toEqual({ DEBUG: "1" });
        });

        it("takes the value after the first =", () => {
            expect(parseArgs(["-mLEVEL=2=3", "a.ssl"]).defines).toEqual({ LEVEL: "2=3" });
        });

        it("defines an empty value for a trailing =", () => {
            expect(parseArgs(["-mEMPTY=", "a.ssl"]).defines).toEqual({ EMPTY: "" });
        });

        it("accepts several, where the reference keeps only the last", () => {
            expect(parseArgs(["-mA", "-mB=2", "a.ssl"]).defines).toEqual({ A: "1", B: "2" });
        });

        it("refuses a macro with parameters", () => {
            const args = parseArgs(["-mF(x)=x", "a.ssl"]);
            expect(args.notices).toEqual([{ fatal: true, message: expect.stringContaining("takes parameters") }]);
            expect(args.defines).toEqual({});
        });

        it("refuses a bare -m", () => {
            expect(parseArgs(["-m", "a.ssl"]).notices).toEqual([
                { fatal: true, message: expect.stringContaining("needs a macro name") },
            ]);
        });
    });

    describe("include directories", () => {
        it("keeps every -I in the order given", () => {
            expect(parseArgs(["-Ione", "-Itwo", "a.ssl"]).includeDirs).toEqual(["one", "two"]);
        });

        it("ignores a pathless -I", () => {
            expect(parseArgs(["-I", "a.ssl"]).includeDirs).toEqual([]);
        });
    });

    describe("inputs", () => {
        it("binds -o to the file before it", () => {
            expect(parseArgs(["a.ssl", "-o", "out.int", "b.ssl"]).inputs).toEqual([
                { file: "a.ssl", output: "out.int" },
                { file: "b.ssl" },
            ]);
        });

        it("stops reading switches at the first file, as the reference does", () => {
            // `-s` here is a file name, not a switch: the reference's own loop has already stopped.
            const args = parseArgs(["a.ssl", "-s"]);
            expect(args.shortCircuit).toBe(false);
            expect(args.inputs).toEqual([{ file: "a.ssl" }, { file: "-s" }]);
        });

        it("refuses a -o with nothing after it", () => {
            const args = parseArgs(["a.ssl", "-o"]);
            expect(args.notices).toEqual([{ fatal: true, message: expect.stringContaining("needs an output path") }]);
        });

        it("returns no inputs for a switches-only command line", () => {
            expect(parseArgs(["-O2", "-s"]).inputs).toEqual([]);
        });
    });

    describe("switches that do nothing here", () => {
        // Accepted so a build script written for the reference keeps working, but silence would leave the
        // author believing the switch bought them something. The note says otherwise once per run.
        it.each(["-q", "-p", "-F", "-w"])("notes that %s is a no-op", (flag) => {
            const args = parseArgs([flag, "a.ssl"]);
            expect(args.notices).toEqual([{ fatal: false, noop: true, message: expect.stringContaining(flag) }]);
        });

        it("says nothing about switches that do work", () => {
            expect(parseArgs(["-n", "-l", "-d", "a.ssl"]).notices).toEqual([]);
        });
    });

    describe("decompiling", () => {
        it.each(["-x", "--decompile"])("reads %s as decompile mode", (flag) => {
            const args = parseArgs([flag, "a.int"]);
            expect(args.decompile).toBe(true);
            expect(args.inputs).toEqual([{ file: "a.int" }]);
        });

        it.each(["-X", "--listing"])("reads %s as listing mode", (flag) => {
            const args = parseArgs([flag, "a.int"]);
            expect(args.listing).toBe(true);
            expect(args.decompile).toBe(false);
        });

        it("refuses both modes at once, which ask for different output from one file", () => {
            const args = parseArgs(["-x", "-X", "a.int"]);
            expect(args.notices).toEqual([
                expect.objectContaining({ fatal: true, message: expect.stringContaining("-x and -X") }),
            ]);
        });

        // Every one of these shapes the compile that is not happening. Ignoring them would let someone
        // believe `-O2` optimised a decompile, so the whole command line is refused instead.
        it.each(["-O2", "-Ifoo", "-mA", "-s", "-P", "-D"])("refuses %s alongside -x", (flag) => {
            const args = parseArgs([flag, "-x", "a.int"]);
            expect(args.notices).toEqual([
                expect.objectContaining({ fatal: true, message: expect.stringContaining("decompiling") }),
            ]);
        });

        it("refuses nothing when -x stands alone", () => {
            // The level defaults to 1 with no -O written, so a conflict decided by the resolved level
            // rather than by the switch having been typed would refuse every decompile there is.
            expect(parseArgs(["-x", "a.int"]).notices).toEqual([]);
        });
    });

    describe("help", () => {
        it.each(["--help", "-h"])("recognises %s, which the reference ignores", (flag) => {
            expect(parseArgs([flag]).help).toBe(true);
        });

        it("is not implied by anything else", () => {
            expect(parseArgs(["-O2", "a.ssl"]).help).toBe(false);
        });
    });
});
