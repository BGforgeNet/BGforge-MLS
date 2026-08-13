/**
 * Dead-code elimination over the IR, matching what the reference compiler removes at `-O1`: procedures
 * nothing can reach, and globals nothing reads. It runs between lowering and emission, so the emitter
 * needs no knowledge of it and unoptimised output stays byte-identical to before.
 *
 * Both passes are REMOVALS, and a removal that is wrong produces a script the engine loads and then
 * misbehaves on, with no diagnostic anywhere. So each is conservative by construction: anything whose
 * reachability cannot be decided keeps everything it might have reached, and the whole procedure pass
 * bails out when the script can name a procedure the analysis cannot see.
 *
 * Level 2 goes further - constant folding, dead stores, unreachable statements, constant globals - but is
 * not finished; see `OptimizeOptions.level`. Its rules are taken from the reference compiler's own
 * `optimize.c` rather than inferred from its output: three folds guessed from byte diffs turned out to be
 * wrong, one of them deleting branches the reference keeps, and reading the source settled each in a line.
 */

import {
    alwaysReturns,
    globalsOf,
    proceduresOf,
    type Declaration,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
} from "./int/ir";

export interface OptimizeOptions {
    /**
     * 0 leaves the program untouched. 1 removes unreachable procedures and unreferenced variables, and
     * is byte-identical to the reference compiler's own `-O1` across the corpus.
     *
     * 2 is INCOMPLETE and not reachable from the extension. It folds constants, drops unreachable
     * statements and dead stores, and propagates constant globals, but the reference additionally runs a
     * `Combine` pass and iterates the whole set to a fixpoint, neither of which is reproduced here - so
     * its output is correct but not byte-identical (about 85% of the corpus at the time of writing).
     * Finishing it is a porting job against the reference's `optimize.c`, not a guessing one.
     */
    level?: 0 | 1 | 2;
}

/**
 * Whether an expression can be dropped without losing anything but its value. A call of either kind can
 * do arbitrary work, so a store fed by one stays even when the variable it writes is dead - which is
 * what the reference does too.
 */
function isPure(expr: Expr): boolean {
    switch (expr.kind) {
        case "call":
        case "libCall":
            return false;
        case "unary":
            return isPure(expr.operand);
        case "binary":
            return isPure(expr.left) && isPure(expr.right);
        case "ternary":
            return isPure(expr.cond) && isPure(expr.whenTrue) && isPure(expr.whenFalse);
        default:
            return true;
    }
}

/**
 * Evaluates what is already known. Applied bottom-up, so nested constants collapse in one pass.
 *
 * Only the folds the reference performs belong here: folding MORE is as much a mismatch as folding less,
 * and an arithmetic identity that holds in TypeScript need not hold for the engine's own semantics.
 */
function foldConstants(expr: Expr): Expr {
    if (expr.kind === "unary") {
        const operand = expr.operand;
        if (operand.kind !== "int" && operand.kind !== "float") return expr;
        switch (expr.op) {
            case "not":
                return { kind: "int", value: operand.value === 0 ? 1 : 0 };
            case "bwnot":
                return { kind: "int", value: ~operand.value };
            case "negate":
                return { ...operand, value: -operand.value };
            default:
                // `floor` is not in the reference's unary fold set.
                return expr;
        }
    }
    if (expr.kind !== "binary") return expr;
    const left = expr.left;
    const right = expr.right;
    if ((left.kind !== "int" && left.kind !== "float") || (right.kind !== "int" && right.kind !== "float")) return expr;

    const int = (value: number): Expr => ({ kind: "int", value });
    const bool = (value: boolean): Expr => int(value ? 1 : 0);
    // A float operand makes an ARITHMETIC result float; comparisons, logicals and bitwise stay integer.
    // The arithmetic is done in 32-bit, which is the width the engine and the reference both use.
    const isFloat = left.kind === "float" || right.kind === "float";
    const a = left.value;
    const b = right.value;
    const arith = (value: number): Expr => (isFloat ? { kind: "float", value: Math.fround(value) } : int(value));

    switch (expr.op) {
        case "+":
            return arith(a + b);
        case "-":
            return arith(a - b);
        case "*":
            return arith(a * b);
        case "/":
        case "div":
            if (b === 0) return expr; // Left for the engine rather than decided here.
            return isFloat ? arith(a / b) : int(Math.trunc(a / b));
        case "and":
            return bool(a !== 0 && b !== 0);
        case "or":
            return bool(a !== 0 || b !== 0);
        case "bwand":
            return int(a & b);
        case "bwor":
            return int(a | b);
        case "bwxor":
            return int(a ^ b);
        case "==":
            return bool(a === b);
        case "!=":
            return bool(a !== b);
        case "<":
            return bool(a < b);
        case ">":
            return bool(a > b);
        case "<=":
            return bool(a <= b);
        case ">=":
            return bool(a >= b);
        default:
            // `%`, `^`, and the short-circuiting `andalso`/`orelse` are absent from the reference's
            // fold set. Folding them was worth 49 scripts' worth of mismatch before this was checked.
            return expr;
    }
}

