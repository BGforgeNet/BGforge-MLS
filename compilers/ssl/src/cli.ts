#!/usr/bin/env node
/**
 * Command-line front end for the Fallout SSL compiler.
 *
 * The switches are the reference compiler's, so an existing build script can call this in its place;
 * `args.ts` documents where the two differ and the README lists it for users. Everything this compiler
 * cannot honour is reported rather than ignored, because each such switch changes the output and a
 * silently different .int is worse than a refusal.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs, type SslArgs, type SslInput } from "./args";
import { buildProgram, emitProgram, CompileError } from "./compile";
import { printProgram } from "./int/print";
import { preprocess, PreprocessError } from "./preprocess";
import { initParser, getParser } from "../../../shared/parsers/fallout-ssl";

const USAGE = `Usage: ssl {switches} filename [-o outputname] [filename [..]]
  -q    accepted and ignored (this compiler never waits for input)
  -n    accepted and ignored (this compiler emits no warnings)
  -b    not supported: backward compatibility mode
  -l    no logo
  -p    accepted and ignored (this compiler always preprocesses)
  -P    preprocess only (don't generate .int)
  -F    accepted and ignored (this compiler emits no #line directives)
  -O<level>  optimize code
             0 - none
             1 - only remove unreferenced variables/procedures (default)
             2 - full (same as -O)
             3 - honoured as 2
  -d    show debug info
  -s    enable short-circuit evaluation for boolean operators (AND, OR)
  -D    dump the program as source after optimizations
  -m<macro>[=<val>]  define a macro named "macro" for conditional compilation
  -I<path>  specify an additional directory to search for include files
  -h, --help  show this help`;

const LOGO = "BGforge SSL compiler\n";

async function main(argv: readonly string[]): Promise<number> {
    const args = parseArgs(argv);

    if (args.help || argv.length === 0) {
        console.log(`${LOGO}\n${USAGE}`);
        // No arguments at all is an error, as it is for the reference; an explicit --help is not.
        return args.help ? 0 : 1;
    }

    for (const notice of args.notices) {
        console.error(notice.fatal ? `Error: ${notice.message}` : `Warning: ${notice.message}`);
    }
    if (args.notices.some((notice) => notice.fatal)) return 1;

    if (!args.noLogo) console.log(LOGO);

    // Only compiling needs the grammar, and loading it is the slowest part of a run.
    if (!args.preprocessOnly && args.inputs.length > 0) await initParser();

    let failures = 0;
    for (const input of args.inputs) {
        if (!processOne(input, args)) failures++;
    }
    if (failures > 0) {
        console.error(`\n*** THERE WERE ERRORS (${failures} of them) ***`);
        return 1;
    }
    return 0;
}

/** Compiles or preprocesses one input, reporting to the console. Returns false when it failed. */
function processOne(input: SslInput, args: SslArgs): boolean {
    const { file } = input;
    if (!fs.existsSync(file)) {
        // The reference only warns here and still exits 0. A build that silently succeeds without ever
        // reading its input is the worse behaviour, so a missing file is an error.
        console.error(`Error: ${file} not found`);
        return false;
    }
    console.log(`Compiling ${file}`);
    const target = input.output ?? defaultOutput(file, args.preprocessOnly);
    const started = Date.now();
    try {
        fs.writeFileSync(target, args.preprocessOnly ? preprocessOne(file, args) : compileOne(file, args));
    } catch (error) {
        console.error(describe(error, file));
        return false;
    }
    if (args.debug) console.log(`  ${target} (${fs.statSync(target).size} bytes, ${Date.now() - started} ms)`);
    return true;
}

function preprocessOne(file: string, args: SslArgs): string {
    return preprocess(file, { includeDirs: args.includeDirs, defines: args.defines });
}

function compileOne(file: string, args: SslArgs): Uint8Array {
    const options = { level: args.level, shortCircuit: args.shortCircuit };
    const program = buildProgram(getParser(), preprocessOne(file, args), options);
    if (args.dumpTree) console.log(printProgram(program));
    return emitProgram(program, options);
}

/**
 * Where output goes when no `-o` did. The reference builds this from the whole path, which misnames the
 * output whenever a parent directory holds the last dot; this reads the extension off the file name
 * alone. A source already named `.int` would otherwise be overwritten, so it gains a `1`.
 */
function defaultOutput(file: string, preprocessOnly: boolean): string {
    const base = path.basename(file);
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const suffix = preprocessOnly ? ".preprocessed.ssl" : ".int";
    return path.join(path.dirname(file), stem + suffix === base ? `${stem}1${suffix}` : stem + suffix);
}

/** One line naming the file and, where the error knows it, the position inside it. */
function describe(error: unknown, file: string): string {
    if (error instanceof PreprocessError) return `Error: ${error.message}`;
    if (error instanceof CompileError) return `Error: ${file}:${error.message}`;
    return `Error: ${file}: ${error instanceof Error ? error.message : String(error)}`;
}

process.exitCode = await main(process.argv.slice(2));
