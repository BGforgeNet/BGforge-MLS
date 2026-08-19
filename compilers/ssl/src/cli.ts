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
import { buildProgram, emitProgram, toSourceError, toSourceOptions, CompileError } from "./compile";
import { decompileToProgram } from "./int/decompile";
import { formatDisassembly } from "./int/disasm";
import { printProgram } from "./int/print";
import { readInt } from "./int/read";
import { preprocess, preprocessWithOrigins, PreprocessError } from "./preprocess";
import { initParser, getParser } from "../../../shared/parsers/fallout-ssl";

const USAGE = `Usage: ssl {switches} filename [-o outputname] [filename [..]]
  -q    accepted and ignored (this compiler never waits for input)
  -n    no warnings
  -b    not supported: backward compatibility mode
  -l    no logo
  -p    accepted and ignored (this compiler always preprocesses)
  -P    preprocess only (don't generate .int)
  -F    accepted and ignored (this compiler emits no #line directives)
  -w    accepted and ignored (no effect in the reference either)
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
  -x, --decompile  read a compiled script and write its source (.int -> .ssl)
  -X, --listing    read a compiled script and write its instruction listing (.int -> .lst)
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
        // A switch that did nothing is not a warning - the command line is valid and the output is what
        // it would have been - so `-n` silences it along with the rest of what is merely informative.
        if (notice.noop) {
            if (!args.noWarnings) console.error(`Note: ${notice.message}`);
            continue;
        }
        console.error(notice.fatal ? `Error: ${notice.message}` : `Warning: ${notice.message}`);
    }
    if (args.notices.some((notice) => notice.fatal)) return 1;

    if (!args.noLogo) console.log(LOGO);

    // Only compiling needs the grammar, and loading it is the slowest part of a run. Decompiling reads
    // bytecode and never parses source, so it starts without paying for it.
    if (!args.preprocessOnly && !args.decompile && !args.listing && args.inputs.length > 0) await initParser();

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
    console.log(`${args.decompile ? "Decompiling" : args.listing ? "Listing" : "Compiling"} ${file}`);
    const target = input.output ?? defaultOutput(file, outputSuffix(args));
    const started = Date.now();
    let rendered: Rendered;
    try {
        rendered = renderOne(file, args);
        fs.writeFileSync(target, rendered.output);
    } catch (error) {
        console.error(describe(error, file));
        return false;
    }
    if (args.debug) {
        const detail = rendered.detail === undefined ? "" : `, ${rendered.detail}`;
        console.log(`  ${target} (${fs.statSync(target).size} bytes${detail}, ${Date.now() - started} ms)`);
    }
    return true;
}

function preprocessOne(file: string, args: SslArgs): string {
    return preprocess(file, { includeDirs: args.includeDirs, defines: args.defines });
}

/** What an input turned into, and anything about it worth putting on the `-d` line. */
interface Rendered {
    output: string | Uint8Array;
    /** Facts the size cannot carry. Absent where the direction has none worth stating. */
    detail?: string;
}

/** What one input turns into, in whichever direction this run is going. */
function renderOne(file: string, args: SslArgs): Rendered {
    if (args.decompile) return decompileOne(file);
    if (args.listing) return { output: formatDisassembly(readInt(new Uint8Array(fs.readFileSync(file)))) };
    return { output: args.preprocessOnly ? preprocessOne(file, args) : compileOne(file, args) };
}

/** `n thing`, or `n things` - a count reads as a miscount when its noun disagrees with it. */
function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Recovers a compiled script as source. The origin is the file's NAME rather than the path it was read
 * from: the comment is written into a file someone may keep, and the absolute path of the machine that
 * produced it means nothing anywhere else.
 *
 * The counts go on the `-d` line because a decompile cannot fail loudly the way a compile does - it
 * always produces plausible source, so its size is no evidence that the whole file came back.
 */
function decompileOne(file: string): Rendered {
    const program = decompileToProgram(new Uint8Array(fs.readFileSync(file)));
    const procedures = program.declarations.filter((declaration) => declaration.kind === "procedure").length;
    return {
        output: printProgram(program, { origin: path.basename(file) }),
        detail: `${count(procedures, "procedure")}, ${count(program.stringLiterals?.length ?? 0, "string")}`,
    };
}

function compileOne(file: string, args: SslArgs): Uint8Array {
    const source = preprocessWithOrigins(file, { includeDirs: args.includeDirs, defines: args.defines });
    // Warnings and errors alike are restated in SOURCE coordinates - the compiler positions them in the
    // preprocessed text, whose lines are not the author's once a directive has vanished from it.
    const options = toSourceOptions(
        {
            level: args.level,
            shortCircuit: args.shortCircuit,
            // `-n` leaves the sink off entirely rather than filtering afterwards, so the checks that exist
            // only to fill it do not run at all.
            ...(args.noWarnings
                ? {}
                : {
                      onWarning: (warning: { file?: string; line: number; column: number; message: string }) =>
                          console.error(
                              `Warning: ${warning.file ?? file}:${warning.line}:${warning.column}: ${warning.message}`,
                          ),
                  }),
        },
        source,
        file,
    );
    try {
        // Not `compilePreprocessed`, which cannot hand the program over for `-D` in between.
        const program = buildProgram(getParser(), source.text, options);
        if (args.dumpTree) console.log(printProgram(program));
        return emitProgram(program, options);
    } catch (error) {
        throw toSourceError(error, source, file);
    }
}

/** What an output is called when no `-o` said, before the name it would collide with is considered. */
function outputSuffix(args: SslArgs): string {
    if (args.decompile) return ".ssl";
    if (args.listing) return ".lst";
    return args.preprocessOnly ? ".preprocessed.ssl" : ".int";
}

/**
 * Where output goes when no `-o` did. The reference builds this from the whole path, which misnames the
 * output whenever a parent directory holds the last dot; this reads the extension off the file name
 * alone. A source already named `.int` would otherwise be overwritten, so it gains a `1` - which guards
 * decompiling too, where an input already named `.ssl` would otherwise be truncated as it was read.
 */
function defaultOutput(file: string, suffix: string): string {
    const base = path.basename(file);
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    return path.join(path.dirname(file), stem + suffix === base ? `${stem}1${suffix}` : stem + suffix);
}

/** One line naming the file and, where the error knows it, the position inside it. */
function describe(error: unknown, file: string): string {
    if (error instanceof PreprocessError) return `Error: ${error.message}`;
    // A diagnostic naming its own file sits in an included header; the message's line belongs to it.
    if (error instanceof CompileError) return `Error: ${error.diagnostics[0]?.file ?? file}:${error.message}`;
    return `Error: ${file}: ${error instanceof Error ? error.message : String(error)}`;
}

process.exitCode = await main(process.argv.slice(2));
