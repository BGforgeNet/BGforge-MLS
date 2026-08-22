/**
 * One input's worth of work, and what it wanted to say about it.
 *
 * Split out of `cli.ts` so the sequential loop and the worker pool run the SAME code: the pool exists to
 * spend more cores, not to compile differently, and a second implementation is how the two would drift.
 * Nothing here writes to a stream - a worker's `console.log` would interleave with every other worker's
 * mid-line - so output is returned and the main thread prints it in input order.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SslArgs, SslInput } from "./args";
import { buildProgram, emitProgram, toSourceError, toSourceOptions, CompileError } from "./compile";
import { decompileToProgram } from "./int/decompile";
import { formatDisassembly } from "./int/disasm";
import { printProgram } from "./int/print";
import { readInt } from "./int/read";
import { preprocess, preprocessWithOrigins, PreprocessError } from "./preprocess";
import { getParser } from "../../../shared/parsers/fallout-ssl";

/** A line to print, and which stream it belongs on. */
export interface OutputLine {
    stream: "out" | "err";
    text: string;
}

export interface TaskResult {
    ok: boolean;
    lines: OutputLine[];
}

/** Everything one input needs, which is the whole command line minus the other inputs. */
export type TaskArgs = Omit<SslArgs, "inputs" | "notices" | "help" | "jobs">;

/** What an input turned into, and anything about it worth putting on the `-d` line. */
interface Rendered {
    output: string | Uint8Array;
    /** Facts the size cannot carry. Absent where the direction has none worth stating. */
    detail?: string;
}

/** Compiles, preprocesses, decompiles or lists one input, reporting by value rather than to a stream. */
export function runInput(input: SslInput, args: TaskArgs): TaskResult {
    const lines: OutputLine[] = [];
    const out = (text: string): void => void lines.push({ stream: "out", text });
    const err = (text: string): void => void lines.push({ stream: "err", text });

    const { file } = input;
    if (!fs.existsSync(file)) {
        // The reference only warns here and still exits 0. A build that silently succeeds without ever
        // reading its input is the worse behaviour, so a missing file is an error.
        err(`Error: ${file} not found`);
        return { ok: false, lines };
    }
    out(`${args.decompile ? "Decompiling" : args.listing ? "Listing" : "Compiling"} ${file}`);
    const target = input.output ?? defaultOutput(file, outputSuffix(args));
    const started = Date.now();
    let rendered: Rendered;
    try {
        rendered = renderOne(file, args, out, err);
        fs.writeFileSync(target, rendered.output);
    } catch (error) {
        err(describe(error, file));
        return { ok: false, lines };
    }
    if (args.debug) {
        const detail = rendered.detail === undefined ? "" : `, ${rendered.detail}`;
        out(`  ${target} (${fs.statSync(target).size} bytes${detail}, ${Date.now() - started} ms)`);
    }
    return { ok: true, lines };
}

/** What one input turns into, in whichever direction this run is going. */
function renderOne(file: string, args: TaskArgs, out: (text: string) => void, err: (text: string) => void): Rendered {
    if (args.decompile) return decompileOne(file);
    if (args.listing) return { output: formatDisassembly(readInt(new Uint8Array(fs.readFileSync(file)))) };
    if (args.preprocessOnly) {
        return { output: preprocess(file, { includeDirs: args.includeDirs, defines: args.defines }) };
    }
    return { output: compileOne(file, args, out, err) };
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

function compileOne(
    file: string,
    args: TaskArgs,
    out: (text: string) => void,
    err: (text: string) => void,
): Uint8Array {
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
                          err(`Warning: ${warning.file ?? file}:${warning.line}:${warning.column}: ${warning.message}`),
                  }),
        },
        source,
        file,
    );
    try {
        // Not `compilePreprocessed`, which cannot hand the program over for `-D` in between.
        const program = buildProgram(getParser(), source.text, options);
        if (args.dumpTree) out(printProgram(program));
        return emitProgram(program, options);
    } catch (error) {
        throw toSourceError(error, source, file);
    }
}

/** What an output is called when no `-o` said, before the name it would collide with is considered. */
function outputSuffix(args: TaskArgs): string {
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