/** A condition whose value is known at compile time, or null when it has to be evaluated. */
function constantTruth(expr: Expr): boolean | null {
    if (expr.kind === "int" || expr.kind === "float") return expr.value !== 0;
    return null;
}

/**
 * Procedures the ENGINE calls by name, so nothing in the script needs to reference them. A name missing
 * here is a procedure that gets deleted out of a working script, and no differential against a Fallout 2
 * corpus can reveal the omission of a Fallout 1 name - so this follows the reference compiler's own
 * protected list rather than the engine dispatch table, which covers one game only.
 *
 * `no_p_proc` and `none_x_bad` are placeholders in the engine's table. They are kept as roots regardless:
 * a script defining one is doing something strange, and preserving it costs a few bytes where removing it
 * could break something nothing else records.
 */
const ENGINE_ENTRY_POINTS: ReadonlySet<string> = new Set([
    "no_p_proc",
    "start",
    "spatial_p_proc",
    "description_p_proc",
    // Fallout 1 spells it this way, and a Fallout 1 script is still something this compiler accepts.
    "desc_p_proc",
    "pickup_p_proc",
    "drop_p_proc",
    "use_p_proc",
    "use_obj_on_p_proc",
    "use_skill_on_p_proc",
    "none_x_bad",
    "talk_p_proc",
    "critter_p_proc",
    "combat_p_proc",
    "damage_p_proc",
    "map_enter_p_proc",
    "map_exit_p_proc",
    "create_p_proc",
    "destroy_p_proc",
    "look_at_p_proc",
    "timed_event_p_proc",
    "map_update_p_proc",
    "push_p_proc",
    "is_dropping_p_proc",
    "combat_is_starting_p_proc",
    "combat_is_over_p_proc",
]);

/** Every expression in a statement, including the ones nested inside other expressions. */
function forEachExpr(statement: Stmt, visit: (expr: Expr) => void): void {
    const expression = (expr: Expr): void => {
        visit(expr);
        switch (expr.kind) {
            case "unary":
                expression(expr.operand);
                break;
            case "binary":
                expression(expr.left);
                expression(expr.right);
                break;
            case "ternary":
                expression(expr.cond);
                expression(expr.whenTrue);
                expression(expr.whenFalse);
                break;
            case "call":
                expression(expr.target);
                expr.args.forEach(expression);
                break;
            case "libCall":
                expr.args.forEach(expression);
                break;
            default:
                break;
        }
    };

    const walk = (stmt: Stmt): void => {
        switch (stmt.kind) {
            case "block":
                stmt.body.forEach(walk);
                break;
            case "expr":
                expression(stmt.expr);
                break;
            case "assign":
                expression(stmt.target);
                expression(stmt.value);
                break;
            case "if":
                expression(stmt.cond);
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
                break;
            case "while":
                expression(stmt.cond);
                walk(stmt.body);
                break;
            case "return":
                if (stmt.value) expression(stmt.value);
                break;
            case "callStmt":
                expression(stmt.target);
                stmt.args.forEach(expression);
                break;
            case "timedCallStmt":
                expression(stmt.target);
                expression(stmt.delay);
                break;
            case "libStmt":
                stmt.args.forEach(expression);
                break;
            default:
                break;
        }
    };
    walk(statement);
}

/** Every expression a procedure evaluates, its guard included - the guard is code the engine runs. */
function forEachExprInProcedure(procedure: ProcedureDecl, visit: (expr: Expr) => void): void {
    procedure.body.forEach((statement) => forEachExpr(statement, visit));
    if (procedure.conditional) forEachExpr({ kind: "expr", expr: procedure.conditional }, visit);
}

/**
 * Whether any call target is a value rather than a known procedure. The engine's `lookup_string_proc`
 * resolves a procedure from a string computed at runtime, so once a script can do that, no procedure can
 * be shown unreachable and the pass must keep them all.
 */
