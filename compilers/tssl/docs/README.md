# TSSL -- TypeScript to Fallout bytecode

TSSL is a TypeScript subset that compiles to Fallout 2 INT bytecode. It lets you write game scripts using
TypeScript syntax with full IDE support -- type checking, autocomplete, go-to-definition, and module imports --
while targeting the same runtime as hand-written SSL.

`tssl script.tssl` writes `script.int`. The TypeScript AST becomes the compiler's intermediate representation
directly: no SSL text is produced or read on the way, and no external compiler is involved.

## How It Works

1. You write `.tssl` files using a subset of TypeScript
2. `tssl` resolves the imports, lowers the result to bytecode, and writes `.int` beside the source
3. The Fallout engine runs that `.int`

Engine builtins and sfall functions are provided by [folib](https://github.com/BGforgeNet/folib) as typed
declarations.

## The readable SSL is an option

`tssl script.tssl --transpile` also writes `script.ssl` -- for a mod that still ships generated SSL, for an
external compiler to be pointed at, or just to read what a script became. It is written from the source rather
than decompiled from the bytecode, and the repo's external gate byte-compares the two routes across a real mod
at every optimisation level, so the `.ssl` beside the bytecode does compile to those bytes.

In the editor, the same output is available behind the `bgforge.tssl.emitSsl` setting.

## Guides

- **[Writing TSSL](writing-tssl.md)** -- Comprehensive reference for all supported syntax, forbidden constructs, and gotchas
- **[Converting SSL to TSSL](converting-ssl-to-tssl.md)** -- Step-by-step migration guide from existing SSL scripts
- **[LLM Reference](llms.txt)** -- Compact reference optimized for LLM context windows (copy into your project for AI-assisted coding)
