/**
 * C preprocessor for Fallout SSL.
 *
 * SSL is preprocessed by an ordinary C preprocessor before the compiler sees it, and real mod builds do this
 * with `gcc -E -x c -P`. So this needs to be *a* conforming preprocessor, not a bug-for-bug copy of any
 * particular one.
 *
 * Supported set is bounded by what the real corpus uses (1599 `.ssl` plus 169 SSL headers): `#include`
 * (literal and computed), `#define` (object-like, function-like and variadic), `#undef`,
 * `#ifdef`/`#ifndef`/`#else`/`#endif`, `#if` with constant expressions, and the `#` and `##` operators.
 * `#pragma` is passed through untouched because it belongs to the compiler, not to us.
 *
 * `#elif` is handled too, and `#error` stops the build with the author's own message. `#line` is accepted
 * and dropped: our diagnostics are reported against the real file, so renumbering would only move later
 * errors to lines the reader cannot open.
 *
 * Anything left - `#warning`, the obsolete `#assert`/`#unassert`/`#ident`/`#sccs`, GNU named-variadic
 * parameters, or an unrecognised directive - throws with a file and line, including inside a conditional
 * branch being skipped. Each was checked against the toolchain's own preprocessor, which rejects them as
 * unknown; being MORE permissive than it is its own defect, because a script that builds here would then
 * fail to build there. The bias is deliberate in both directions: a directive we cannot honour must never
 * be dropped quietly, since a loud refusal is fixable by implementing it while a silent one changes the
 * program invisibly.
 *
 * Expansion follows Prosser's algorithm: tokens carry hide sets and a replacement is spliced back into the
 * stream before rescanning. Expanding a replacement list in isolation is the tempting shortcut and it is
 * wrong - an object-like macro aliasing a function-like one (`#define my_mstr box_mstr`) has to see the
 * `(args)` that follow it in the source.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Macro {
    name: string;
    /** null for an object-like macro. */
    params: string[] | null;
    body: string;
    /** Trailing `...`; surplus arguments bind to `__VA_ARGS__`. */
    variadic: boolean;
}

export interface PreprocessOptions {
    /** Searched after the including file's own directory, as for a quoted include. */
    includeDirs?: string[];
    /** Macros predefined before the entry file is read, as if by `-D`. */
    defines?: Record<string, string>;
    maxIncludeDepth?: number;
}

/** Where one line of preprocessed output came from: a file, and a 1-based line in it. */
export interface LineOrigin {
    file: string;
    line: number;
}

/**
 * Preprocessed text, and the source line each of its lines came from.
 *
 * The compiler positions its diagnostics in this text, where directives have vanished and includes have
 * spliced whole files in - so line numbers here are not the author's. `origins` holds one entry per line
 * of `text`, and is what lets the layer that ran the preprocessor restate a diagnostic against the file
 * and line the author actually wrote. Columns are not mapped: a line that was not macro-expanded keeps
 * its columns, and one that was has no column mapping worth inventing.
 */
export interface PreprocessedSource {
    text: string;
    origins: readonly LineOrigin[];
}

export class PreprocessError extends Error {
    readonly file: string;
    readonly line: number;
    /** The complaint without the `file:line:` prefix, so an aggregate can be rebuilt from one of these. */
    readonly detail: string;
    /**
     * Every problem the run found, this one first.
     *
     * A caller that can only show one error shows this one and behaves exactly as it did before the
     * preprocessor learned to collect them; one that can show more reads the list. A directive error
     * usually invalidates the translation unit - a header that could not be found takes every
     * declaration it carried with it - so these are reported and the compile stops, rather than being
     * carried into a lowering pass that would report hundreds of unknown names derived from them.
     */
    readonly all: readonly PreprocessError[];

    constructor(detail: string, file: string, line: number, all: readonly PreprocessError[] = []) {
        super(`${file}:${line}: ${detail}`);
        this.name = "PreprocessError";
        this.file = file;
        this.line = line;
        this.detail = detail;
        this.all = all.length > 0 ? all : [this];
    }
}

