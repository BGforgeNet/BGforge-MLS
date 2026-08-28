# TBAF -- TypeScript to BAF Transpiler

TBAF is a TypeScript subset that transpiles to BAF (Infinity Engine AI scripts). It lets you use TypeScript abstractions -- variables, functions, loops, enums -- that are fully resolved at compile time into flat `IF/THEN/END` blocks. BAF has no runtime variables or control flow; TBAF provides those at compile time.

`.tbaf` files are bundled with rolldown, converted to `.baf` via the transpiler, then compiled by WeiDU.

## How It Works

1. You write `.tbaf` files using a subset of TypeScript
2. Transpiler converts `.tbaf` to `.baf`, the resulting file is written next to the source
3. WeiDU compiles the `.baf` into the game

Engine builtins (triggers, actions, objects) are provided by [IETS](https://github.com/BGforgeNet/iets) as typed declarations.

## Guides

- **[Writing TBAF](writing-tbaf.md)** -- Comprehensive reference for all supported syntax, condition algebra, and gotchas
- **[LLM Reference](llms.txt)** -- Compact reference optimized for LLM context windows (copy into your project for AI-assisted coding)
