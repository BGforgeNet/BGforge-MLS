# Working on the TSSL compiler

Guidance for changing `compilers/tssl`. The package README describes what the compiler is and how to use
it; `compilers/ssl/AGENTS.md` covers the shared back end and the differentials that gate both front ends.
This file covers the one thing neither of those does: what this compiler and
[folib](https://github.com/BGforgeNet/folib) - the library every `.tssl` is written against - owe each
other.

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

## folib's names this compiler hardcodes

Four names, and they are the whole of what folib's vocabulary costs us; `list` and `map` share every site
and so share a row below. Two more things the compiler does with
folib are neither its names nor its due: `declare const` staying ambient vocabulary, and resolving a
named-re-export barrel through package.json `exports`. Both are requirements the repo-root `AGENTS.md`
already places on any library a transpiler imports, so any conforming library gets them.

| Name           | Meaning                                                   | Where                                      |
| -------------- | --------------------------------------------------------- | ------------------------------------------ |
| `list`, `map`  | Array and map literal syntax, and reserved variable names | `src/types.ts`, then both routes' lowering |
| `sfall_typeof` | The engine's `typeof`, renamed around the TS keyword      | `src/types.ts` (`sslName`)                 |
| `FLOAT1`       | `1.0`, for sources predating float-literal preservation   | `src/convert-operators.ts`, marked to go   |

**Why these are hardcoded rather than read off tags on folib's declarations**, the way `@inline` is: both
sets are closed. `sfall_typeof` is the only rename among folib's 22 `sfall_*` names - the rest are the
engine's own spellings - and `list`/`map` are the only literal-syntax helpers, with `list_as_array` and
`map_var` sitting beside them as ordinary functions. The engine's function set does not grow, so folib
cannot acquire a third case, and a tag convention would be a mechanism for a population that cannot change.

## What this compiler guarantees folib

The coupling runs both ways, and this direction is the one with no compile error to catch it: folib is
written against these, so tightening any of them breaks a released folib rather than this package.

- **`@inline` on a function asks for a `#define`.** The tag's name and its meaning are a shared
  convention; renaming it, or changing what it expands to, is a change to both repos.
- **A tagged function the macro extractor cannot read stays an ordinary procedure.** Inline-ness is
  decided by successful extraction, never by the tag alone, so a body that is neither a sequence of calls
  nor a returned value - control flow, a local - falls back rather than failing. Making extraction
  failure an error would stop such a folib function compiling (`src/program-model.ts`).
- **The same constant declared twice with the same value is not a collision.** Both declarations emit and
  the second `#define` is a no-op; only a name bound to two different values is refused. fo2tweaks and
  folib both define `PRODATA_SC_TYPE` as 32 (`src/program-model.ts`).

## The compiler reads folib's source, not its API

folib's `exports` map resolves to `.ts` files, and its `files` list ships `src`. That is a requirement, not
an incidental: this compiler reads declaration _nodes_ - function bodies for `@inline` extraction, float
literals as written, JSDoc tags - which is also why `moduleResolution` is `Bundler` and why no bundler sits
in the pipeline. Compiled output would carry the signatures and none of that, and `@inline` would silently
stop producing macros.