/**
 * How many complaints one run reports before it gives up collecting. A file whose conditionals are badly
 * unbalanced can produce one per directive for the rest of the file, and past the first screenful they
 * are all the same mistake seen again.
 */
const MAX_ERRORS = 100;

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

interface Tok {
    /** Spelling. A whitespace run is one token spelled " ". */
    t: string;
    ws: boolean;
    hide: Set<string>;
}

const EMPTY_HIDE: ReadonlySet<string> = new Set<string>();

const LEX = /(\s+)|("(?:[^"\\]|\\.)*"?)|('(?:[^'\\]|\\.)*'?)|(0[xX][0-9a-fA-F]+|\d+\.?\d*)|([A-Za-z_]\w*)|(##|[^\s])/g;

function tokenize(text: string, hide: Set<string> = EMPTY_HIDE as Set<string>): Tok[] {
    const out: Tok[] = [];
    LEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LEX.exec(text)) !== null) {
        out.push(m[1] === undefined ? { t: m[0], ws: false, hide } : { t: " ", ws: true, hide });
    }
    return out;
}

function isIdent(tok: Tok | undefined): tok is Tok {
    return tok !== undefined && !tok.ws && /^[A-Za-z_]\w*$/.test(tok.t);
}

function spell(toks: readonly Tok[]): string {
    return toks.map((t) => t.t).join("");
}

function trimToks(toks: readonly Tok[]): Tok[] {
    let a = 0;
    let b = toks.length;
    while (a < b && toks[a]?.ws === true) a++;
    while (b > a && toks[b - 1]?.ws === true) b--;
    return toks.slice(a, b);
}

function nextNonWs(toks: readonly Tok[], from: number): number {
    let i = from;
    while (i < toks.length && toks[i]?.ws === true) i++;
    return i;
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
    const out = new Set<string>();
    for (const x of a) if (b.has(x)) out.add(x);
    return out;
}

function withHide(toks: readonly Tok[], hide: ReadonlySet<string>): Tok[] {
    return toks.map((t) => ({ t: t.t, ws: t.ws, hide: new Set([...t.hide, ...hide]) }));
}

