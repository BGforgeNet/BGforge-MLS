# Dependencies

Dependency bumps stay within the current major version. `pnpm update -r` is run periodically to pick up minor and
patch releases across the workspace; major bumps (including 0.x -> 0.y where y > current, which npm treats as
breaking) are deferred until an explicit, motivated upgrade pass. This trades currency for stability: strict mode,
`verbatimModuleSyntax`, and the custom TS config make major-bump churn expensive, and the extension's user surface is
small enough that we gain little from being on the absolute newest release of every library.

Each entry below documents why a dependency is held at a specific version or range rather than left to float.
Consult this list before any dependency bump.

## After a bump, read the output - a green gate is not the check

Tools announce their own changes through build and test output: a deprecation, a default they plan to adopt in the
next major, a hint that some config now wants stating explicitly. None of it fails a build, so "it still builds"
reports nothing about it.

The test scripts run their jobs in parallel with each job's output in a log file, and `scripts/parallel-lib.sh`
reports the advisory lines it finds in a passing job's log rather than failing the job - an upstream advisory lands
on someone else's schedule and should not block unrelated work. Acting on it is still this list's job.

So, per bump:

1. Read the release notes for every version crossed, not just the newest, and reconsider existing code against
   them.
2. Run `pnpm build:all` and read its output. Builds are where tsdown, rolldown and esbuild speak, and none of that
   reaches the test gate.
3. Run the gate and act on whatever its warning report names.

## Per-dependency holds

- The lockstep groups and the single-version entries are defined once in the `catalog:` map in
  `pnpm-workspace.yaml` and referenced as `"catalog:"` from every member `package.json`. Editing a version
  therefore means editing the one catalog entry every member resolves. The lockstep groups
  are the LSP triplet, `ts-morph` with `typescript`, `vitest` with `@vitest/coverage-v8`, `esbuild` with
  `esbuild-wasm`, and `tree-sitter-cli` with `web-tree-sitter`; every other catalog entry is a single-version entry,
  one bump site for a dependency several packages declare. The hold rationale for the LSP triplet,
  `ts-morph`/`typescript`, `@types/node` and `tree-sitter-cli` lives in the bullets below, and the catalog comment
  beside the `vitest` and `esbuild` pairs says why each pair moves together - the catalog only centralizes the version
  strings.
- The LSP triplet (`vscode-languageclient`, `vscode-languageserver`, `vscode-languageserver-protocol`) moves TOGETHER,
  never independently: each client/server release pins one protocol version, and bumping the protocol patch alone
  breaks the `client.sendRequest(ExecuteCommandRequest.type, ...)` overloads. `vscode-languageserver-textdocument`
  (declared by `server/` alone) moves with them. A client major can raise the minimum supported VS Code, so on the
  next LSP major move all three in lockstep and re-check the `engines.vscode` floor.
- The `overrides:` entries in `pnpm-workspace.yaml` exist for security-advisory reasons; the per-advisory rationale
  and the drop policy live in the comment block above them. Revisit only when the underlying advisories
  are closed.
- `ts-morph` and the workspace `typescript` move together and never separately. ts-morph bundles its TypeScript
  rather than treating it as a peer, so the ts-morph version chooses the TS compiler that runs against transpiler
  ASTs regardless of the workspace `typescript` pin, while `tsc --noEmit` and `svelte-check` use the workspace one.
  Letting them skew allows a construct the gate accepts and the transpiler's parser does not - a defect nothing in CI
  would surface. So `typescript` stays on the line the current ts-morph major bundles. The two TS Language Service
  plugins are not part of that skew: they import `typescript` as a type-only import and run against the compiler the
  host tsserver injects at load time, so the workspace pin decides only which API shapes they type-check against.
  Next move is TS 7, gated on a ts-morph major bundling it AND on `svelte-check` accepting it (its `typescript` peer
  range decides). `tsc` does not read `.svelte` files, so after the move run `pnpm typecheck:svelte` as well as
  every `tsc` config.
- `@types/node` tracks the latest LTS Node major. The published packages support LTS Node only (`engines.node`
  `>=20`), so do not bump `@types/node` to odd-numbered "Current" majors - that would expose type definitions for APIs
  not present at the supported runtime floor. Move it forward only when a new even-numbered Node release reaches LTS.
  That is a calendar trigger nothing in the repo can fire, so it needs checking rather than waiting on: an even major
  is released in April and enters LTS the following October, and `curl -s https://nodejs.org/dist/index.json` reports
  each release's `lts` field.
- `ini` (runtime dep of `@bgforge/format`) is held at `^6.x`; `7.0.0` is a major with potential parse/stringify
  behavior changes that need a changelog review before adoption. It also carries a second, independent hold reason:
  ini 7's engine floor (`^22.22.2 || ^24.15.0 || >=26`) drops Node 20/21, which the published packages still support
  (`engines.node` `>=20`). Both reasons must clear before the bump.
