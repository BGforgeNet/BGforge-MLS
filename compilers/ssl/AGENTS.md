# Working on the Fallout SSL compiler

The edit loop for `compilers/ssl`. What the compiler is, where it deliberately differs from the reference, and
how the two oracle manifests pin opposite things: the package README. How the two front ends share one back
end: `compilers/README.md`.

## Pick the probe that answers the question

| Question                            | Probe                     | Cost    |
| ----------------------------------- | ------------------------- | ------- |
| Does THIS construct match?          | `pnpm ssl-diff`           | ~1s     |
| Did anything about the corpus move? | `pnpm ssl-verdicts`       | ~3 min  |
| Did anything regress? (close-out)   | `test/integration/` sweep | minutes |

```bash
pnpm ssl-diff -e 'procedure start begin variable a[10]; end'
pnpm ssl-diff script.ssl -O2 --keep

pnpm ssl-verdicts --save tmp/verdicts.txt    # before you start
pnpm ssl-verdicts --check tmp/verdicts.txt   # after each change
```

- `ssl-diff` compiles both ways and byte-compares: MATCH, DIFFER (first differing offset plus a disassembly of
  each side), BOTH REFUSED, or a one-sided refusal. Exit 0 only when the two agree.
- **`ssl-diff` needs `pnpm build:grammar`, not `pnpm build:ssl`** - it compiles through the library source.
- `ssl-verdicts` is the gate for a change meant to alter no behaviour at all (refactor, error-reporting rework,
  lowering cleanup). It sweeps this front end only - no reference process - recording per script per level the
  emitted digest or the refusal message; `--check` groups differences (now refused, now accepted, bytes changed,
  first message changed) and exits non-zero on any. It cannot tell you the compiler is RIGHT, only that it still
  does what it did. `--levels 0` takes about a minute while iterating.
- `SSL_CORPUS_ONLY=<stem>` and `SSL_CORPUS_LIMIT=<n>` narrow both, as they do the test suites.

## Where a finding graduates to

- **A matching construct worth keeping** -> `test/int/compile.test.ts` (a `-O0` table and a `-O2` table,
  compared against the reference; runs in ~3s inside the normal unit suite).
- **A refusal** -> `test/lower.test.ts`, beside the other lowering guards. Assert the message AND its
  `line:column` prefix.

Regenerate `pnpm ssl-oracles` after bumping the bundled compiler dependency, bumping a corpus pin in
`external/fallout.txt`, or deliberately changing preprocessor behaviour. The sweeps fail with "regenerate" when
a pin has moved.

## The corpus cannot tell you what the language is

Every defect found by reading the reference compiler's own lexer and parser was invisible to a green sweep of
1517 scripts: `\v` decoded as the letter `v`, adjacent string literals, character constants, `variable a[10]`
never creating its array, `break` outside a loop compiling to a jump into whatever was on the stack. None
appear in the corpus, so the differential agreed with us all the way.

So when the question is "what does the language do here", **read the reference implementation** - it is open
source, and one read settles what a differential can only guess at. Use the corpus for frequency ("does anyone
actually write this"), and the probe to confirm what you read.

## Do not

- **Cite the reference compiler's source files or internal symbols**, or vendor its tables. Describe what it
  does. See `CONTRIBUTING.md` (Describing external tools).
- **Ship a deliberate difference without a row** in the README's differences table.