function stringifyToks(toks: readonly Tok[]): string {
    const text = spell(trimToks(toks)).replaceAll(/\s+/g, " ");
    return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Macro expansion
// ---------------------------------------------------------------------------

class Expander {
    private readonly macros: Map<string, Macro>;

    /** Set while the last expansion ended inside an argument list that never closed. */
    private unclosedCall = false;

    constructor(macros: Map<string, Macro>) {
        this.macros = macros;
    }

    /** Collect a call's arguments. `toks[open]` must be "(". Returns the index just past the ")". */
    private readArgs(
        toks: readonly Tok[],
        open: number,
    ): { args: Tok[][]; end: number; rparenHide: ReadonlySet<string> } | null {
        let depth = 0;
        const args: Tok[][] = [];
        let current: Tok[] = [];
        for (let i = open; i < toks.length; i++) {
            const tok = toks[i];
            if (tok === undefined) break;
            if (tok.t === "(") {
                depth++;
                if (depth === 1) continue;
            } else if (tok.t === ")") {
                depth--;
                if (depth === 0) {
                    args.push(current);
                    return { args, end: i + 1, rparenHide: tok.hide };
                }
            } else if (tok.t === "," && depth === 1) {
                args.push(current);
                current = [];
                continue;
            }
            current.push(tok);
        }
        return null;
    }

    /** Build a replacement list: parameter substitution plus the # and ## operators. */
    private subst(macro: Macro, args: readonly Tok[][], hide: ReadonlySet<string>): Tok[] {
        const params = macro.params ?? [];
        const bound = new Map<string, Tok[]>();
        params.forEach((p, i) => bound.set(p, args[i] ?? []));
        if (macro.variadic) {
            const rest: Tok[] = [];
            args.slice(params.length).forEach((a, i) => {
                if (i > 0) rest.push({ t: ",", ws: false, hide: EMPTY_HIDE as Set<string> });
                rest.push(...a);
            });
            bound.set("__VA_ARGS__", rest);
        }

        const body = tokenize(macro.body);
        const out: Tok[] = [];

        for (let i = 0; i < body.length; i++) {
            const tok = body[i];
            if (tok === undefined) continue;

            if (tok.t === "#") {
                const j = nextNonWs(body, i + 1);
                const target = body[j];
                if (isIdent(target) && bound.has(target.t)) {
                    out.push({
                        t: stringifyToks(bound.get(target.t) ?? []),
                        ws: false,
                        hide: EMPTY_HIDE as Set<string>,
                    });
                    i = j;
                    continue;
                }
            }

            if (tok.t === "##") {
                while (out.length > 0 && out[out.length - 1]?.ws === true) out.pop();
                const j = nextNonWs(body, i + 1);
                const right = body[j];
                if (right === undefined) {
                    i = j;
                    continue;
                }
                // Both operands of ## are substituted but never expanded.
                const rightToks = isIdent(right) && bound.has(right.t) ? trimToks(bound.get(right.t) ?? []) : [right];
                const left = out.pop();
                out.push(...tokenize((left?.t ?? "") + spell(rightToks), left?.hide ?? (EMPTY_HIDE as Set<string>)));
                i = j;
                continue;
            }

            if (isIdent(tok) && bound.has(tok.t)) {
                const raw = bound.get(tok.t) ?? [];
                // Prescan: an argument is fully expanded unless it is an operand of ##.
                const pasted = body[nextNonWs(body, i + 1)]?.t === "##";
                out.push(...(pasted ? trimToks(raw) : this.expand([...raw])));
                continue;
            }

            out.push(tok);
        }

        return withHide(out, hide);
    }

    /** Expand every invocation in `work`, splicing replacements back in before rescanning. */
    expand(work: Tok[]): Tok[] {
        const out: Tok[] = [];
        let i = 0;
        // Hide sets make non-termination unreachable; this only bounds the blast radius of a bug.
        let budget = 500_000;

        while (i < work.length) {
            if (--budget < 0) throw new Error("macro expansion did not terminate");
            const tok = work[i];
            if (tok === undefined) break;

            if (!isIdent(tok) || tok.hide.has(tok.t)) {
                out.push(tok);
                i++;
                continue;
            }
            const macro = this.macros.get(tok.t);
            if (macro === undefined) {
                out.push(tok);
                i++;
                continue;
            }

            if (macro.params === null) {
                const hide = new Set([...tok.hide, tok.t]);
                work.splice(i, 1, ...withHide(tokenize(macro.body), hide));
                continue; // rescan from i, now able to see what follows
            }

            // A function-like macro only expands when an argument list actually follows.
            const open = nextNonWs(work, i + 1);
            if (work[open]?.t !== "(") {
                out.push(tok);
                i++;
                continue;
            }
            const call = this.readArgs(work, open);
            if (call === null) {
                // The list opened and never closed, so the rest of it is on a line not read yet. Said
                // rather than assumed: to the caller this is indistinguishable from a name that simply
                // is not a call, and only one of the two is worth fetching more input for.
                this.unclosedCall = true;
                out.push(tok);
                i++;
                continue;
            }
            // A no-argument call parses as one empty argument; a zero-parameter macro means none.
            const empty =
                macro.params.length === 0 &&
                !macro.variadic &&
                call.args.length === 1 &&
                trimToks(call.args[0] ?? []).length === 0;
            const hide = new Set([...intersect(tok.hide, call.rparenHide), tok.t]);
            work.splice(i, call.end - i, ...this.subst(macro, empty ? [] : call.args, hide));
        }

        return out;
    }

    expandText(text: string): string {
        return this.expandChunk(text).text;
    }

    /**
     * Expand `text`, also reporting whether it ended inside an argument list still waiting for its
     * closing parenthesis. A caller feeding the source a line at a time uses that to fetch the next one.
     */
    expandChunk(text: string): { text: string; unclosedCall: boolean } {
        this.unclosedCall = false;
        const expanded = spell(this.expand(tokenize(text)));
        return { text: expanded, unclosedCall: this.unclosedCall };
    }
}

// ---------------------------------------------------------------------------
// Translation phases 2 and 3
// ---------------------------------------------------------------------------

function spliceLines(src: string): string {
    return src.replaceAll(/\\\r?\n/g, "");
}

/** Replace each comment with one space, string-aware. Newlines inside block comments are preserved. */
function stripComments(src: string): string {
    const n = src.length;
    let out = "";
    let run = 0;
    let i = 0;
    while (i < n) {
        const c = src.codePointAt(i);
        if (c === 34 || c === 39) {
            i++;
            while (i < n) {
                const d = src.codePointAt(i);
                if (d === 92) {
                    i += 2;
                    continue;
                }
                i++;
                if (d === c || d === 10) break;
            }
            continue;
        }
        if (c === 47) {
            const d = src.codePointAt(i + 1);
            if (d === 42) {
                out += src.slice(run, i);
                let j = i + 2;
                let newlines = 0;
                while (j < n && !(src.codePointAt(j) === 42 && src.codePointAt(j + 1) === 47)) {
                    if (src.codePointAt(j) === 10) newlines++;
                    j++;
                }
                out += newlines === 0 ? " " : ` ${"\n".repeat(newlines)}`;
                i = j + 2;
                run = i;
                continue;
            }
            if (d === 47) {
                out += src.slice(run, i);
                let j = i + 2;
                while (j < n && src.codePointAt(j) !== 10) j++;
                i = j;
                run = i;
                continue;
            }
        }
        i++;
    }
    return run === 0 ? src : out + src.slice(run);
}

// ---------------------------------------------------------------------------
// #if expression evaluation
// ---------------------------------------------------------------------------

const BINARY_PRECEDENCE: Record<string, number> = {
    "*": 10,
    "/": 10,
    "%": 10,
    "+": 9,
    "-": 9,
    "<<": 8,
    ">>": 8,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "==": 6,
    "!=": 6,
    "&": 5,
    "^": 4,
    "|": 3,
    "&&": 2,
    "||": 1,
};

function applyBinary(op: string, left: number, right: number): number {
    switch (op) {
        case "*":
            return left * right;
        // Division by zero is a constraint violation; yield 0 rather than Infinity, which no
        // subsequent integer comparison would handle sensibly.
        case "/":
            return right === 0 ? 0 : Math.trunc(left / right);
        case "%":
            return right === 0 ? 0 : left % right;
        case "+":
            return left + right;
        case "-":
            return left - right;
        case "<<":
            return left << right;
        case ">>":
            return left >> right;
        case "<":
            return left < right ? 1 : 0;
        case ">":
            return left > right ? 1 : 0;
        case "<=":
            return left <= right ? 1 : 0;
        case ">=":
            return left >= right ? 1 : 0;
        case "==":
            return left === right ? 1 : 0;
        case "!=":
            return left !== right ? 1 : 0;
        case "&":
            return left & right;
        case "^":
            return left ^ right;
        case "|":
            return left | right;
        case "&&":
            return left && right ? 1 : 0;
        default:
            return left || right ? 1 : 0;
    }
}

function evalCondition(
    exprText: string,
    expander: Expander,
    macros: ReadonlyMap<string, Macro>,
    file: string,
    line: number,
): boolean {
    // `defined X` and `defined(X)` resolve before expansion, so the operand is never itself expanded.
    let text = exprText.replaceAll(/\bdefined\s*\(\s*([A-Za-z_]\w*)\s*\)|\bdefined\s+([A-Za-z_]\w*)/g, (_m, a, b) =>
        macros.has(a ?? b) ? "1" : "0",
    );
    text = expander.expandText(text);
    // Any identifier surviving expansion evaluates to 0, per the standard.
    text = text.replaceAll(/\b[A-Za-z_]\w*\b/g, "0");

    const tokens = text.match(/0[xX][0-9a-fA-F]+|\d+|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%()<>!~&^|]/g) ?? [];
    let pos = 0;

    const primary = (): number => {
        const t = tokens[pos++];
        if (t === undefined) throw new PreprocessError("malformed #if expression", file, line);
        if (t === "(") {
            const v = binary(1);
            if (tokens[pos++] !== ")") throw new PreprocessError("unbalanced ( in #if", file, line);
            return v;
        }
        if (t === "!") return primary() ? 0 : 1;
        if (t === "~") return ~primary();
        if (t === "-") return -primary();
        if (t === "+") return primary();
        if (/^0[xX]/.test(t)) return parseInt(t, 16);
        if (/^\d+$/.test(t)) return parseInt(t, 10);
        throw new PreprocessError(`unexpected token '${t}' in #if`, file, line);
    };

    function binary(minPrecedence: number): number {
        let left = primary();
        for (;;) {
            const op = tokens[pos];
            const precedence = op === undefined ? undefined : BINARY_PRECEDENCE[op];
            if (precedence === undefined || precedence < minPrecedence) return left;
            pos++;
            left = applyBinary(op as string, left, binary(precedence + 1));
        }
    }

    const value = binary(1);
    if (pos !== tokens.length) throw new PreprocessError("trailing tokens in #if", file, line);
    return value !== 0;
}

