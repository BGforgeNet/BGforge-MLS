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

    it("collects switches that change nothing here without complaint", () => {
        const args = parseArgs(["-q", "-n", "-p", "-F", "-w", "--", "a.ssl"]);
        expect(args.notices).toEqual([]);
        expect(args.inputs).toEqual([{ file: "a.ssl" }]);
    });

    it("reports an unknown switch without making it fatal", () => {
        const args = parseArgs(["-Z", "a.ssl"]);
        expect(args.notices).toEqual([{ fatal: false, message: "Unknown option -Z" }]);
        expect(args.inputs).toEqual([{ file: "a.ssl" }]);
    });

    it("refuses -b, naming what it would change", () => {
        const args = parseArgs(["-b", "a.ssl"]);
        expect(args.notices).toEqual([{ fatal: true, message: expect.stringContaining("backward compatibility") }]);
    });

    it("sets the flags that reach the compiler", () => {
        const args = parseArgs(["-s", "-P", "-l", "-d", "-D", "a.ssl"]);
        expect(args).toMatchObject({
            shortCircuit: true,
            preprocessOnly: true,
            noLogo: true,
            debug: true,
            dumpTree: true,
        });
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

    describe("help", () => {
        it.each(["--help", "-h"])("recognises %s, which the reference ignores", (flag) => {
            expect(parseArgs([flag]).help).toBe(true);
        });

        it("is not implied by anything else", () => {
            expect(parseArgs(["-O2", "a.ssl"]).help).toBe(false);
        });
    });
});