function hasDynamicProcedureLookup(program: Program): boolean {
    let dynamic = false;
    // A slot and a literal string each name one procedure outright. A VARIABLE target is safe too, and
    // this is the common `stored_node := Node998; call stored_node;` dispatch: the procedure had to be
    // named to get into the variable, so the assignment carries the reference the walk below collects.
    // What cannot be followed is a target COMPUTED at runtime - a concatenated name, a call's result -
    // which `lookup_string_proc` will happily resolve against a procedure nothing here mentions.
    const check = (target: Expr): void => {
        if (target.kind !== "procRef" && target.kind !== "string" && target.kind !== "var") dynamic = true;
    };
    for (const procedure of proceduresOf(program)) {
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "call") check(expr.target);
        });
        const statements = (stmt: Stmt): void => {
            switch (stmt.kind) {
                case "callStmt":
                    check(stmt.target);
                    break;
                case "block":
                    stmt.body.forEach(statements);
                    break;
                case "if":
                    statements(stmt.thenBranch);
                    if (stmt.elseBranch) statements(stmt.elseBranch);
                    break;
                case "while":
                    statements(stmt.body);
                    break;
                default:
                    break;
            }
        };
        procedure.body.forEach(statements);
    }
    return dynamic;
}

/** Indices of procedures reachable from the engine's entry points and from each other. */
function reachableProcedures(program: Program): Set<number> {
    const procedures = proceduresOf(program);
    const byName = new Map<string, number>();
    procedures.forEach((procedure, index) => byName.set(procedure.name.toLowerCase(), index));

    const reachable = new Set<number>();
    const queue: number[] = [];
    const enter = (index: number): void => {
        if (index < 0 || index >= procedures.length || reachable.has(index)) return;
        reachable.add(index);
        queue.push(index);
    };

    procedures.forEach((procedure, index) => {
        // An engine entry point, an export and an import are all reached from outside the script; a
        // timed or guarded procedure is scheduled by the engine off its table entry alone.
        if (
            ENGINE_ENTRY_POINTS.has(procedure.name.toLowerCase()) ||
            procedure.exported ||
            procedure.imported ||
            procedure.timed !== undefined ||
            procedure.conditional
        ) {
            enter(index);
        }
    });

    while (queue.length > 0) {
        const current = procedures[queue.pop() as number];
        if (!current) continue;
        forEachExprInProcedure(current, (expr) => {
            if (expr.kind === "procRef") enter(expr.index);
            // A call through a literal name resolves by string at load time, so it is a real reference.
            if (expr.kind === "string") {
                const named = byName.get(expr.value.toLowerCase());
                if (named !== undefined) enter(named);
            }
        });
    }
    return reachable;
}

/** Rewrites every `procRef` index and global slot through the supplied maps. */
function remap(statement: Stmt, procedures: ReadonlyMap<number, number>, globals: ReadonlyMap<number, number>): Stmt {
    return remapWith(statement, (expr) => {
        if (expr.kind === "procRef") return { ...expr, index: procedures.get(expr.index) ?? expr.index };
        if (expr.kind === "var" && expr.scope === "global") {
            return { ...expr, index: globals.get(expr.index) ?? expr.index };
        }
        return expr;
    });
}

/** Applies a leaf rewrite to every expression in a statement, rebuilding the tree around it. */
function remapWith(statement: Stmt, leaf: (expr: Expr) => Expr): Stmt {
    const expression = (expr: Expr): Expr => {
        switch (expr.kind) {
            case "unary":
                return leaf({ ...expr, operand: expression(expr.operand) });
            case "binary":
                return leaf({ ...expr, left: expression(expr.left), right: expression(expr.right) });
            case "ternary":
                return leaf({
                    ...expr,
                    cond: expression(expr.cond),
                    whenTrue: expression(expr.whenTrue),
                    whenFalse: expression(expr.whenFalse),
                });
            case "call":
                return leaf({ ...expr, target: expression(expr.target), args: expr.args.map(expression) });
            case "libCall":
                return leaf({ ...expr, args: expr.args.map(expression) });
            default:
                return leaf(expr);
        }
    };

    const walk = (stmt: Stmt): Stmt => {
        switch (stmt.kind) {
            case "block":
                return { ...stmt, body: stmt.body.map(walk) };
            case "expr":
                return { ...stmt, expr: expression(stmt.expr) };
            case "assign":
                return {
                    ...stmt,
                    target: expression(stmt.target) as Extract<Expr, { kind: "var" }>,
                    value: expression(stmt.value),
                };
            case "if":
                return {
                    ...stmt,
                    cond: expression(stmt.cond),
                    thenBranch: walk(stmt.thenBranch),
                    ...(stmt.elseBranch ? { elseBranch: walk(stmt.elseBranch) } : {}),
                };
            case "while":
                return { ...stmt, cond: expression(stmt.cond), body: walk(stmt.body) };
            case "return":
                return stmt.value ? { ...stmt, value: expression(stmt.value) } : stmt;
            case "callStmt":
                return { ...stmt, target: expression(stmt.target), args: stmt.args.map(expression) };
            case "timedCallStmt":
                return {
                    ...stmt,
                    target: expression(stmt.target) as Extract<Expr, { kind: "procRef" }>,
                    delay: expression(stmt.delay),
                };
            case "libStmt":
                return { ...stmt, args: stmt.args.map(expression) };
            default:
                return stmt;
        }
    };
    return walk(statement);
}

