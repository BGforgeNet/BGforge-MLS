export { parseArgs, type ArgNotice, type SslArgs, type SslInput } from "./args";
export {
    buildProgram,
    compileFile,
    compilePreprocessed,
    compileText,
    emitProgram,
    toSourceError,
    toSourceOptions,
    CompileError,
    type CompileDiagnostic,
    type CompileOptions,
} from "./compile";
export { lowerProgram, LowerError, type LowerOptions } from "./lower";
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
