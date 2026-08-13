/**
 * Renders the recovered IR as Fallout SSL source.
 *
 * This is the readable half of decompiling; `decompile.ts` does the part that is verifiable against the
 * bytes. Keeping them apart means a printing choice - how to spell an operator, where to break a line -
 * can never be mistaken for a claim about what the file contains.
 *
 * Sub-expressions are parenthesised whenever they are compound. Relying on precedence instead would
 * make every printed line depend on a second model of the language agreeing with the parser's, and the
 * boolean operators here already sit at one shared level where C programmers expect two.
 *
 * Declarations come out in the order the name table holds them, which is the order they were written.
 * No forward declarations are emitted: adding them would intern every procedure name ahead of the
 * variables and reorder that table, so the file would no longer compile back to the bytes it came from.
 */

import { engineFunctionAt } from "./engine-functions";
import {
    proceduresOf,
    type AssignOp,
    type Declaration,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
    type VariableDecl,
} from "./ir";

const INDENT = "    ";

export interface PrintOptions {
    /** Prefixed as a comment, naming what the source was recovered from. */
    origin?: string;
}

function quote(text: string): string {
    return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\t", "\\t")}"`;
}

/** Floats print with a decimal point so they cannot be read back as integers. */
function number(value: number): string {
    return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

class Printer {
    private readonly procedures: ProcedureDecl[];

    constructor(program: Program) {
        this.procedures = proceduresOf(program);
    }

    /** A name for the engine function an opcode dispatches to, or the raw number if it has none. */
    private engineName(opcode: number): string {
        return engineFunctionAt(opcode)?.name ?? `engine_0x${opcode.toString(16)}`;
    }

    private procedureName(index: number): string {
        return this.procedures[index]?.name ?? `procedure_${index}`;
    }

    /** Wraps only compound operands, so a leaf never gains parentheses it does not need. */
    private operand(expr: Expr): string {
        const text = this.expression(expr);
        return expr.kind === "binary" || expr.kind === "ternary" ? `(${text})` : text;
    }

    expression(expr: Expr): string {
        switch (expr.kind) {
            case "int":
                return `${expr.value}`;
            case "float":
                return number(expr.value);
            case "string":
                return quote(expr.value);
            case "var":
                return expr.name;
            case "procRef":
                // The stringified form passes the procedure by name; the plain form passes its slot.
                return expr.stringify ? `@${this.procedureName(expr.index)}` : this.procedureName(expr.index);
            case "unary":
                return expr.op === "negate"
                    ? `-${this.operand(expr.operand)}`
                    : `${expr.op} ${this.operand(expr.operand)}`;
            case "binary":
                return `${this.operand(expr.left)} ${expr.op} ${this.operand(expr.right)}`;
            case "ternary":
                return `${this.operand(expr.whenTrue)} if ${this.operand(expr.cond)} else ${this.operand(expr.whenFalse)}`;
            case "call":
                return this.call(expr.target, expr.args);
            case "libCall":
                return `${this.engineName(expr.opcode)}(${expr.args.map((a) => this.expression(a)).join(", ")})`;
        }
    }

    /**
     * A call names its target the same way whether the target is a procedure or a variable holding one;
     * which of the two it is follows from the name, and the compiler adds the run-time arity check for
     * the indirect case on its own.
     */
    private call(target: Expr, args: Expr[]): string {
        const list = args.map((argument) => this.expression(argument)).join(", ");
        const callee = target.kind === "procRef" ? this.procedureName(target.index) : this.expression(target);
        return `${callee}(${list})`;
    }

    private assign(op: AssignOp, target: string, value: string): string {
        return op === "=" ? `${target} := ${value};` : `${target} ${op} ${value};`;
    }

    statements(body: Stmt[], depth: number): string[] {
        return body.flatMap((statement) => this.statement(statement, depth));
    }

    /** A body always gets a `begin`/`end` block, so nesting never depends on statement count. */
    private block(statement: Stmt, depth: number): string[] {
        const pad = INDENT.repeat(depth);
        const body = statement.kind === "block" ? statement.body : [statement];
        return [`${pad}begin`, ...this.statements(body, depth + 1), `${pad}end`];
    }

    statement(statement: Stmt, depth: number): string[] {
        const pad = INDENT.repeat(depth);
        switch (statement.kind) {
            case "block":
                return this.statements(statement.body, depth);
            case "expr":
                return [`${pad}${this.expression(statement.expr)};`];
            case "assign":
                return [`${pad}${this.assign(statement.op, statement.target.name, this.expression(statement.value))}`];
            case "if": {
                const lines = [
                    `${pad}if (${this.expression(statement.cond)}) then`,
                    ...this.block(statement.thenBranch, depth),
                ];
                if (statement.elseBranch) {
                    lines.push(`${pad}else`, ...this.block(statement.elseBranch, depth));
                }
                return lines;
            }
            case "while":
                return this.loop(statement, depth);
            case "return":
                return [`${pad}return${statement.value ? ` ${this.expression(statement.value)}` : ""};`];
            case "break":
                return [`${pad}break;`];
            case "continue":
                return [`${pad}continue;`];
            case "loopEnd":
                // Only meaningful inside the counted loop that `loop` reassembles around it.
                return [];
            case "callStmt":
                return [`${pad}${this.call(statement.target, statement.args)};`];
            case "timedCallStmt":
                return [`${pad}call ${this.expression(statement.target)} in ${this.expression(statement.delay)};`];
            case "libStmt":
                return [
                    `${pad}${this.engineName(statement.opcode)}(${statement.args.map((a) => this.expression(a)).join(", ")});`,
                ];
        }
    }

    /**
     * A loop carrying a `loopEnd` is a counted loop: its `continue` jumps to the step rather than to the
     * condition, and only `for` spells that. The step has to be a single statement for the syntax to
     * hold it, which is what the source it came from would have had.
     */
    private loop(statement: Extract<Stmt, { kind: "while" }>, depth: number): string[] {
        const pad = INDENT.repeat(depth);
        const body = statement.body.kind === "block" ? statement.body.body : [statement.body];
        const marker = body.findIndex((inner) => inner.kind === "loopEnd");
        const step = marker === -1 ? [] : body.slice(marker + 1);

        if (marker === -1 || step.length !== 1) {
            return [`${pad}while (${this.expression(statement.cond)}) do`, ...this.block(statement.body, depth)];
        }
        const update = this.statement(step[0]!, 0)[0]?.replace(/;$/, "").replace(" := ", " = ") ?? "";
        return [
            `${pad}for (; ${this.expression(statement.cond)}; ${update})`,
            ...this.block({ kind: "block", body: body.slice(0, marker) }, depth),
        ];
    }

    variable(declaration: Declaration & { kind: "global" | "external" }): string {
        const variable = declaration.variable;
        if (declaration.kind === "global") return `variable ${variable.name} := ${this.expression(variable.initial)};`;
        if (variable.exported) return `export variable ${variable.name} := ${this.expression(variable.initial)};`;
        return `import variable ${variable.name};`;
    }

    procedure(procedure: ProcedureDecl): string[] {
        // `critical` precedes the other two; the reverse order is a syntax error.
        const modifier =
            (procedure.critical ? "critical " : "") + (procedure.pure ? "pure " : procedure.inline ? "inline " : "");
        const args = procedure.args.map((name) => `variable ${name}`).join(", ");
        const signature = `${modifier}procedure ${procedure.name}${args ? `(${args})` : ""}`;
        // A forward declaration is the only form an imported procedure takes, and it carries neither
        // clause below - both belong to a definition.
        if (procedure.imported) return [`${signature};`];

        // The grammar allows only one of these between the parameter list and `begin`. A compiled
        // script can still carry both bits, so `in` is printed and the guard falls back to a note.
        const schedule =
            procedure.timed !== undefined
                ? ` in ${procedure.timed}`
                : procedure.conditional
                  ? ` when ${this.expression(procedure.conditional)}`
                  : "";

        // A blank line separates the locals from the body, but only when there is both.
        const separator = procedure.locals.length > 0 && procedure.body.length > 0 ? [""] : [];
        return [
            `${signature}${schedule} begin`,
            ...procedure.locals.map((local) => `${INDENT}${this.local(local)}`),
            ...separator,
            ...this.statements(procedure.body, 1),
            "end",
        ];
    }

    private local(local: VariableDecl): string {
        return `variable ${local.name} := ${this.expression(local.initial)};`;
    }
}

/**
 * Renders a program as SSL source.
 *
 * Procedure flags the language cannot spell - only `exported` now - are noted in a comment rather than
 * dropped, so the text does not quietly claim the file holds less than it does. `critical`, `in` and
 * `when` all have a source spelling, so they are printed as syntax and the output recompiles with the
 * same bits set.
 */
export function printProgram(program: Program, options: PrintOptions = {}): string {
    const printer = new Printer(program);
    const lines: string[] = [];
    if (options.origin) lines.push(`// Decompiled from ${options.origin}.`);
    lines.push(
        "// Local and argument names are not stored in a compiled script; the ones below are generated.",
        "// Constants, macros and comments were resolved away before compilation and cannot be recovered.",
        "",
    );

    for (const declaration of program.declarations) {
        if (declaration.kind !== "procedure") {
            lines.push(printer.variable(declaration));
            continue;
        }
        const procedure = declaration.procedure;
        const notes: string[] = [];
        if (procedure.exported) notes.push("exported");
        // Only reachable from a compiled script that set both bits - the signature above spelled the
        // timed one, so the guard would otherwise vanish from the output.
        if (procedure.timed !== undefined && procedure.conditional) {
            notes.push(`guarded by ${printer.expression(procedure.conditional)}`);
        }
        lines.push("");
        if (notes.length > 0) lines.push(`// ${procedure.name} is ${notes.join(", ")}.`);
        lines.push(...printer.procedure(procedure));
    }
    return `${lines.join("\n")}\n`;
}