function rewriteProcedure(
    procedure: ProcedureDecl,
    procedures: ReadonlyMap<number, number>,
    globals: ReadonlyMap<number, number>,
): ProcedureDecl {
    const rewritten: ProcedureDecl = { ...procedure, body: procedure.body.map((s) => remap(s, procedures, globals)) };
    if (procedure.conditional) {
        const guard = remap({ kind: "expr", expr: procedure.conditional }, procedures, globals);
        if (guard.kind === "expr") rewritten.conditional = guard.expr;
    }
    return rewritten;
}

/**
 * Folds conditions whose value is known and drops what that makes unreachable. A `while` whose condition
 * is constantly false disappears; one that is constantly true is left alone, since it still runs.
 */
function foldStatements(statements: Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    for (const statement of statements) {
        const folded = foldStatement(statement);
        if (folded === null) continue;
        out.push(folded);
        // Everything after a statement that always returns is unreachable.
        if (alwaysReturns(folded)) break;
    }
    return out;
}

function foldStatement(statement: Stmt): Stmt | null {
    switch (statement.kind) {
        case "block": {
            const body = foldStatements(statement.body);
            return body.length > 0 ? { ...statement, body } : null;
        }
        case "if": {
            const taken = constantTruth(statement.cond);
            if (taken === true) return foldStatement(statement.thenBranch);
            if (taken === false) return statement.elseBranch ? foldStatement(statement.elseBranch) : null;
            const thenBranch = foldStatement(statement.thenBranch) ?? { kind: "block" as const, body: [] };
            const elseBranch = statement.elseBranch ? foldStatement(statement.elseBranch) : undefined;
            return { ...statement, thenBranch, ...(elseBranch ? { elseBranch } : {}) };
        }
        case "while": {
            if (constantTruth(statement.cond) === false) return null;
            const body = foldStatement(statement.body) ?? { kind: "block" as const, body: [] };
            return { ...statement, body };
        }
        default:
            return statement;
    }
}

/** Local slots a procedure ever READS, as opposed to merely writing. */
function readLocals(procedure: ProcedureDecl): Set<number> {
    const read = new Set<number>();
    const fromExpr = (expr: Expr): void => {
        if (expr.kind === "var" && expr.scope === "local") read.add(expr.index);
    };
    const walk = (stmt: Stmt): void => {
        if (stmt.kind === "assign") {
            // A compound assignment reads its target before writing it; a plain one does not.
            if (stmt.op !== "=") read.add(stmt.target.index);
            forEachExpr({ kind: "expr", expr: stmt.value }, fromExpr);
            return;
        }
        if (stmt.kind === "block") {
            stmt.body.forEach(walk);
            return;
        }
        if (stmt.kind === "if") {
            forEachExpr({ kind: "expr", expr: stmt.cond }, fromExpr);
            walk(stmt.thenBranch);
            if (stmt.elseBranch) walk(stmt.elseBranch);
            return;
        }
        if (stmt.kind === "while") {
            forEachExpr({ kind: "expr", expr: stmt.cond }, fromExpr);
            walk(stmt.body);
            return;
        }
        forEachExpr(stmt, fromExpr);
    };
    procedure.body.forEach(walk);
    if (procedure.conditional) forEachExpr({ kind: "expr", expr: procedure.conditional }, fromExpr);
    return read;
}

/**
 * Removes locals the procedure never reads, along with the stores that fed them, and renumbers the slots
 * that remain. Arguments are never removed - they occupy the leading slots and their count is recorded in
 * the procedure table, so dropping one would change the calling convention.
 *
 * A variable whose every store is pure goes entirely. One with even a single side-effecting store stays,
 * because the store has to keep happening and the value has to land somewhere.
 */
