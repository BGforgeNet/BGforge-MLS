# Working on the Fallout SSL compiler

Guidance for changing `compilers/ssl`. The package README describes what the compiler is and how to use
it; this file is about the loop for changing it. `docs/` conventions and the repo-root `AGENTS.md` still
apply.

## Check one construct with `pnpm ssl-diff`, not the corpus sweep

```bash
pnpm ssl-diff -e 'procedure start begin variable a[10]; end'
pnpm ssl-diff script.ssl -O2 --keep
```

It compiles the source with this compiler and with the bundled reference and byte-compares them, in about
a second: MATCH, DIFFER (with the first differing offset and a disassembly of each side), BOTH REFUSED, or
a one-sided refusal. Exit code is 0 only when the two agree.

**A one-sided refusal is a difference.** Several defects here were "we compile what the reference rejects"
rather than a byte mismatch - an over-permissive front end produces a script that builds in the editor and
fails in the user's real build, so the probe reports it as loudly as differing bytes.

It compiles through the library SOURCE, so it needs `pnpm build:grammar` (which writes `server/out/*.wasm`)
but not `pnpm build:ssl`. That is deliberate: **the `ssl` CLI carries its own grammar copy under `out/` that
`build:grammar` does not refresh**, so a probe run through the CLI after a grammar change reports a
divergence that no longer exists. Rebuild the CLI before trusting anything driven through it.

## Check a refactor with `pnpm ssl-verdicts`, not the corpus sweep either

```bash
pnpm ssl-verdicts --save tmp/verdicts.txt    # before you start
pnpm ssl-verdicts --check tmp/verdicts.txt   # after each change
```

`ssl-diff` answers "does THIS construct match"; this answers "did anything about the corpus change". It
sweeps every script at every level through this front end only - no reference process, so it takes about
three minutes, and about one with `--levels 0` while you are still iterating - and
records one line per script per level: the emitted bytes' digest, or the message it was refused with.
`--check` reports every difference grouped by what it means (now refused, now accepted, bytes changed,
first message changed) and exits non-zero if there are any.

That is the gate for a change that is not supposed to alter behaviour at all: a refactor, an error-reporting
rework, a lowering cleanup. It cannot tell you whether the compiler is RIGHT - only whether it still does
what it did before you started, which is the question the reference differential is too slow to answer at
edit-loop speed. A digest rather than a byte count, because equal-length-but-different is exactly what a
length would miss.

`SSL_CORPUS_ONLY=<stem>` and `SSL_CORPUS_LIMIT=<n>` narrow it, as they do the test suites.

## Where a finding goes once you have it

`test/int/compile.test.ts` holds a table of hand-written sources compared against the reference at `-O0`,
and a second table at `-O2`. It runs in about three seconds inside the normal unit suite, so anything worth
keeping graduates from the probe into a case there. Refusals belong in `test/lower.test.ts` beside the
other lowering guards, asserting the message AND its `line:column` prefix - the language server turns that
prefix into the diagnostic's position, so an error without one lands on line 1.

`test/integration/` sweeps every script in `external/fallout` at each level against the COMMITTED oracle
digests (`test/integration/reference-oracles.txt`), in-process and in a few minutes. It is the close-out
gate, not the edit loop, and it can only tell you about constructs real scripts happen to contain.

The oracles are regenerated - the old sixteen-minute live differential - with `pnpm ssl-oracles`, which
re-runs the bundled compiler over the whole corpus and refuses to write a manifest ours diverges from.
Regenerate after bumping the bundled compiler dependency, bumping a corpus pin in `external/fallout.txt`,
or deliberately changing preprocessor behaviour; the sweeps assert the first two pins themselves and fail
with "regenerate" when they have moved.

`pnpm tssl-oracles <repo>` is the same idea one layer up, for the transpiler: it digests the INT bytes each
`.tssl` in a mod repo transpiles-and-compiles to, against `test/integration/tssl-int-oracles.txt`. It runs
from `scripts/test-transpile-external.sh` and exists to outlive `ssl-equiv`, which needs a committed `.ssl`
to compare against and so cannot survive a mod dropping the intermediate.

**Its pinning is the deliberate inverse of the manifest above, and the distinction is the whole point.**
`reference-oracles.txt` pins the compiler because a bump invalidates the oracle; there, both the transpiler
and the compiler are ours and under test, so a digest that moves is a finding to review and never a prompt
to regenerate. Only the corpus is pinned. `--update` rewrites the manifest and is an explicit reviewed act.
It is also the only sweep that compiles a real script with `-s`: the switch sets are recorded in the
manifest header, and they include the `-O2 -s` mods actually ship.

## The second front end

`transpilers/tssl/src/int/lower.ts` builds the IR from a TypeScript AST instead of from the grammar, so a
`.tssl` reaches bytecode with no SSL text in between. **It compiles the whole FO2tweaks repo
byte-identically to the text route** - 27 scripts at `-O0`, `-O1`, `-O2` and the `-O2 -s` mods ship - and
still refuses, positioned at the line, anything it does not lower. `src/desugar.ts` holds the expansions
the two front ends must not reimplement separately; `for`, `foreach`, `switch` and array/map literals all
reach it from both sides.

`pnpm tssl-int-diff <repo-or-file> [switches] [-- more switches]` compiles each source both ways and
byte-compares, rendering both programs through `printProgram` and naming the first line they disagree on.
It runs in `scripts/test-transpile-external.sh` as an enforced gate, which is what makes an emitted `.ssl`
a guarantee rather than an offer: it is checked to compile to the same bytes the direct route produces.

**The text route is the oracle, and it is on a clock**: it exists only while a mod still commits the
generated `.ssl`. Once that stops, the only check left is `tssl-oracles`, which reports that a byte moved
without saying which construct moved it.

Three agreements are load-bearing and were each found by this differential rather than by reading, so
change them only deliberately: an `@inline` macro substitutes its arguments TEXTUALLY (so `+` re-associates
across the splice, exactly as the `#define` it mirrors does); a negation folds to a constant only where an
initial value must be constant, never in an expression, where it is a push and a NEGATE; and a `switch`
always evaluates its subject into a temporary, because the text route renders `switch (X)` parenthesised
and its parser therefore never sees a bare name.

## The corpus cannot tell you what the language is

Every defect found by reading the reference compiler's own lexer and parser was invisible to a green sweep
of 1517 scripts: `\v` decoded as the letter `v`, adjacent string literals, character constants, `variable
a[10]` never creating its array, `break` outside a loop compiling to a jump into whatever was on the stack.
None of those appear in the corpus, so the differential agreed with us all the way.

So when the question is "what does the language do here", read the reference implementation - it is open
source, and one read settles what a differential can only guess at. Use the corpus for frequency ("does
anyone actually write this"), and the probe to confirm what you read.

## Conventions

- The reference compiler is never named in committed files. Describe what it does; do not cite its source
  files or internal symbols.
- Its tables are not vendored. A handful of values in tests is fine.
- Where behaviour differs from it deliberately, the difference goes in the README's differences table.
  Byte-for-byte sameness is not required, but every difference is understood and written down.