- `playwright` (devDep) is pinned to an EXACT version (no caret) because the webview harnesses launch a browser from
  Playwright's version-keyed cache: a development machine and the `Harness` CI job download that browser via
  `playwright install`, and a caret drift to a version whose browser revision is not cached would break the harness
  run until a re-download. Bump the pin and re-run `playwright install` together. A plain `pnpm install` never
  downloads a browser - the harness paths install Chromium explicitly.
- `bits-ui` (client devDep, bundled into the binary-editor and animation-editor webviews) is exact-pinned (no caret).
  Its primitives (Tabs, Combobox, Checkbox, the flag-group controls) render user-visible chrome, so version moves are
  deliberate: bump the pin and verify via the render harness drivers that exercise those primitives
  (`render-primitives.mts`, `render-resource-picker.mts`, `render-creature-palette.mts`) - never let a caret drift
  change webview rendering as a side effect of an unrelated install.
- `esbuild-wasm` is caret-pinned, but bumps must re-verify the child-runtime workaround: esbuild-wasm's Node build
  spawns `node <bin/esbuild>` via a bare PATH lookup, and `transpilers/common/node-runtime.ts` points that lookup at
  the editor's own runtime before esbuild spawns. The fix is coupled to esbuild-wasm's spawn mechanism, so after any
  version move confirm the spawn shape is unchanged (see the node-runtime.ts header) and re-run the transpile smoke
  path.
- `tree-sitter-cli` is exact-pinned (no caret) so a regenerated parser is reproducible from the manifest alone, and
  it shares a catalog group with `web-tree-sitter` because the CLI decides the parser ABI that runtime has to load.
  Nothing tracked but `shared/syntax-types/*.ts` can change when the pin moves: the generated `src/` and every
  `.wasm` are gitignored. A CLI release can change highlight captures, fixes included, so re-run
  `pnpm build:grammar && pnpm test:grammars` before moving the pin, and change a corpus expectation only where the
  grammar rule confirms the new capture.
- `knip` is tilde-pinned. A newer minor false-flags deps imported only from `.svelte` files as unused; the rationale,
  the version last re-tested and the re-test procedure live at the top of `knip.ts`, beside the config the reports
  would otherwise be silenced in. The range is deliberately a tilde: under a caret the hold would rest on the lockfile
  alone and `pnpm update` would walk straight past it.
- `@types/vscode` is tilde-pinned to the `engines.vscode` floor, never a caret. `engines.vscode` states the oldest VS
  Code the extension runs on; `@types/vscode` decides which API surface the compiler accepts. A caret floats the types
  to the newest published minor, so a call to an API absent from the floor VS Code type-checks cleanly and fails only
  at a user's runtime. Raising the floor is one deliberate change touching all three declarations together:
  `engines.vscode` in the root and `client/package.json`, and the pin. `pnpm outdated` reports this dependency as
  permanently behind - that is the pin working. Guard: `scripts/utils/test/vscode-types-floor.test.ts`.
- The `@stryker-mutator/*` triple (`core`, `typescript-checker`, `vitest-runner`) is held on the 9.x line. `10.0.0`
  sets a Node 22 floor, harmless here (Stryker is dev-only, CI runs Node 24), but it also adds an
  `empty-expression-mutator`, which changes the mutant population that the `break` threshold in `stryker.conf.json` is
  calibrated against. Move once the 10.x line has matured (a patch or minor behind `10.0.0`), and re-run
  `pnpm test:mutation` against that threshold in the same change.
- `@vscode/codicons` is held at `^0.0.45` while the only newer publish is a `0.0.46` prerelease. Move when a stable
  `0.0.46` ships.
- `zod` (runtime dep of `@bgforge/binary`) ships about 58 KB of locale data into the client bundle that nothing reads.
  `zod/v4/classic/external.js` re-exports the locales as a namespace (`export * as locales`), and a namespace object
  keeps every member live, so no bundler tree-shakes the other languages out. Both documented workarounds cost more
  than 58 KB is worth: patching the package means editing a dozen files (js, `.d.cts`, `.d.ts` and src across
  classic/mini/core) to keep runtime and types in step, and the alternative, moving the client off the esbuild CLI
  onto the JS API so a plugin can rewrite the re-export, means reimplementing `scripts/build-base-client.sh`'s flags
  including watch mode. Revisit if upstream splits the locales behind their own entry point.
  One thing to re-check on any bump rather than assume: since 4.4.1 `zod/v4/package.json` declares
  `"sideEffects": false`, which lets a bundler drop the `config(en())` call that registers English and silently
  degrades every message to `"Invalid input"` (upstream issue 5953). It does NOT happen here - bundling under this
  client's esbuild settings and running it against an unbundled control produced identical descriptive messages - and
  the reason is the same namespace export above, which keeps the locale module alive. So a future fix for the size
  problem could reintroduce the message bug; verify messages, not just bundle size.
