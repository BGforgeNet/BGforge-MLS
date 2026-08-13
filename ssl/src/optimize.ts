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
 * Not done here, and deliberately: the reference also drops unused LOCALS, but only from `-O2`, which
 * additionally rewrites code in ways this does not reproduce. Locals are left alone rather than
 * implementing half of a level.
 */

import {
    globalsOf,
    proceduresOf,
    type Declaration,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
} from "./int/ir";

export interface OptimizeOptions {
    /** 0 leaves the program untouched; 1 removes unreachable procedures and unreferenced globals. */
    level?: 0 | 1;
}

/**
 * Procedures the ENGINE calls by name, so nothing in the script needs to reference them. Taken from the
 * engine's own dispatch table (`gScriptProcNames`), which is the only authority on the set - a name
 * missing here is a procedure that gets deleted out of a working script.
 *
 * `no_p_proc` and `none_x_bad` are the table's own placeholders. They are kept as roots regardless: a
 * script defining one is doing something strange, and preserving it costs a few bytes where removing it
 * could break something nothing else records.
 */
const ENGINE_ENTRY_POINTS: ReadonlySet<string> = new Set([
    "no_p_proc",
    "start",
    "spatial_p_proc",
    "description_p_proc",
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
    const expression = (expr: Expr): Expr => {
        switch (expr.kind) {
            case "procRef":
                return { ...expr, index: procedures.get(expr.index) ?? expr.index };
            case "var":
                return expr.scope === "global" ? { ...expr, index: globals.get(expr.index) ?? expr.index } : expr;
            case "unary":
                return { ...expr, operand: expression(expr.operand) };
            case "binary":
                return { ...expr, left: expression(expr.left), right: expression(expr.right) };
            case "ternary":
                return {
                    ...expr,
                    cond: expression(expr.cond),
                    whenTrue: expression(expr.whenTrue),
                    whenFalse: expression(expr.whenFalse),
                };
            case "call":
                return { ...expr, target: expression(expr.target), args: expr.args.map(expression) };
            case "libCall":
                return { ...expr, args: expr.args.map(expression) };
            default:
                return expr;
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
 * Removes procedures nothing can reach and globals nothing reads, then renumbers what is left. Both
 * index spaces are positional - a procedure's slot is its position among procedure declarations, a
 * global's is its position among global ones - so dropping any entry shifts every later reference.
 */
export function optimize(program: Program, options: OptimizeOptions = {}): Program {
    if ((options.level ?? 0) < 1) return program;

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
