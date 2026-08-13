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

export class PreprocessError extends Error {
    readonly file: string;
    readonly line: number;

    constructor(message: string, file: string, line: number) {
        super(`${file}:${line}: ${message}`);
        this.name = "PreprocessError";
        this.file = file;
        this.line = line;
    }
}

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
        return spell(this.expand(tokenize(text)));
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
    let out = "";
    for (let i = 0; i < src.length;) {
        const c = src[i];
        if (c === '"' || c === "'") {
            const quote = c;
            out += c;
            i++;
            while (i < src.length) {
                if (src[i] === "\\") {
                    out += src[i] + (src[i + 1] ?? "");
                    i += 2;
                    continue;
                }
                out += src[i];
                const done = src[i] === quote || src[i] === "\n";
                i++;
                if (done) break;
            }
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            i += 2;
            let newlines = "";
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
                if (src[i] === "\n") newlines += "\n";
                i++;
            }
            i += 2;
            out += ` ${newlines}`;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            while (i < src.length && src[i] !== "\n") i++;
            continue;
        }
        out += c;
        i++;
    }
    return out;
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
    options: PreprocessOptions;
    depth: number;
}

function parseDefine(rest: string, file: string, line: number): Macro {
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
        throw new PreprocessError("include nesting too deep", file, 0);
    }
    // latin1 keeps the byte-for-byte content of legacy cp1252 sources intact.
    const lines = stripComments(spliceLines(fs.readFileSync(file, "latin1"))).split(/\r?\n/);
    const dir = path.dirname(file);
    const stack: Conditional[] = [];
    const emitting = (): boolean => stack.every((s) => s.active);

    for (let n = 0; n < lines.length; n++) {
        const line = lines[n] ?? "";
        const directive = /^[ \t]*#/.test(line) ? DIRECTIVE.exec(line) : null;
        if (directive === null) {
            if (emitting()) state.out.push(state.expander.expandText(line));
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
                const want = parentActive && evalCondition(rest, state.expander, state.macros, file, n + 1);
                stack.push({ active: want, taken: want, parentActive });
                break;
            }
            case "else": {
                const top = stack[stack.length - 1];
                if (top === undefined) throw new PreprocessError("#else without #if", file, n + 1);
                top.active = top.parentActive && !top.taken;
                top.taken = true;
                break;
            }
            case "endif": {
                if (stack.pop() === undefined) throw new PreprocessError("#endif without #if", file, n + 1);
                break;
            }
            case "elif": {
                const top = stack[stack.length - 1];
                if (top === undefined) throw new PreprocessError("#elif without #if", file, n + 1);
                // A group takes at most one branch: once something has been taken this arm is dead and
                // its condition is never evaluated, which matters because the operands of a dead arm may
                // be meaningless (the guard clause of a `defined`-style chain relies on exactly that).
                if (top.taken) {
                    top.active = false;
                    break;
                }
                const want = top.parentActive && evalCondition(rest, state.expander, state.macros, file, n + 1);
                top.active = want;
                top.taken = want;
                break;
            }
            case "define": {
                if (!emitting()) break;
                const macro = parseDefine(rest, file, n + 1);
                state.macros.set(macro.name, macro);
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
                if (spec === null) throw new PreprocessError(`malformed #include: ${rest.trim()}`, file, n + 1);
                const target = spec[1] ?? spec[2] ?? "";
                const resolved = resolveInclude(target, dir, state.options);
                if (resolved === null) throw new PreprocessError(`cannot find include "${target}"`, file, n + 1);
                state.depth++;
                processFile(resolved, state);
                state.depth--;
                break;
            }
            case "pragma":
                // A pragma is the COMPILER's, not ours: `#pragma sce` turns on short-circuit evaluation of
                // boolean operators. Dropping one silently changes how `and`/`or` compile, so pass the
                // line through untouched, as gcc -E does.
                if (emitting()) state.out.push(line);
                break;
            case "error":
                // The whole point of the directive is to stop the build with the author's own message.
                // Inert in a dead branch, where its operands are not meant to be read at all.
                if (emitting()) throw new PreprocessError(`#error ${rest.trim()}`, file, n + 1);
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
                if (UNSUPPORTED.has(name)) throw new PreprocessError(`#${name} is not supported`, file, n + 1);
                throw new PreprocessError(`unknown directive #${name}`, file, n + 1);
        }
    }

    if (stack.length > 0) throw new PreprocessError("unterminated #if", file, lines.length);
}

/** Preprocess `entry` and return the translation unit, directives removed and macros expanded. */
export function preprocess(entry: string, options: PreprocessOptions = {}): string {
    const macros = new Map<string, Macro>();
    for (const [name, body] of Object.entries(options.defines ?? {})) {
        macros.set(name, { name, params: null, body, variadic: false });
    }
    const state: State = { macros, expander: new Expander(macros), out: [], options, depth: 0 };
    processFile(path.resolve(entry), state);
    return state.out.join("\n");
}