// ---------------------------------------------------------------------------
// Directive processing
// ---------------------------------------------------------------------------

const DIRECTIVE = /^[ \t]*#[ \t]*([A-Za-z_]\w*)?[ \t]*([\s\S]*)$/;
const INCLUDE_OPERAND = /^\s*"([^"]+)"|^\s*<([^>]+)>/;
// Directives the toolchain's own preprocessor rejects as unknown, verified against it. Refusing them is
// what keeps this compiler from accepting scripts that then fail to build there; `#warning` in
// particular looks harmless enough to wave through, and is not. `#error`, `#line` and `#elif` are
// accepted there and are handled individually below.
const UNSUPPORTED = new Set(["warning", "assert", "unassert", "ident", "sccs"]);

interface Conditional {
    active: boolean;
    /** Whether any branch of this group has already been taken. */
    taken: boolean;
    parentActive: boolean;
}

interface State {
    macros: Map<string, Macro>;
    expander: Expander;
    out: string[];
    /** One entry per line of the joined output; every push to `out` records its lines' origins here. */
    origins: LineOrigin[];
    options: PreprocessOptions;
    depth: number;
    errors: PreprocessError[];
}

/**
 * Records a complaint and says whether to keep going. The same header included twice by two files that
 * do not guard it repeats every error inside it, so identical complaints are folded.
 */
