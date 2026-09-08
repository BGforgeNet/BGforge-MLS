# AGENTS.md

Project documentation is not here. Index: `docs/README.md`. Contributor workflow (build, test, debug):
`docs/development.md`. Architecture: `docs/architecture.md`, `server/INTERNALS.md`, `binary/INTERNALS.md`.

## Toolchain

- **pnpm only.** Never `npx`, `npm`, or any npm-series command - one-off commands, scripts, subagents and delegated
  tasks included. `pnpm exec playwright`, not `npx playwright`.
- Before any dependency bump, read `docs/dependencies.md` - the pins carry per-dependency rationale.
- Before adding security tooling, read `docs/supply-chain.md` - the two non-additions (no self-hosted secret scanner,
  no `dependabot.yml`) are recorded choices, not gaps.

## Reach for the right probe

Pick the cheapest tool that answers the actual question.

- **"What does the server return here?"** ->
  `pnpm lsp-probe <request> <file> <line> <col>` (1-based), request being one of `hover`, `completion`,
  `definition`, `references`, `symbols`, `signature`, `inlay`, `rename`, `codeaction`. Needs `pnpm build:dev`. Add
  `--game <dir>` (plus `--tlk-encoding` where the install needs it) for anything resolving TLK strrefs - without it
  strref hovers and hints come back empty. Waits for the workspace scan, so cross-file answers are complete
  (`--scan-timeout`, default 20s, warns on stderr rather than answering silently).
  `codeaction` sends the diagnostics the server published at that position, so it also reports what was published.
  Not a substitute for a UI/webview drive.
- **"Does this one SSL construct match the reference compiler?"** -> `pnpm ssl-diff <file.ssl>` or `-e '<source>'`
  (`-O1`/`-O2`, `--keep`), about a second. Not the corpus sweep - that answers "did anything regress" and belongs at
  close-out. Full loop: `compilers/ssl/AGENTS.md`.
- **"What does this install say about animation X?"** ->
  `pnpm anim-probe <gameDir> <set|members|cycles|ini|exists|files> <arg>...` (an id is hex with or without `0x`; a
  name matches `ANIMATE.IDS`/`ANISND.IDS`). `cycles` reports each stance's own frame counts per facing, which is what
  answers "how long is this animation" without a drive. Answers through the same index and resolvers the gallery
  uses, so its answer and the panel's cannot disagree - which a throwaway script re-deriving the naming rules can.
  Not a substitute for a gallery drive.
- **Any visual/CSS/layout change to the binary editor** -> render it, do not reason about the cascade blind. Run
  order: `pnpm -C binary build` (only if `binary/src` changed) -> `pnpm exec tsx binary-editor/test/harness/build.mts`
  (after any webview/Svelte/`styles.css` edit) -> one of the `render-*.mts` drivers in that same directory
  (`ls binary-editor/test/harness`). Prereq: `pnpm exec playwright install chromium`.
  Harness: `binary-editor/test/harness/README.md`. UI conventions and the screenshot review brief:
  `binary-editor/AGENTS.md`.
- **The whole extension in a real VS Code** -> `pnpm dev:web` (code-server; the harness above only draws the webview
  in isolation). Long-lived foreground server, default `0.0.0.0:8080` (`CODE_SERVER_PORT`/`CODE_SERVER_HOST`);
  confirm it is up before reporting a URL. The binary editor is a webview and needs a secure context
  (`http://localhost` or a trusted cert) or it renders blank. Details: `scripts/dev-web.md`.

## Testing against real external files

`external/` is gitignored but reproducible (`pnpm test:external`), so real-corpus coverage belongs in a
**committed test under `server/test/integration/`, never a throwaway script**. Fixture helpers, the `skipIf`
gate and the sibling to copy: `docs/development.md`.

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

- **`syntaxes/*.tmLanguage.json`** are fully generated from `syntaxes/*.tmLanguage.yml` by
  `scripts/syntaxes-to-json.sh`.
- **Stanzas marked `# Auto-generated`** inside `syntaxes/*.tmLanguage.yml` come from `server/data/*.yml` via
  `generate-data.sh`. Edit the data source and regenerate. Full list: `docs/data-pipeline.md`.
- **Generated artifacts are excluded from `oxfmt` but stay linted by `oxlint`.** The asymmetry is deliberate - do not
  "align" the two ignore lists. Authoritative exclusion list: `.oxfmtrc.json` `ignorePatterns`. Why, and the two
  guards that keep it honest: `docs/ignore-files.md`.
- **Sort `server/data/*.yml`** with `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts <file>`. Never
  hand-roll sorting.
- Both of the above are enforced by `scripts/utils/test/syntaxes-generated.test.ts`, which regenerates the JSON into
  a temp dir and re-runs the sorter in memory. It exempts the generator-owned data files, and
  `server/data/fallout-worldmap-txt.yml`, which is committed in a different order.

## Traps

- **Editing a workflow shifts `zizmor.yml`'s line-anchored ignores.** Each accepted finding is recorded as
  `<workflow>:<line>`, so inserting or deleting a line above one un-ignores it and `pnpm lint:workflows` fails
  reporting the OLD finding - never the stale anchor that caused it. Re-point the numbers in the same change, and read
  a workflow-lint failure as "did I shift an anchor?" before treating it as a new security finding.
