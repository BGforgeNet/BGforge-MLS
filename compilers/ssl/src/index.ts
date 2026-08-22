export { parseArgs, type ArgNotice, type SslArgs, type SslInput } from "./args";
export {
    buildProgram,
    compileFile,
    compilePreprocessed,
    compileSource,
    compileText,
    emitProgram,
    toSourceError,
    toSourceOptions,
    CompileError,
    type CompileDiagnostic,
    type CompileOptions,
    type CompileResult,
} from "./compile";
export { lowerProgram, LowerError, type LowerOptions } from "./lower";
/**
 * The IR a front end constructs. Exported because the back end is meant to serve more than the SSL
 * front end - see `int/ir.ts` for why it is a tree - and a second front end cannot build a `Program`
 * through a type it cannot name.
 */
export {
    alwaysReturns,
    externalsOf,
    globalsOf,
    proceduresOf,
    type AssignOp,
    type BinaryOp,
    type Declaration,
    type Expr,
    type ProcedureDecl,
    type Program,
    type Stmt,
    type UnaryOp,
    type UndefinedProcedure,
    type VariableDecl,
    type VarScope,
} from "./int/ir";
export { optimize, type OptimizeOptions } from "./optimize";
export {
    preprocess,
    preprocessText,
    preprocessTextWithOrigins,
    preprocessWithOrigins,
    PreprocessError,
    type LineOrigin,
    type Macro,
    type PreprocessedSource,
    type PreprocessOptions,
} from "./preprocess";
export { decompileToProgram, DecompileError } from "./int/decompile";
export { formatDisassembly, decodeCode, type Instruction } from "./int/disasm";
export { emitInt, EmitError, type EmitOptions } from "./int/emit";
export { printProgram, type PrintOptions } from "./int/print";
export { readInt, IntReadError, type IntFile, type IntProcedureEntry } from "./int/read";
export { preserveStringOrder } from "./int/string-order";
export { problemsOf, type CompilerProblem } from "./problems";
