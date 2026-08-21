# Working on the TSSL compiler

Guidance for changing `compilers/tssl`. The package README describes what the compiler is and how to use
it; `compilers/ssl/AGENTS.md` covers the shared back end and the differentials that gate both front ends.
This file covers the one thing neither of those does: what this compiler assumes about
[folib](https://github.com/BGforgeNet/folib), the library every `.tssl` is written against.

## folib is the user's dependency, not ours

The mod declares it (`"folib": "^0.4.1"` in its own package.json). This repo declares it nowhere - not in
a manifest, not vendored - and resolves it from the user's `node_modules` through the TypeScript checker.
Keep it that way: a compiler that pinned the library its users write against would be choosing their
version for them.

It follows that the corpus differential pins folib only transitively, through the mod's own lockfile, and
that no in-repo test stands folib up. Everything below is checked solely by `pnpm tssl-int-diff` against a
checked-out mod. An unresolvable import is refused rather than skipped, so that gate cannot pass having
compared nothing - `pnpm tssl-int-diff external/fallout/FO2tweaks` with folib absent exits non-zero on
`cannot resolve module 'folib'`, not with 27 sources counted as unsupported.

## What this compiler assumes about it

Change any of these only against folib as it actually is, not from the name alone.

| Assumption                                                             | Where                                      |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `list` and `map` are reserved variable names                           | `src/types.ts`, `src/convert-operators.ts` |
| `list()` and `map()` are literal syntax, not procedure calls           | `src/emit.ts`, `src/int/lower.ts`          |
| `sfall_typeof` is how a keyword-colliding engine function is spelled   | `src/types.ts` (`sslName`)                 |
| `@inline` on a function is what asks for a `#define`                   | `src/inline-functions.ts`                  |
| A tagged function whose body is not the macro shape stays a procedure  | `src/program-model.ts` (`map_first_run`)   |
| `declare const` is ambient vocabulary, never emitted                   | `src/program-model.ts` (`SCRIPT_REALNAME`) |
| The same constant defined twice with the same value is not a conflict  | `src/program-model.ts` (`PRODATA_SC_TYPE`) |
| A barrel of named re-exports, routed through package.json `exports`    | `src/program-model.ts`, `src/index.ts`     |
| `FLOAT1` means `1.0`, for sources predating float-literal preservation | `src/convert-operators.ts`                 |

Two of these are packaging rules the repo-root `AGENTS.md` states as requirements for any library a
transpiler imports: named re-exports rather than `export *`, and ambient declarations in `.d.ts` rather
than `.ts`. They are listed here because this compiler is what breaks when they are not met.

## The compiler reads folib's source, not its API

folib's `exports` map resolves to `.ts` files, and its `files` list ships `src`. That is a requirement, not
an incidental: this compiler reads declaration _nodes_ - function bodies for `@inline` extraction, float
literals as written, JSDoc tags - which is also why `moduleResolution` is `Bundler` and why no bundler sits
in the pipeline. Compiled output would carry the signatures and none of that, and `@inline` would silently
stop producing macros.
