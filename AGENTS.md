# AGENTS.md

Project documentation is not here. Index: `docs/README.md`. Contributor workflow (build, test, debug, submit):
`CONTRIBUTING.md`. Architecture: `docs/architecture.md`, `server/INTERNALS.md`, `binary/INTERNALS.md`.

## Toolchain

- **pnpm only.** Never `npx`, `npm`, or any npm-series command - one-off commands, scripts, subagents and delegated
  tasks included. `pnpm exec playwright`, not `npx playwright`.
- Transient test/build files go under the repo-level `tmp/` (or `os.tmpdir()` when system temp is genuinely required).
  Never under `server/test/`, `binary/test/`, or `scripts/**`.
- Before any dependency bump, read `docs/dependencies.md` - the pins carry per-dependency rationale.
- Before adding security tooling, read `docs/supply-chain.md` - the two non-additions (no self-hosted secret scanner,
  no `dependabot.yml`) are recorded choices, not gaps.

## Reach for the right probe

Pick the cheapest tool that answers the actual question.

- **"What does the server return here?"** ->
  `pnpm lsp-probe <hover|completion|definition|references|symbols|signature|inlay|rename> <file> <line> <col>`
  (1-based). Needs `pnpm build:dev`. Add `--game <dir>` (plus `--tlk-encoding` where the install needs it) for
  anything resolving TLK strrefs - without it strref hovers and hints come back empty. Waits for the workspace scan,
  so cross-file answers are complete (`--scan-timeout`, default 20s, warns on stderr rather than answering silently).
  Not a substitute for a UI/webview drive.
- **"Does this one SSL construct match the reference compiler?"** -> `pnpm ssl-diff <file.ssl>` or `-e '<source>'`
  (`-O1`/`-O2`, `--keep`), about a second. Not the corpus sweep - that answers "did anything regress" and belongs at
  close-out. Full loop: `compilers/ssl/AGENTS.md`.
- **Any visual/CSS/layout change to the binary editor** -> render it, do not reason about the cascade blind. Run
  order: `pnpm -C binary build` (only if `binary/src` changed) -> `pnpm exec tsx binary-editor/test/harness/build.mts`
  (after any webview/Svelte/`styles.css` edit) -> a driver (`render-pro-eff.mts`, `render-itm.mts`, `render-spl.mts`,
  `render-cre.mts`, `render-map.mts`, `render-primitives.mts`). Prereq: `pnpm exec playwright install chromium`.
  Harness: `binary-editor/test/harness/README.md`. UI conventions and the screenshot review brief:
  `binary-editor/AGENTS.md`.
- **The whole extension in a real VS Code** -> `pnpm dev:web` (code-server; the harness above only draws the webview
  in isolation). Long-lived foreground server, default `0.0.0.0:8080` (`CODE_SERVER_PORT`/`CODE_SERVER_HOST`);
  confirm it is up before reporting a URL. The binary editor is a webview and needs a secure context
  (`http://localhost` or a trusted cert) or it renders blank. Details: `scripts/dev-web.md`.

## Verification tiers

Cheapest first: `scripts/test-scoped.sh [paths...]` while iterating (`--dry-run` prints the plan) -> `pnpm test`
(~3 min) -> `pnpm build:all` + `pnpm test:all` (~14 min) at close-out.

**`pnpm test` is not a close-out gate, however green** - the coverage thresholds live only in `test:all` and CI.
Full tier guidance, and the rule that every vitest config runs from any cwd: `CONTRIBUTING.md`.

## Testing against real external files

`external/` is gitignored but reproducible (`pnpm test:external`), so real-corpus coverage belongs in a
**committed test under `server/test/integration/`, never a throwaway script**. Fixture helpers, the `skipIf`
gate and the sibling to copy: `CONTRIBUTING.md`.

## Code conventions

- **Tree-sitter node types:** `SyntaxType.ActionCopy`, never the string `"action_copy"`. Import from `./syntax-type` in
  `server/`, from `../../../shared/syntax-types/<grammar>` in `@bgforge/format` (the canonical home). Generated - see
  `grammars/README.md` (Type Generation).
- **A package's `src/` never imports its own name.** Inside `format/src/`, reach `format-utils` by relative path, not
  as `@bgforge/format`. `test/` is exempt. Guard: `scripts/utils/test/no-package-self-import.test.ts`.
- **Libraries imported by transpiler sources** (iets, folib) use named re-exports (`export { X } from './module'`),
  never `export *`. Ambient `declare` belongs in `.d.ts`, never `.ts`. Reference pattern: folib's `src/index.ts`.
- **URIs entering the provider system** are normalized by `normalizeUri()` (`core/normalized-uri.ts`);
  `ProviderRegistry` does it at the gateway. Normalize any new URI-accepting registry method. Use the `NormalizedUri`
  branded type for URIs as Map/Set keys.
- **Never call `connection.window.show{Information,Warning,Error}Message`** in server code. Use `showInfo()`,
  `showWarning()`, `showError()`, `showErrorWithActions()` from `user-messages.ts`. Enforced by an oxlint rule.
- **Webview CSP:** `style-src` must include `{{cspSource}}`, not a bare nonce - the real panel silently drops a
  nonce-only stylesheet while headless renders still pass. Load CSS as `webview.asWebviewUri()` `<link>`, keep the
  nonce for `script-src`, add each CSS dir to `localResourceRoots`. Why: `docs/architecture.md` (Webview CSP).
  Guard: `client/test/webview-csp.test.ts`.

## Generated files - never hand-edit

- **`syntaxes/*.tmLanguage.json`** are fully generated. After editing any `syntaxes/*.tmLanguage.yml`, run
  `scripts/syntaxes-to-json.sh` before testing or committing.
- **Stanzas marked `# Auto-generated`** inside `syntaxes/*.tmLanguage.yml` come from `server/data/*.yml` via
  `generate-data.sh`. Edit the data source and regenerate. Full list: `docs/data-pipeline.md`.
- **Generated artifacts are excluded from `oxfmt` but stay linted by `oxlint`.** The asymmetry is deliberate - do not
  "align" the two ignore lists. Authoritative exclusion list: `.oxfmtrc.json` `ignorePatterns`. Why, and the two
  guards that keep it honest: `docs/ignore-files.md`.
- **Sort `server/data/*.yml`** with `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts <file>`. Never
  hand-roll sorting.

## Traps

- **Editing a workflow shifts `zizmor.yml`'s line-anchored ignores.** Each accepted finding is recorded as
  `<workflow>:<line>`, so inserting or deleting a line above one un-ignores it and `pnpm lint:workflows` fails
  reporting the OLD finding - never the stale anchor that caused it. Re-point the numbers in the same change, and read
  a workflow-lint failure as "did I shift an anchor?" before treating it as a new security finding.