function pruneLocals(procedure: ProcedureDecl): ProcedureDecl {
    const base = procedure.args.length;
    const removed = new Set<number>();
    let body = procedure.body;

    // Iterated to a fixpoint, because deleting a dead store deletes the reads inside it: `x := x + 1`
    // on an otherwise-unused `x` looks live on the first pass and is only exposed once its own store is
    // gone. A single pass would leave exactly the chains the reference collapses.
    for (;;) {
        const current: ProcedureDecl = { ...procedure, body };
        const read = readLocals(current);
        const impure = new Set<number>();
        const noteImpure = (stmt: Stmt): void => {
            if (stmt.kind === "assign" && !isPure(stmt.value)) impure.add(stmt.target.index);
            if (stmt.kind === "block") stmt.body.forEach(noteImpure);
            if (stmt.kind === "if") {
                noteImpure(stmt.thenBranch);
                if (stmt.elseBranch) noteImpure(stmt.elseBranch);
            }
            if (stmt.kind === "while") noteImpure(stmt.body);
        };
        body.forEach((statement) => noteImpure(statement));

        const round = new Set<number>();
        procedure.locals.forEach((_local, i) => {
            const slot = base + i;
            if (!removed.has(slot) && !read.has(slot) && !impure.has(slot)) round.add(slot);
        });
        if (round.size === 0) break;
        for (const slot of round) removed.add(slot);
        body = dropStoresTo(body, round);
    }
    if (removed.size === 0) return procedure;

    const slotMap = new Map<number, number>();
    let next = base;
    procedure.locals.forEach((_local, i) => {
        const slot = base + i;
        if (!removed.has(slot)) slotMap.set(slot, next++);
    });
    for (let arg = 0; arg < base; arg++) slotMap.set(arg, arg);

    const rewriteExpr = (expr: Expr): Expr =>
        expr.kind === "var" && expr.scope === "local"
            ? { ...expr, index: slotMap.get(expr.index) ?? expr.index }
            : expr;

    return {
        ...procedure,
        locals: procedure.locals.filter((_local, i) => !removed.has(base + i)),
        body: body.map((statement) => remapWith(statement, rewriteExpr)),
    };
}

/** Every local slot a procedure has, arguments included. */
function slotsOf(procedure: ProcedureDecl): Set<number> {
    const out = new Set<number>();
    for (let slot = 0; slot < procedure.args.length + procedure.locals.length; slot++) out.add(slot);
    return out;
}

/** The local slots an expression reads. */
function readsOf(expr: Expr): Set<number> {
    const out = new Set<number>();
    forEachExpr({ kind: "expr", expr }, (e) => {
        if (e.kind === "var" && e.scope === "local") out.add(e.index);
    });
    return out;
}

const union = (...sets: ReadonlySet<number>[]): Set<number> => {
    const out = new Set<number>();
    for (const set of sets) for (const value of set) out.add(value);
    return out;
};

/**
 * Backward liveness, removing stores whose value nothing goes on to read - `x := 1; x := 2;` drops the
 * first, which plain unused-variable analysis cannot see because `x` really is read later.
 *
 * Conservative wherever control flow is not obvious: a loop is iterated to a fixpoint, and `break` or
 * `continue` makes every local live, since where they land is not modelled here. Only a store whose
 * right-hand side is pure can go - anything else has to keep happening for its effects.
 */
