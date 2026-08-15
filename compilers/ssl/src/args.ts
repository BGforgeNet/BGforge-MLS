/**
 * The command line the reference compiler accepts, parsed into this compiler's options.
 *
 * Two callers share it. The CLI passes a whole argv; the language server passes only the user's
 * `compileOptions` setting, which is a command line for whichever compiler is selected and so has to be
 * read the same way by both. Parsing is therefore pure and total - it reports what it could not honour
 * instead of writing to a stream or exiting, and the caller decides how loud each report should be.
 *
 * Switches are recognised only before the first argument that is not one, and every later argument is an
 * input file, optionally followed by `-o <path>`. That is the reference's own grammar, quirks included:
 * an unknown switch is reported and skipped rather than being fatal, and `-n` written after a file name
 * is a file called `-n`.
 */

/** An input file and, when a `-o` followed it, where its output goes. */
export interface SslInput {
    file: string;
    output?: string;
}

/** Something on the command line this compiler could not honour, phrased for the user. */
export interface ArgNotice {
    /** A switch that changes the output. Both the CLI and the language server refuse to compile. */
    fatal: boolean;
    /**
     * A switch this compiler cannot implement though the reference can, named so that a caller able to
     * offer the other compiler can say so. Absent when the argument is simply malformed, which no choice
     * of compiler fixes.
     */
    unsupported?: string;
    message: string;
}

export interface SslArgs {
    /** Resolved optimisation level. Level 3 is honoured as 2 - see `notices`. */
    level: 0 | 1 | 2;
    shortCircuit: boolean;
    /** `-P`: write the preprocessed source instead of compiling it. */
    preprocessOnly: boolean;
    /** `-l`: suppress the banner. */
    noLogo: boolean;
    /** `-d`: report each stage as it runs. */
    debug: boolean;
    /** `-D`: print the optimised program as source before emitting it. */
    dumpTree: boolean;
    /** `--help` or `-h`, which the reference has no equivalent for. */
    help: boolean;
    defines: Record<string, string>;
    includeDirs: string[];
    inputs: SslInput[];
    notices: ArgNotice[];
}

/**
 * The reference's default, and the one the extension's settings assume. It differs from the level its
 * library build defaults to, which is 0.
 */
const DEFAULT_LEVEL = 1;

/** Highest level this compiler implements. */
const MAX_LEVEL = 2;

/**
 * `atoi`, which is what the reference reads the digits of `-O<n>` with: leading digits win, anything
 * unparseable is zero. `-Ox` therefore means `-O0` rather than being rejected.
 */
function atoi(text: string): number {
    const value = Number.parseInt(text, 10);
    return Number.isNaN(value) ? 0 : value;
}

export function parseArgs(argv: readonly string[]): SslArgs {
    const defines: Record<string, string> = {};
    const includeDirs: string[] = [];
    const inputs: SslInput[] = [];
    const notices: ArgNotice[] = [];
    let requested = DEFAULT_LEVEL;
    let shortCircuit = false;
    let preprocessOnly = false;
    let noLogo = false;
    let debug = false;
    let dumpTree = false;
    let help = false;

    const queue = [...argv];
    for (let arg = queue[0]; arg !== undefined && arg.startsWith("-"); arg = queue[0]) {
        queue.shift();
        if (arg === "--help" || arg === "-h") {
            help = true;
            continue;
        }
        const rest = arg.slice(2);
        switch (arg[1]) {
            // Accepted and ignored by the reference too.
            case "w":
            case "-":
                break;
            // Accepted and ignored here: warnings and the input wait have no counterpart, this compiler
            // always preprocesses, and `-F` governs `#line` directives that its preprocessor never emits.
            case "n":
            case "q":
            case "p":
            case "F":
                break;
            case "l":
                noLogo = true;
                break;
            case "d":
                debug = true;
                break;
            case "D":
                dumpTree = true;
                break;
            case "s":
                shortCircuit = true;
                break;
            case "P":
                preprocessOnly = true;
                break;
            case "O":
                // A bare `-O` is the reference's shorthand for full optimisation.
                requested = rest === "" ? MAX_LEVEL : atoi(rest);
                break;
            case "b":
                notices.push({
                    fatal: true,
                    unsupported: "-b",
                    message:
                        "-b (backward compatibility) is not supported: it removes later keywords - switch, for, " +
                        "foreach, break, continue, pure, inline, tokenize - from the language so that old scripts " +
                        "may use them as names, which this compiler's grammar cannot express.",
                });
                break;
            case "m":
                readDefine(rest, defines, notices);
                break;
            case "I":
                if (rest !== "") includeDirs.push(rest);
                break;
            default:
                notices.push({ fatal: false, message: `Unknown option ${arg}` });
        }
    }

    if (requested > MAX_LEVEL) {
        notices.push({
            fatal: false,
            message:
                `-O${requested} is honoured as -O${MAX_LEVEL}: the passes above that level rename identifiers and ` +
                "share variable slots, which the reference compiler's own source marks as known to break code.",
        });
    }

    for (let arg = queue.shift(); arg !== undefined; arg = queue.shift()) {
        const input: SslInput = { file: arg };
        if (queue[0] === "-o") {
            queue.shift();
            const output = queue.shift();
            if (output === undefined) {
                notices.push({ fatal: true, message: `-o after ${arg} needs an output path.` });
            } else {
                input.output = output;
            }
        }
        inputs.push(input);
    }

    return {
        level: requested < 1 ? 0 : requested < 2 ? 1 : 2,
        shortCircuit,
        preprocessOnly,
        noLogo,
        debug,
        dumpTree,
        help,
        defines,
        includeDirs,
        inputs,
        notices,
    };
}

/** Reads one `-m<name>[=<value>]`, which defines to `1` when no value is given, as the reference does. */
function readDefine(rest: string, defines: Record<string, string>, notices: ArgNotice[]): void {
    if (rest === "") {
        notices.push({ fatal: true, message: "-m needs a macro name, as in -mDEBUG or -mDEBUG=1." });
        return;
    }
    const split = rest.indexOf("=");
    const name = split === -1 ? rest : rest.slice(0, split);
    if (name.includes("(")) {
        notices.push({
            fatal: true,
            message: `-m${rest} defines a macro that takes parameters, which is not supported on the command line.`,
        });
        return;
    }
    defines[name] = split === -1 ? "1" : rest.slice(split + 1);
}
