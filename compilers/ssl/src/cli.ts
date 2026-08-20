#!/usr/bin/env node
/**
 * Command-line front end for the Fallout SSL compiler.
 *
 * The switches are the reference compiler's, so an existing build script can call this in its place;
 * `args.ts` documents where the two differ and the README lists it for users. Everything this compiler
 * cannot honour is reported rather than ignored, because each such switch changes the output and a
 * silently different .int is worse than a refusal.
 *
 * Several inputs are compiled in parallel (`cli-pool.ts`); one input runs here on the main thread, where
 * starting a worker would cost more than it saves.
 */

import { parseArgs, type SslArgs } from "./args";
import { runPool, workerCount } from "./cli-pool";
import { runInput, type OutputLine, type TaskArgs } from "./cli-task";
import { initParser } from "../../../shared/parsers/fallout-ssl";

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
  -j<n> compile n inputs at once (default: one per core; -j1 to disable)
  -m<macro>[=<val>]  define a macro named "macro" for conditional compilation
  -I<path>  specify an additional directory to search for include files
  -x, --decompile  read a compiled script and write its source (.int -> .ssl)
  -X, --listing    read a compiled script and write its instruction listing (.int -> .lst)
  -h, --help  show this help`;

const LOGO = "BGforge SSL compiler\n";

/** The command line minus the parts that are about the run rather than about one input. */
function taskArgs(args: SslArgs): TaskArgs {
    return {
        level: args.level,
        shortCircuit: args.shortCircuit,
        preprocessOnly: args.preprocessOnly,
        noLogo: args.noLogo,
        noWarnings: args.noWarnings,
        debug: args.debug,
        dumpTree: args.dumpTree,
        decompile: args.decompile,
        listing: args.listing,
        defines: args.defines,
        includeDirs: args.includeDirs,
    };
}

function emit(line: OutputLine): void {
    if (line.stream === "out") console.log(line.text);
    else console.error(line.text);
}

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

    const task = taskArgs(args);
    // Only compiling needs the grammar, and loading it is the slowest part of a run. Decompiling reads
    // bytecode and never parses source, so it starts without paying for it.
    const needsGrammar = !args.preprocessOnly && !args.decompile && !args.listing && args.inputs.length > 0;
    const jobs = args.inputs.length > 1 ? workerCount(args.jobs, args.inputs.length) : 1;

    let failures = 0;
    if (jobs > 1) {
        failures = await runPool(args.inputs, task, jobs, emit);
    } else {
        if (needsGrammar) await initParser();
        for (const input of args.inputs) {
            const result = runInput(input, task);
            for (const line of result.lines) emit(line);
            if (!result.ok) failures++;
        }
    }
    if (failures > 0) {
        console.error(`\n*** THERE WERE ERRORS (${failures} of them) ***`);
        return 1;
    }
    return 0;
}

process.exitCode = await main(process.argv.slice(2));