function eliminateDeadStores(procedure: ProcedureDecl, allSlots: ReadonlySet<number>): ProcedureDecl {
    const list = (statements: Stmt[], liveOut: ReadonlySet<number>): { body: Stmt[]; liveIn: Set<number> } => {
        const kept: Stmt[] = [];
        let live = new Set(liveOut);
        for (let i = statements.length - 1; i >= 0; i--) {
            const result = one(statements[i] as Stmt, live);
            live = result.liveIn;
            if (result.statement !== null) kept.unshift(result.statement);
        }
        return { body: kept, liveIn: live };
    };

    const one = (statement: Stmt, liveOut: ReadonlySet<number>): { statement: Stmt | null; liveIn: Set<number> } => {
        switch (statement.kind) {
            case "assign": {
                // Only LOCALS are tracked here. A global or external outlives the procedure, and its
                // slot numbering is a different space entirely - treating one as a local slot both
                // misreads liveness and deletes stores that are anything but dead.
                if (statement.target.scope !== "local") {
                    return { statement, liveIn: union(liveOut, readsOf(statement.value)) };
                }
                const slot = statement.target.index;
                if (!liveOut.has(slot) && isPure(statement.value)) return { statement: null, liveIn: new Set(liveOut) };
                const after = new Set(liveOut);
                // A plain assignment kills the slot; a compound one reads it first.
                if (statement.op === "=") after.delete(slot);
                else after.add(slot);
                return { statement, liveIn: union(after, readsOf(statement.value)) };
            }
            case "block": {
                const { body, liveIn } = list(statement.body, liveOut);
                return { statement: body.length > 0 ? { ...statement, body } : null, liveIn };
            }
            case "if": {
                const thenSide = one(statement.thenBranch, liveOut);
                const elseSide = statement.elseBranch ? one(statement.elseBranch, liveOut) : null;
                const branch: Stmt = {
                    ...statement,
                    thenBranch: thenSide.statement ?? { kind: "block", body: [] },
                    ...(elseSide?.statement ? { elseBranch: elseSide.statement } : {}),
                };
                return {
                    statement: branch,
                    liveIn: union(readsOf(statement.cond), thenSide.liveIn, elseSide ? elseSide.liveIn : liveOut),
                };
            }
            case "while": {
                // A loop's body can feed its own next iteration, so liveness is iterated rather than
                // read off once. The bound is a safety net; the set only grows, so it settles quickly.
                let live = new Set(liveOut);
                for (let round = 0; round < 8; round++) {
                    const bodyLive = one(statement.body, live).liveIn;
                    const next = union(readsOf(statement.cond), bodyLive, liveOut);
                    const settled = next.size === live.size;
                    live = next;
                    if (settled) break;
                }
                const body = one(statement.body, live);
                return {
                    statement: { ...statement, body: body.statement ?? { kind: "block", body: [] } },
                    liveIn: live,
                };
            }
            case "break":
            case "continue":
                // The jump target is not modelled, so assume anything could be read after it.
                return { statement, liveIn: new Set(allSlots) };
            case "return":
                // Locals do not outlive the procedure, so nothing is live past a return but its operand.
                return { statement, liveIn: statement.value ? readsOf(statement.value) : new Set() };
            default: {
                const reads = new Set<number>();
                forEachExpr(statement, (e) => {
                    if (e.kind === "var" && e.scope === "local") reads.add(e.index);
                });
                return { statement, liveIn: union(liveOut, reads) };
            }
        }
    };

    return { ...procedure, body: list(procedure.body, new Set()).body };
}

/**
 * Drops a store that writes a local the value it already holds. Locals enter the procedure holding their
 * declared initial, so `variable i := 0;` followed by `i := 0` - the shape a lowered `foreach` produces -
 * stores nothing new.
 *
 * Only the straight-line prefix of the body is considered. Past the first branch or loop the value a
 * local holds depends on which way control went, and this analysis does not track that.
 */
function dropRedundantStores(procedure: ProcedureDecl): ProcedureDecl {
    const base = procedure.args.length;
    const known = new Map<number, Expr>();
    procedure.locals.forEach((local, i) => known.set(base + i, local.initial));

    let tracking = true;
    const walk = (statements: Stmt[]): Stmt[] => {
        const out: Stmt[] = [];
        for (const statement of statements) {
            if (tracking && statement.kind === "assign" && statement.target.scope === "local" && statement.op === "=") {
                const slot = statement.target.index;
                const current = known.get(slot);
                const value = statement.value;
                const same =
                    current !== undefined &&
                    current.kind === value.kind &&
                    (value.kind === "int" || value.kind === "float" || value.kind === "string") &&
                    (current as typeof value).value === value.value;
                if (same) continue;
                if (value.kind === "int" || value.kind === "float" || value.kind === "string") known.set(slot, value);
                else known.delete(slot);
                out.push(statement);
                continue;
            }
            // A block is still straight-line, so what is known survives into it.
            if (statement.kind === "block") {
                out.push({ ...statement, body: walk(statement.body) });
                continue;
            }
            // A branch or a loop writes locals under a condition, so nothing stays certain past it.
            if (statement.kind === "if" || statement.kind === "while") tracking = false;
            out.push(statement);
        }
        return out;
    };
    return { ...procedure, body: walk(procedure.body) };
}

