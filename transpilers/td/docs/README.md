# TD -- TypeScript to D Transpiler

TD is a TypeScript DSL that transpiles to WeiDU D dialog files for Infinity Engine games (Baldur's Gate, Icewind Dale, Planescape: Torment). Functions are dialog states, method chains define transitions, and the transpiler handles state collection, text references, and patch operations.

`.td` files are bundled with rolldown, converted to `.d` via the transpiler, then compiled by WeiDU.

## How It Works

1. You write `.td` files using a TypeScript DSL (functions as states, method chains as transitions)
2. Transpiler converts `.td` to `.d`, the resulting file is written next to the source
3. WeiDU compiles the `.d` into the game

Engine builtins (triggers, actions, objects) and text helpers (`tra`, `tlk`, `obj`) are provided by [IETS](https://github.com/BGforgeNet/iets) as typed declarations.

## Guides

- **[Writing TD](writing-td.md)** -- Comprehensive reference for the dialog API, state/transition model, and gotchas
- **[LLM Reference](llms.txt)** -- Compact reference optimized for LLM context windows (copy into your project for AI-assisted coding)