function record(state: State, error: PreprocessError): boolean {
    const seen = state.errors.some(
        (other) => other.file === error.file && other.line === error.line && other.detail === error.detail,
    );
    if (!seen) state.errors.push(error);
    return state.errors.length < MAX_ERRORS;
}

/**
 * Runs a step that reports by throwing, and folds its refusal into the collected list.
 *
 * `evalCondition` and `parseDefine` are recursive-descent parsers that report from deep inside
 * themselves; threading a collector through them would tangle both to no benefit, since neither has any
 * useful way to continue past its own error. Catching at the call site keeps the recovery decision -
 * which arm to take, which definition to drop - where the surrounding context can make it.
 */
function attempt<T>(state: State, step: () => T): T | null {
    try {
        return step();
    } catch (error) {
        if (!(error instanceof PreprocessError)) throw error;
        record(state, error);
        return null;
    }
}

/**
 * Parsed `#define` operands, keyed on the text after the directive. A header's definitions are re-parsed
 * once per script that includes it - the same few thousand lines, some fifteen hundred times over.
 */
const DEFINE_CACHE = new Map<string, Macro>();

function parseDefine(rest: string, file: string, line: number): Macro {
    const cached = DEFINE_CACHE.get(rest);
    if (cached !== undefined) return cached;
    const parsed = parseDefineText(rest, file, line);
    DEFINE_CACHE.set(rest, parsed);
    return parsed;
}