/** Removes every assignment writing one of the given local slots, pruning blocks left empty. */
function dropStoresTo(statements: Stmt[], slots: ReadonlySet<number>): Stmt[] {
    const one = (statement: Stmt): Stmt | null => {
        switch (statement.kind) {
            case "assign":
                return slots.has(statement.target.index) ? null : statement;
            case "block": {
                const body = dropStoresTo(statement.body, slots);
                return body.length > 0 ? { ...statement, body } : null;
            }
            case "if": {
                const thenBranch = one(statement.thenBranch) ?? { kind: "block" as const, body: [] };
                const elseBranch = statement.elseBranch ? one(statement.elseBranch) : undefined;
                return { ...statement, thenBranch, ...(elseBranch ? { elseBranch } : {}) };
            }
            case "while":
                return { ...statement, body: one(statement.body) ?? { kind: "block", body: [] } };
            default:
                return statement;
        }
    };
    return statements.flatMap((statement) => {
        const kept = one(statement);
        return kept === null ? [] : [kept];
    });
}

/**
 * Replaces reads of a global that is never assigned with its initial value. The variable then has no
 * readers left and the removal pass drops it, which is how the reference turns a `variable x := 12;`
 * used purely as a constant into an immediate.
 *
 * An EXPORTED global is excluded: another script may assign it, so its value is not ours to assume.
 * Imports are excluded for the same reason - their definition, and any writes to it, live elsewhere.
 */
function propagateConstantGlobals(program: Program): Program {
    const assigned = new Set<number>();
    for (const procedure of proceduresOf(program)) {
        const walk = (stmt: Stmt): void => {
            if (stmt.kind === "assign" && stmt.target.scope === "global") assigned.add(stmt.target.index);
            if (stmt.kind === "block") stmt.body.forEach(walk);
            if (stmt.kind === "if") {
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
            }
            if (stmt.kind === "while") walk(stmt.body);
        };
        procedure.body.forEach(walk);
    }

    // A global reached through `call` holds a procedure, and substituting its initial value would turn
    // the call target into an integer the emitter cannot call. Its value comes from somewhere this
    // analysis cannot see, which is exactly the case the substitution must not guess at.
    const called = new Set<number>();
    for (const procedure of proceduresOf(program)) {
        const note = (target: Expr): void => {
            if (target.kind === "var" && target.scope === "global") called.add(target.index);
        };
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "call") note(expr.target);
        });
        const walk = (stmt: Stmt): void => {
            if (stmt.kind === "callStmt") note(stmt.target);
            if (stmt.kind === "block") stmt.body.forEach(walk);
            if (stmt.kind === "if") {
                walk(stmt.thenBranch);
                if (stmt.elseBranch) walk(stmt.elseBranch);
            }
            if (stmt.kind === "while") walk(stmt.body);
        };
        procedure.body.forEach(walk);
    }

    const constants = new Map<number, Expr>();
    globalsOf(program).forEach((variable, index) => {
        if (!assigned.has(index) && !variable.exported && !called.has(index)) constants.set(index, variable.initial);
    });
    if (constants.size === 0) return program;

    const substitute = (expr: Expr): Expr =>
        expr.kind === "var" && expr.scope === "global" ? (constants.get(expr.index) ?? expr) : expr;

    return {
        ...program,
        declarations: program.declarations.map((declaration) =>
            declaration.kind === "procedure"
                ? {
                      kind: "procedure",
                      procedure: {
                          ...declaration.procedure,
                          body: declaration.procedure.body.map((s) => remapWith(s, substitute)),
                      },
                  }
                : declaration,
        ),
    };
}

/**
 * Removes procedures nothing can reach and globals nothing reads, then renumbers what is left. Both
 * index spaces are positional - a procedure's slot is its position among procedure declarations, a
 * global's is its position among global ones - so dropping any entry shifts every later reference.
 */
