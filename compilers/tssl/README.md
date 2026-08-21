# `@bgforge/tssl`

The TSSL compiler: TypeScript source to Fallout INT bytecode.

A compiler rather than a transpiler, which is what its default output says - `.tssl` in, `.int` out, with
no SSL text produced or read on the way. The TypeScript AST becomes the compiler's IR directly, so nothing
here loads the SSL grammar. Emitting the readable SSL is one OPTION of it, kept because the generated text
is what a human reads and what an external compiler can be pointed at.

## Install

```bash
pnpm add -g @bgforge/tssl
```

Requires Node 20 or newer.

## Usage

```bash
tssl myscript.tssl                # write myscript.int
tssl src/ -r --opt 2 -s           # what a mod build wants
tssl src/ -r --transpile          # bytecode, keeping the readable .ssl beside it
```

- `--transpile` - also write the `.ssl`
- `--opt <0|1|2>` - optimisation level (default 1, matching the `ssl` compiler's own default)
- `-s` - short-circuit `and`/`or`: skip the right operand once the left decides the result
- `-r`, `-q`, `--jobs <n>`, `--check` - as the repo's other CLIs

## The two outputs agree, and that is checked

`--transpile` is a guarantee rather than an offer. The repo's external gate compiles the emitted `.ssl`
with the `ssl` compiler and byte-compares it against what this writes, across every optimisation level and
with short-circuiting both ways, over a whole real mod. The two routes cannot drift apart unnoticed.

Three agreements are load-bearing and were each found by that differential rather than by reading, so
change them only deliberately:

- An `@inline` function substitutes its arguments **textually**, so `+` re-associates across the splice
  exactly as the `#define` it mirrors does.
- A negation folds to a constant only where an initial value must be constant, never in an expression -
  there it is a push and a NEGATE.
- A `switch` always evaluates its subject into a temporary, because the SSL route renders `switch (X)`
  parenthesised and its parser therefore never sees a bare name.

## Library

```ts
import { transpile, compile, createBatchState } from "@bgforge/tssl";
```

`transpile` returns the SSL text; `compile` writes it. The bytecode path is
`lowerTsslProgram` from `@bgforge/tssl`'s internals plus `@bgforge/ssl`'s optimiser and emitter - the CLI
is the supported surface for it.

## Language guide

[TSSL docs](./docs/) - writing TSSL, and converting existing SSL to it.

## Build note

Imports `server/out/fallout-ssl-engine-procedures.json` - a tracked output of the server data pipeline,
regenerated from YAML by `scripts/generate-data.sh` (see `docs/data-pipeline.md`). A fresh clone builds
without running the generator; regenerate only after editing the YAML sources.