/** A `Macro` is derived entirely from `rest`; `file` and `line` only position the complaint. */
function parseDefineText(rest: string, file: string, line: number): Macro {
    const m = /^([A-Za-z_]\w*)(\(([^)]*)\))?([\s\S]*)$/.exec(rest);
    if (m === null) throw new PreprocessError("malformed #define", file, line);
    const [, name, parenGroup, paramList, rawBody] = m;
    if (name === undefined) throw new PreprocessError("malformed #define", file, line);
    const body = (rawBody ?? "").trim();
    if (parenGroup === undefined) return { name, params: null, body, variadic: false };

    const declared = (paramList ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const variadic = declared[declared.length - 1] === "...";
    const params = variadic ? declared.slice(0, -1) : declared;
    if (params.some((p) => p.endsWith("..."))) {
        // GNU's named-variadic spelling. Deliberately refused rather than implemented: the toolchain's
        // own preprocessor rejects it too ("Missing "," or ")" in parameter list"), so accepting it here
        // would let a script build with this compiler and fail with the other one. Use `...` and
        // `__VA_ARGS__`, which both accept.
        throw new PreprocessError("named variadic parameters are not supported", file, line);
    }
    return { name, params, body, variadic };
}

function resolveInclude(rawSpec: string, fromDir: string, options: PreprocessOptions): string | null {
    // Fallout mods are Windows-authored and some spell includes `..\headers\define.h`. A host cpp on a
    // non-Windows box rejects those outright; normalising is correct for this ecosystem.
    const spec = rawSpec.replaceAll("\\", "/");
    const candidates = [path.resolve(fromDir, spec), ...(options.includeDirs ?? []).map((d) => path.resolve(d, spec))];
    return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function processFile(file: string, state: State): void {
    if (state.depth > (state.options.maxIncludeDepth ?? 64)) {
        record(state, new PreprocessError("include nesting too deep", file, 0));
        return;
    }
    processSource(preparedLines(file), file, state);
}

/**
 * How many lines an argument list may be drawn across before it is taken to be unterminated rather than
 * long. A real one spans two or three; the bound is what stops an unclosed parenthesis - which is most of
 * the time an editor buffer mid-keystroke - walking to the end of the file, since each line drawn in
 * re-expands everything gathered so far.
 */
const MAX_CALL_LINES = 32;

/**
 * Expands the line at `n`, drawing in the lines after it while a function-like macro's argument list is
 * still open - the list ends at its closing parenthesis, which may be several lines down, and a header's
 * debug macro taking a long concatenated string routinely puts it there.
 *
 * Whatever it consumes it gives back as blank lines, so nothing below a split call moves: errors are
 * reported against these coordinates, and a swallowed newline would put every later one off by a line.
 *
 * @returns the last line index consumed, which the caller's loop continues from.
 */
function expandFrom(state: State, lines: readonly string[], n: number, file: string): number {
    let text = lines[n] ?? "";
    let last = n;
    let result = state.expander.expandChunk(text);
    while (result.unclosedCall && last + 1 < lines.length && last - n < MAX_CALL_LINES) {
        last++;
        text += `\n${lines[last] ?? ""}`;
        result = state.expander.expandChunk(text);
    }
    state.out.push(result.text);
    // Only the newlines the expansion swallowed need replacing; any it left in place already count.
    const kept = result.text.split("\n").length - 1;
    for (let i = kept; i < last - n; i++) state.out.push("");
    // Output and input lines correspond one-to-one across the whole consumption - the expansion's own
    // lines first, then the fillers - so each output line names the input line at its own offset.
    for (let line = n; line <= last; line++) state.origins.push({ file, line: line + 1 });
    return last;
}

/**
 * A file's line form, which no macro state takes part in - so an included file yields the same lines
 * every time, and a build re-includes the same handful of headers once per script. Stamped with mtime
 * and size because the language server's compile worker outlives a user's edits to a header.
 */
const LINE_CACHE = new Map<string, { stamp: string; lines: readonly string[] }>();

function preparedLines(file: string): readonly string[] {
    let stamp: string;
    try {
        const stat = fs.statSync(file);
        stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
        // Let the read report the failure, as it did when there was no cache in front of it.
        LINE_CACHE.delete(file);
        return prepare(fs.readFileSync(file, "latin1"));
    }
    const cached = LINE_CACHE.get(file);
    if (cached !== undefined && cached.stamp === stamp) return cached.lines;
    // latin1 keeps the byte-for-byte content of legacy cp1252 sources intact.
    const lines = prepare(fs.readFileSync(file, "latin1"));
    LINE_CACHE.set(file, { stamp, lines });
    return lines;
}

/** Translation phases 2 and 3, then the split into lines the directive walk reads. */
function prepare(text: string): readonly string[] {
    return stripComments(spliceLines(text)).split(/\r?\n/);
}

/**
 * One translation unit, as text or as the lines a caller already prepared. `file` is not read - it says
 * where a quoted `#include` looks and which file an error names, so a buffer that has never been saved
 * can be preprocessed under the path it would occupy.
 */
function processSource(input: string | readonly string[], file: string, state: State): void {
    const lines = typeof input === "string" ? prepare(input) : input;
    const dir = path.dirname(file);
    const stack: Conditional[] = [];
    const emitting = (): boolean => stack.every((s) => s.active);

    for (let n = 0; n < lines.length; n++) {
        const line = lines[n] ?? "";
        const directive = /^[ \t]*#/.test(line) ? DIRECTIVE.exec(line) : null;
        if (directive === null) {
            if (emitting()) n = expandFrom(state, lines, n, file);
            continue;
        }
        const name = directive[1] ?? "";
        const rest = directive[2] ?? "";

        switch (name) {
            case "ifdef":
            case "ifndef": {
                const id = rest.trim().split(/\s+/)[0] ?? "";
                const want = state.macros.has(id) === (name === "ifdef");
                const parentActive = emitting();
                stack.push({ active: parentActive && want, taken: want, parentActive });
                break;
            }
            case "if": {
                const parentActive = emitting();
                // A nested #if inside a dead branch is never evaluated - its operands may be meaningless.
                // A condition that will not evaluate is taken as false, which is the reading that keeps
                // the rest of the file scannable; the complaint is already recorded either way.
                const want =
                    parentActive &&
                    (attempt(state, () => evalCondition(rest, state.expander, state.macros, file, n + 1)) ?? false);
                stack.push({ active: want, taken: want, parentActive });
                break;
            }
            case "else": {
                const top = stack[stack.length - 1];
                if (top === undefined) {
                    if (!record(state, new PreprocessError("#else without #if", file, n + 1))) return;
                    break;
                }
                top.active = top.parentActive && !top.taken;
                top.taken = true;
                break;
            }
            case "endif": {
                if (stack.pop() === undefined) {
                    if (!record(state, new PreprocessError("#endif without #if", file, n + 1))) return;
                }
                break;
            }
            case "elif": {
                const top = stack[stack.length - 1];
                if (top === undefined) {
                    if (!record(state, new PreprocessError("#elif without #if", file, n + 1))) return;
                    break;
                }
                // A group takes at most one branch: once something has been taken this arm is dead and
                // its condition is never evaluated, which matters because the operands of a dead arm may
                // be meaningless (the guard clause of a `defined`-style chain relies on exactly that).
                if (top.taken) {
                    top.active = false;
                    break;
                }
                const want =
                    top.parentActive &&
                    (attempt(state, () => evalCondition(rest, state.expander, state.macros, file, n + 1)) ?? false);
                top.active = want;
                top.taken = want;
                break;
            }
            case "define": {
                if (!emitting()) break;
                // A definition that will not parse is skipped rather than guessed at. Uses of the name go
                // on to expand to nothing, but the run is already doomed, so nothing downstream sees it.
                const macro = attempt(state, () => parseDefine(rest, file, n + 1));
                if (macro) state.macros.set(macro.name, macro);
                break;
            }
            case "undef": {
                if (!emitting()) break;
                state.macros.delete(rest.trim().split(/\s+/)[0] ?? "");
                break;
            }
            case "include": {
                if (!emitting()) break;
                // A computed include names its header through a macro, so expand before matching.
                let spec = INCLUDE_OPERAND.exec(rest);
                if (spec === null) spec = INCLUDE_OPERAND.exec(state.expander.expandText(rest));
                if (spec === null) {
                    if (!record(state, new PreprocessError(`malformed #include: ${rest.trim()}`, file, n + 1))) return;
                    break;
                }
                const target = spec[1] ?? spec[2] ?? "";
                const resolved = resolveInclude(target, dir, state.options);
                if (resolved === null) {
                    // Skipping the header loses every declaration it carried, which would be a disaster if
                    // the run continued into lowering - it does not, which is why this can be collected.
                    if (!record(state, new PreprocessError(`cannot find include "${target}"`, file, n + 1))) return;
                    break;
                }
                state.depth++;
                processFile(resolved, state);
                state.depth--;
                break;
            }
            case "pragma":
                // A pragma is the COMPILER's, not ours: `#pragma sce` turns on short-circuit evaluation of
                // boolean operators. Dropping one silently changes how `and`/`or` compile, so pass the
                // line through untouched, as gcc -E does.
                if (emitting()) {
                    state.out.push(line);
                    state.origins.push({ file, line: n + 1 });
                }
                break;
            case "error":
                // The whole point of the directive is to stop the build with the author's own message.
                // Inert in a dead branch, where its operands are not meant to be read at all. Scanning
                // continues so the rest of the file is still checked, but the build stops all the same.
                if (emitting() && !record(state, new PreprocessError(`#error ${rest.trim()}`, file, n + 1))) return;
                break;
            case "line":
                // Renumbering only affects diagnostics, and ours are reported against the real file, so
                // honouring it would move every later error to a line the reader cannot open. Dropped
                // rather than refused: it changes nothing about the translation unit itself, and the
                // toolchain's own preprocessor accepts it.
                break;
            case "":
                // Null directive: no operands, no effect, nothing to lose by dropping it.
                break;
            default:
                // Deliberately refused even inside a branch being skipped. A conforming preprocessor may
                // ignore these there, but silence is the wrong default for a directive we cannot honour:
                // being loud is recoverable by implementing it, being silent is not detectable at all.
                if (
                    !record(
                        state,
                        new PreprocessError(
                            UNSUPPORTED.has(name) ? `#${name} is not supported` : `unknown directive #${name}`,
                            file,
                            n + 1,
                        ),
                    )
                ) {
                    return;
                }
        }
    }

    if (stack.length > 0) record(state, new PreprocessError("unterminated #if", file, lines.length));
}

/** Preprocess `entry` and return the translation unit, directives removed and macros expanded. */
export function preprocess(entry: string, options: PreprocessOptions = {}): string {
    return preprocessWithOrigins(entry, options).text;
}

/** As `preprocess`, also reporting which file and line each output line came from. */
export function preprocessWithOrigins(entry: string, options: PreprocessOptions = {}): PreprocessedSource {
    return runPreprocessor(options, (state) => processFile(path.resolve(entry), state));
}

/**
 * Preprocesses source held in memory as if it were the file at `entry`, which is never read. An editor
 * compiles the buffer the user is looking at rather than what was last saved, so this is what lets it
 * do that without first writing a copy next to their source.
 */
export function preprocessText(text: string, entry: string, options: PreprocessOptions = {}): string {
    return preprocessTextWithOrigins(text, entry, options).text;
}

/** As `preprocessText`, also reporting which file and line each output line came from. */
export function preprocessTextWithOrigins(
    text: string,
    entry: string,
    options: PreprocessOptions = {},
): PreprocessedSource {
    return runPreprocessor(options, (state) => processSource(text, path.resolve(entry), state));
}

function runPreprocessor(options: PreprocessOptions, walk: (state: State) => void): PreprocessedSource {
    const macros = new Map<string, Macro>();
    for (const [name, body] of Object.entries(options.defines ?? {})) {
        macros.set(name, { name, params: null, body, variadic: false });
    }
    const state: State = {
        macros,
        expander: new Expander(macros),
        out: [],
        origins: [],
        options,
        depth: 0,
        errors: [],
    };
    walk(state);
    const first = state.errors[0];
    if (first) throw new PreprocessError(first.detail, first.file, first.line, state.errors);
    return { text: state.out.join("\n"), origins: state.origins };
}