export function optimize(program: Program, options: OptimizeOptions = {}): Program {
    const level = options.level ?? 0;
    if (level < 1) return program;

    // Level 2 rewrites bodies BEFORE reachability is computed: folding away a constant branch can make a
    // call unreachable, and that call was the only thing keeping a procedure alive.
    if (level >= 2) {
        // Twice, with propagation between: substituting a constant global exposes arithmetic that folds,
        // which can decide a branch, which can strand more locals. One pass would stop short of what the
        // reference reaches.
        const simplify = (input: Program): Program => ({
            ...input,
            declarations: input.declarations.map((declaration) =>
                declaration.kind === "procedure"
                    ? {
                          kind: "procedure",
                          // Constants first: a folded condition is what makes a branch droppable. Then
                          // dead stores, then the locals those stores were the last use of.
                          procedure: pruneLocals(
                              dropRedundantStores(
                                  eliminateDeadStores(
                                      {
                                          ...declaration.procedure,
                                          body: foldStatements(
                                              declaration.procedure.body.map((s) => remapWith(s, foldConstants)),
                                          ),
                                      },
                                      slotsOf(declaration.procedure),
                                  ),
                              ),
                          ),
                      }
                    : declaration,
            ),
        });
        program = simplify(propagateConstantGlobals(simplify(program)));
    }

    const keepAllProcedures = hasDynamicProcedureLookup(program);
    const reachable = keepAllProcedures ? null : reachableProcedures(program);

    const procedureMap = new Map<number, number>();
    let nextProcedure = 0;
    proceduresOf(program).forEach((_procedure, index) => {
        if (reachable === null || reachable.has(index)) procedureMap.set(index, nextProcedure++);
    });

    // Variables are counted only against the procedures that survive, so one read exclusively by dead
    // code goes with it. Globals are held by slot; an import is reached by name, which is why it can be
    // dropped without renumbering anything.
    const usedGlobals = new Set<number>();
    const usedExternals = new Set<string>();
    proceduresOf(program).forEach((procedure, index) => {
        if (!procedureMap.has(index)) return;
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind !== "var") return;
            if (expr.scope === "global") usedGlobals.add(expr.index);
            if (expr.scope === "external") usedExternals.add(expr.name);
        });
    });

    const globalMap = new Map<number, number>();
    let nextGlobal = 0;
    globalsOf(program).forEach((variable, index) => {
        // An exported global is part of the script's interface: another script reads it by name.
        if (usedGlobals.has(index) || variable.exported) globalMap.set(index, nextGlobal++);
    });

    let procedureIndex = -1;
    let globalIndex = -1;
    const declarations: Declaration[] = [];
    const liveStrings = new Set<string>();
    for (const declaration of program.declarations) {
        if (declaration.kind === "procedure") {
            procedureIndex++;
            if (!procedureMap.has(procedureIndex)) continue;
            declarations.push({
                kind: "procedure",
                procedure: rewriteProcedure(declaration.procedure, procedureMap, globalMap),
            });
            continue;
        }
        if (declaration.kind === "global") {
            globalIndex++;
            if (!globalMap.has(globalIndex)) continue;
        }
        // An import the script never mentions binds a name it then does nothing with. Exported ones stay
        // regardless: the export IS the reference, made by another script.
        if (
            declaration.kind === "external" &&
            !declaration.variable.exported &&
            !usedExternals.has(declaration.variable.name)
        ) {
            continue;
        }
        declarations.push(declaration);
    }

    // The string table is built from a SOURCE-ORDER list, not from the IR, so a literal used only by
    // code just removed would still be interned and shift every later string offset. Collect what the
    // survivors actually reference and keep the list in its original order.
    const survivingProcedures = declarations.flatMap((d) => (d.kind === "procedure" ? [d.procedure] : []));
    for (const procedure of survivingProcedures) {
        // A local's initial value is pushed at procedure entry and never appears in the body, so the
        // expression walk below cannot see it. Dropping one leaves the emitter to intern it late, at the
        // END of the table, which reorders every offset rather than merely losing a string.
        for (const local of procedure.locals) {
            if (local.initial.kind === "string") liveStrings.add(local.initial.value);
        }
        forEachExprInProcedure(procedure, (expr) => {
            if (expr.kind === "string") liveStrings.add(expr.value);
            // A procedure passed by name has its NAME interned as a string, not as an identifier.
            if (expr.kind === "procRef" && expr.stringify) {
                const named = survivingProcedures[expr.index];
                if (named) liveStrings.add(named.name);
            }
        });
    }
    for (const declaration of declarations) {
        if (declaration.kind !== "procedure" && declaration.variable.initial.kind === "string") {
            liveStrings.add(declaration.variable.initial.value);
        }
    }

    const stringLiterals = program.stringLiterals?.filter((literal) => liveStrings.has(literal));

    // An undefined procedure that was removed as dead is no longer anybody's problem; the survivors keep
    // their complaint, renumbered alongside everything else.
    const undefinedProcedures = program.undefinedProcedures
        ?.filter((entry) => procedureMap.has(entry.index))
        .map((entry) => ({ ...entry, index: procedureMap.get(entry.index) as number }));

    return {
        ...program,
        declarations,
        ...(stringLiterals ? { stringLiterals } : {}),
        // Emptying the table is not the same as never having had one; the emitter writes them apart.
        ...((program.stringLiterals?.length ?? 0) > 0 ? { stringTableAllocated: true } : {}),
        ...(undefinedProcedures && undefinedProcedures.length > 0
            ? { undefinedProcedures }
            : { undefinedProcedures: undefined }),
    };
}
