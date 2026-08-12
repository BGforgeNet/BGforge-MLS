/**
 * The intermediate representation the INT emitter consumes.
 *
 * This is a typed tree, where the reference compiler emits from a flat token stream produced directly
 * by its parser. The divergence is deliberate and is the reason the back end can serve two front ends:
 * TSSL arrives as a TypeScript AST via ts-morph and has no token stream to replay, so a tree is the
 * only shape both inputs can produce. Output bytes are unaffected - the emitter walks this tree in the
 * same order the reference walks its tokens.
 *
 * Indices, not names, identify storage. Name resolution belongs to the front end: by the time a tree
 * reaches the emitter, every local and global carries its slot index and every external carries its
 * interned name offset. That keeps the emitter free of a symbol table.
 */

/** Where a variable lives, which decides the fetch/store opcode pair. */
export type VarScope = "local" | "global" | "external";

export type BinaryOp =
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "^"
    | "div"
    | "=="
    | "!="
    | "<="
    | ">="
    | "<"
    | ">"
    | "and"
    | "or"
    /** Always short-circuits, whatever the compilation mode `and`/`or` are in. */
    | "andalso"
    | "orelse"
    | "bwand"
    | "bwor"
    | "bwxor";

export type UnaryOp = "not" | "bwnot" | "negate" | "floor";

/** Compound assignment carries its arithmetic op; plain assignment carries none. */
export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=";

export type Expr =
    | { kind: "int"; value: number }
    | { kind: "float"; value: number }
    | { kind: "string"; value: string }
    | { kind: "var"; scope: VarScope; index: number; name: string }
    /** A procedure used as a value - passing one by reference, or naming one for `call`. */
    | { kind: "procRef"; index: number; stringify?: boolean }
    | { kind: "unary"; op: UnaryOp; operand: Expr }
    | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
    | { kind: "ternary"; cond: Expr; whenTrue: Expr; whenFalse: Expr }
    /** A user procedure call in expression position; its result stays on the stack. */
    | { kind: "call"; target: Expr; args: Expr[]; checkArgCount?: boolean }
    /** An engine function, dispatched by opcode number rather than by address. */
    | { kind: "libCall"; opcode: number; args: Expr[] };

export type Stmt =
    | { kind: "block"; body: Stmt[] }
    | { kind: "expr"; expr: Expr }
    | { kind: "assign"; target: Extract<Expr, { kind: "var" }>; op: AssignOp; value: Expr }
    | { kind: "if"; cond: Expr; thenBranch: Stmt; elseBranch?: Stmt }
    | { kind: "while"; cond: Expr; body: Stmt }
    | { kind: "return"; value?: Expr }
    | { kind: "break" }
    | { kind: "continue" }
    /** Marks the point continues jump to in a counted loop, before the increment runs. */
    | { kind: "loopEnd" }
    /** A procedure call in statement position - the result is discarded. */
    | { kind: "callStmt"; target: Expr; args: Expr[]; checkArgCount?: boolean }
    /**
     * A statement-position engine function. Some engine functions return a value even when called as a
     * statement; those set `popsResult` so the unused result is dropped rather than left on the stack.
     */
    | { kind: "libStmt"; opcode: number; args: Expr[]; popsResult?: boolean };

export interface VariableDecl {
    name: string;
    /** Declared initial value. Locals without one are zero, matching the language's default. */
    initial: Expr & { kind: "int" | "float" | "string" };
    exported?: boolean;
}

export interface ProcedureDecl {
    name: string;
    /** Argument names occupy the first local slots, so locals are indexed after them. */
    args: string[];
    locals: VariableDecl[];
    body: Stmt[];
    exported?: boolean;
    imported?: boolean;
    critical?: boolean;
    /** Fires at this time when set, which also sets the timed bit in the procedure table. */
    timed?: number;
    /** Guard expression for a conditional procedure, emitted ahead of the body. */
    conditional?: Expr;
}

export type Declaration =
    | { kind: "procedure"; procedure: ProcedureDecl }
    | { kind: "global"; variable: VariableDecl }
    /** A variable shared with other scripts, exported by name at load time. */
    | { kind: "external"; variable: VariableDecl };

/**
 * A program is one ordered list rather than separate procedure and variable lists, because the name
 * table is built in SOURCE DECLARATION ORDER and its offsets are baked into the procedure table. A
 * global declared above a procedure takes the earlier offset, so splitting the two loses the ordering
 * the output depends on and shifts every subsequent offset.
 *
 * The emitter prepends the placeholder procedure itself; callers list only real declarations.
 */
export interface Program {
    declarations: Declaration[];
}

/** Procedures in declaration order, which is also their procedure-table order. */
export function proceduresOf(program: Program): ProcedureDecl[] {
    return program.declarations.flatMap((d) => (d.kind === "procedure" ? [d.procedure] : []));
}

export function globalsOf(program: Program): VariableDecl[] {
    return program.declarations.flatMap((d) => (d.kind === "global" ? [d.variable] : []));
}

export function externalsOf(program: Program): VariableDecl[] {
    return program.declarations.flatMap((d) => (d.kind === "external" ? [d.variable] : []));
}
