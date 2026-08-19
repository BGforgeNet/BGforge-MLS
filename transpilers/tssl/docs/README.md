# TSSL -- TypeScript to SSL Transpiler

TSSL is a TypeScript subset that transpiles to Fallout SSL (Star-Trek Scripting Language). It lets you write Fallout 1/2 game scripts using TypeScript syntax with full IDE support -- type checking, autocomplete, go-to-definition, and module imports -- while targeting the same runtime as hand-written SSL.

`.tssl` files are resolved and converted to `.ssl` by the transpiler (imports included), then compiled to `.int` bytecode by sslc.

## How It Works

1. You write `.tssl` files using a subset of TypeScript
2. Transpiler converts `.tssl` to `.ssl`, the resulting file is written next to the source
3. sslc compiles the `.ssl` to `.int` for the Fallout engine

Engine builtins and sfall functions are provided by [folib](https://github.com/BGforgeNet/folib) as typed declarations.

## Guides

- **[Writing TSSL](writing-tssl.md)** -- Comprehensive reference for all supported syntax, forbidden constructs, and gotchas
- **[Converting SSL to TSSL](converting-ssl-to-tssl.md)** -- Step-by-step migration guide from existing SSL scripts
- **[LLM Reference](llms.txt)** -- Compact reference optimized for LLM context windows (copy into your project for AI-assisted coding)