- `pnpm` itself is pinned by the root `packageManager` field. `pnpm outdated` never reports it, so it needs checking
  by hand when the npm deps are swept. `pnpm/action-setup` takes no `version:`, so CI follows this field, and the
  action has to be a release that can install the pinned pnpm (v6.1.0 or later for the current pin). The version is
  load-bearing, not just reproducible: `minimumReleaseAge`, tarball-integrity preservation, and `pnpm publish`
  performing the npm OIDC exchange and provenance signing itself ([releasing.md](releasing.md)) are pnpm behaviours
  other entries rely on. pnpm also records the pin in a first YAML document of `pnpm-lock.yaml`, so the lockfile
  changes on every bump, and a tool reading the lockfile must accept multi-document YAML.
- `oxlint`, `@oxlint/plugins` and `oxfmt` are EXACT-pinned (no caret) - this is a reproducibility pin, not a hold: a
  newer release is taken once it has aged past the adoption cooldown, in a change of its own. A caret on a linter
  makes the set of enabled rules a property of whenever the lockfile was last refreshed, so the same commit lints
  clean on one machine and red on another; `.oxlintrc.json` records rules that began firing on a minor bump, each
  needing a decision. `@oxlint/plugins` must move in the same change as `oxlint` and to the same version - it
  supplies the plugin API that `.oxlint/oxlint-plugin-no-showmessage.mjs` is written against. Bumping means reading
  the release notes for newly-enabled rules, running `pnpm exec oxlint` on a clean tree, and deciding each new
  finding rather than mass-disabling.
- `oxlint-tsgolint` (the type-aware backend behind `pnpm lint:types`) is caret-ranged, but its version tracks the
  TypeScript-Go release it embeds (`7.0.x` embeds TS 7.0), NOT oxlint's. That embedded compiler builds the program,
  so it is stricter than the workspace `typescript` pin: it rejects `moduleResolution: node` (removed in TS 7), which
  is why both TS plugins use `node16`. That setting resolves and emits CommonJS in a package that declares no
  `"type"`, so `export = init` stays legal, and the shipped bundle does not depend on it, since
  `scripts/build-ts-plugin.sh` uses esbuild `--format=cjs`. A program that fails to construct reports zero findings,
  not an error per file, which reads exactly like clean - so after a bump, and after any tsconfig change, confirm the
  run still reports zero `tsconfig-error` lines. This is also the one place a TS 7 constraint already binds while the
  workspace `typescript` pin sits on 6.x.
- The lint binaries are pinned and checksum-verified the same way WeiDU is, in the scripts that fetch them rather
  than in a manifest: `actionlint` and `zizmor` in `scripts/lint-workflows.sh`, `shellcheck` and `shfmt` in
  `scripts/lint-shell.sh`. `shellcheck` is the one that is fetched even when the host already has it, because
  GitHub-hosted runners preinstall it and the runner image decides the version otherwise. Each records one sha256 per
  published asset, so bump the version and replace every hash together - a tag is mutable, the asset hash is what is
  actually verified. These are not covered by `pnpm outdated`; check them against upstream releases whenever the npm
  dependencies are swept.
- WeiDU is not an npm dependency but is pinned the same way, in `scripts/ensure-weidu.sh`: one version, one sha256
  per published asset. The test scripts and the CI build workflow call that script, which prefers a WeiDU already on
  the host and otherwise downloads the pinned one into `.dev/`. It backs every suite that drives WeiDU, and none of
  them skips for a missing binary: the vitest suites resolve it through `scripts/utils/src/weidu-binary.ts` and the
  TD sample test calls the script directly, so an absent binary is provisioned rather than letting a suite pass by
  never running. To bump: change the version, re-download each asset, and replace every checksum together (a tag is
  mutable, the asset hash is what is actually verified).
- `sslc-emscripten-noderawfs` (the built-in SSL compiler WASM, `server/package.json`) is an HTTPS GitHub-release
  tarball, and its `pnpm-lock.yaml` entry carries a hand-maintained `integrity` field. pnpm fails closed
  (`ERR_PNPM_MISSING_TARBALL_INTEGRITY`) on any tarball lockfile entry that lacks integrity, and URL-tarball resolvers
  only learn the hash on download - so when the package is reused from the store, the field is never emitted.
  Practical rule: **evolve the lockfile incrementally** (`pnpm install` / `pnpm update`); pnpm preserves the existing
  integrity across those, so `pnpm update` keeps working. Do **not** `rm pnpm-lock.yaml` to regenerate from scratch -
  that drops the field and breaks `pnpm update` until it is re-added. The release asset is immutable, so the hash is
  stable; if a full regen is ever unavoidable, restore the line
  `resolution: {integrity: sha512-rfaUD8f+Bsj2baPKZ3ZTzLqa4FK+2pHc17KmyFiiBC9iue7GeCCc5pz27oBhwh9Ev7j8F37IQWtqH1KsthZUbg==, tarball: <url>}`.
  The same dep is also listed under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (a non-registry tarball has no
  publish timestamp for the `minimumReleaseAge` window to check). After any bump of this dependency, regenerate the
  committed corpus oracles with `pnpm ssl-oracles` - the SSL integration sweeps pin the dependency's identity and
  refuse to run against a manifest generated for another build.
