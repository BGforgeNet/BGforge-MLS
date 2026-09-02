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
tssl src/ -r --ssl                # bytecode, keeping the readable .ssl beside it
tssl src/ -r --ssl --no-int       # the readable .ssl alone, for a tree that commits it
```

- `--ssl` - also write the `.ssl`. Off by default
- `--no-int` - skip the bytecode, leaving only the `.ssl`. The `.int` is written unless this is passed,
  and passing it without `--ssl` is an error, since the run would write nothing. `--opt` and `-s` steer
  the bytecode emitter it skips, so passing either alongside warns and carries on: the optimisation
  choice belongs to whatever compiles the generated `.ssl`.
- `--opt <0|1|2>` - optimisation level (default 1, matching the `ssl` compiler's own default)
- `-s` - short-circuit `and`/`or`: skip the right operand once the left decides the result
- `-r`, `-q`, `--jobs <n>`, `--check` - as the repo's other CLIs

## The two outputs agree, and that is checked

`--ssl` is a guarantee rather than an offer. The repo's external gate compiles the emitted `.ssl`
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

## The folib contract

Every `.tssl` is written against [folib](https://github.com/BGforgeNet/folib), and the coupling runs both ways.

### folib is the user's dependency, not this package's

The mod declares it (`"folib": "^0.4.1"` in its own package.json). This repo declares it nowhere - not in a
manifest, not vendored - and resolves it from the user's `node_modules` through the TypeScript checker. That is
deliberate: a compiler that pinned the library its users write against would be choosing their version for them.

It follows that the corpus differential pins folib only transitively, through the mod's own lockfile, and that no
in-repo test stands folib up.

### The names this compiler hardcodes

Four names, and they are the whole of what folib's vocabulary costs. `list` and `map` share every site, so they
share a row.

| Name           | Meaning                                                   | Where                                      |
| -------------- | --------------------------------------------------------- | ------------------------------------------ |
| `list`, `map`  | Array and map literal syntax, and reserved variable names | `src/types.ts`, then both routes' lowering |
| `sfall_typeof` | The engine's `typeof`, renamed around the TS keyword      | `src/types.ts` (`sslName`)                 |
| `FLOAT1`       | `1.0`, for sources predating float-literal preservation   | `src/convert-operators.ts`, marked to go   |

These are hardcoded rather than read off tags on folib's declarations, the way `@inline` is, because both sets are
closed. `sfall_typeof` is the only rename among folib's 22 `sfall_*` names - the rest are the engine's own
spellings - and `list`/`map` are the only literal-syntax helpers, with `list_as_array` and `map_var` sitting beside
them as ordinary functions. The engine's function set does not grow, so folib cannot acquire a third case, and a tag
convention would be a mechanism for a population that cannot change.

Two further things the compiler does with folib are neither its names nor its due: `declare const` staying ambient
vocabulary, and resolving a named-re-export barrel through package.json `exports`. This repo requires both of any
library a transpiler imports - named re-exports rather than `export *`, and ambient declarations in `.d.ts` rather
than `.ts` - so any conforming library gets them.

### What this compiler guarantees folib

This direction is the one with no compile error to catch it: folib is written against these, so tightening any of
them breaks a released folib rather than this package.

- **`@inline` on a function asks for a `#define`.** The tag's name and its meaning are a shared convention;
  renaming it, or changing what it expands to, is a change to both repos.
- **A tagged function the macro extractor cannot read stays an ordinary procedure.** Inline-ness is decided by
  successful extraction, never by the tag alone, so a body that is neither a sequence of calls nor a returned
  value - control flow, a local - falls back rather than failing. Making extraction failure an error would stop
  such a folib function compiling (`src/program-model.ts`).
- **The same constant declared twice with the same value is not a collision.** Both declarations emit and the
  second `#define` is a no-op; only a name bound to two different values is refused. fo2tweaks and folib both
  define `PRODATA_SC_TYPE` as 32 (`src/program-model.ts`).

### The compiler reads folib's source, not its API

folib's `exports` map resolves to `.ts` files, and its `files` list ships `src`. That is a requirement, not an
incidental: this compiler reads declaration _nodes_ - function bodies for `@inline` extraction, float literals as
written, JSDoc tags - which is also why `moduleResolution` is `Bundler` and why no bundler sits in the pipeline.
Compiled output would carry the signatures and none of that, and `@inline` would silently stop producing macros.

## Build note

Imports `server/out/fallout-ssl-engine-procedures.json` - a tracked output of the server data pipeline,
regenerated from YAML by `scripts/generate-data.sh` (see `docs/data-pipeline.md`). A fresh clone builds
without running the generator; regenerate only after editing the YAML sources.
