# Binary-editor Playwright harness

## What it is

A headless Playwright harness that loads the real binary-editor webview (`App.svelte`) inside a Chromium
browser and drives structure-ops end-to-end through the actual host-to-webview message path. The Node side
calls `dispatch` (the same synchronous dispatch function the VSCode worker uses) and relays replies to the
webview via `window.postMessage`; the webview side is the unmodified production bundle built from
`harness-main.ts`. Row-count assertions are taken from Node-side `dispatch getChildren` calls (ground truth),
not from DOM inspection.

This is the only coverage of the real webview render/dispatch path. Unit tests in `binary-editor/test/`
cover byte-level correctness and adapter routing, but they run against a mock host and never exercise
App.svelte, VirtualList, RowActions, or the Svelte reactivity layer.

The drivers are:

- `render.mts` - MAP format; exercises structure-ops on Global Variables (reorder, insert-before/after,
  delete, duplicate, undo/redo x6).
- `render-itm.mts` - ITM format; exercises every structure-op on Abilities and Effects, plus the
  wm_sbook.itm regression (remove the only effect of an item with equipping count 0).
- `render-spl.mts` - SPL format; same op coverage as ITM, plus the casting-free spell regression
  (same equipping-range clamp path as ITM, via the shared IE structure-op core).
- `render-form.mts` - phantom (synthetic) format; drives the generic form/list renderer with a made-up
  descriptor to prove the UI handles a novel format with no format-specific code (all control types,
  group tabs vs. headed sections, master-detail list).
- `render-primitives.mts` - bits-ui primitives showcase + CSP gate (Select, Combobox, Checkbox, Menu,
  Tabs, compact RowActions) under the real strict nonce CSP.
- `render-pro-eff.mts` - PRO (Fallout item proto) and EFF (Infinity Engine effect); form-only formats,
  asserts the generic form renders real fixtures without error under CSP.
- `render-map-objects.mts` - MAP per-elevation object sections (the projection seam); opens a clean MAP
  whose objects fully decode, drives every structure-op on a lifted "Elevation 0 Objects" master-detail
  section, and asserts the read-only "Objects" counts form renders with no editable input.

Each driver prints per-op `PASS`/`FAIL` lines and an `ALL <FMT> OPS PASS` summary; exits non-zero on any
failure.

Two shared helpers back the drivers:

- `csp-gate.ts` - `installCspGate(page, label)` registers the Content-Security-Policy violation listeners
  and returns an `assertNoViolations()` that fails the run if any violation was captured. Every driver
  uses it so the CSP gate stays identical across formats.
- `theme-vars.ts` - `THEME_VARS`, the canonical VS Code Dark+ fallback `:root` block defining every
  `--vscode-*` variable `styles.css` consumes. `build.mts`, `render-form.mts`, and `render-primitives.mts`
  import it so adding a new variable to `styles.css` only needs one harness update.

## When to use it

- After changing the webview layer (`App.svelte`, `VirtualList`, `RowActions`, `ListSection`, `bridge.ts`).
- After changing the dispatch or structure-op path in `binary-editor/src/`.
- When adding structure-ops to a new binary format (e.g. CRE, PRO) - add a `render-<fmt>.mts` driver
  mirroring the existing ones and extend this README with the new driver's coverage notes.
- As a manual integration check before releasing binary-editor changes.

This harness is e2e-tier and intentionally NOT part of `pnpm test` or `pnpm test:all`, for the same reason
`pnpm test:e2e` is not: it requires a real browser and is not runnable in all environments.

It is type-checked via `test/harness/tsconfig.json`, which includes the DOM lib for the in-browser
`page.evaluate` callbacks; it is not part of the package build.

## Prerequisites

- **Playwright + a Chromium browser** must be available on `PATH` in whatever environment runs the harness.
  Install Playwright and its browsers globally:

  ```
  npm install -g playwright
  playwright install chromium
  ```

  Playwright is intentionally NOT listed in any `package.json` in this repo. It is an environment
  prerequisite, not a repo dependency.

- **Node 20+** (matched to the project's minimum supported runtime).

- **`tsx`** - available via the repo's dev dependencies (`pnpm exec tsx ...`).

- **`esbuild` and `esbuild-svelte`** - present in `client/package.json`; the workspace root `node_modules`
  resolves them for `build.mts`.

## How to run

**Step 1 - rebuild the binary bundle if `binary/src` changed.**

The harness imports `@bgforge/binary` as a package, which resolves to the prebuilt `binary/out/index.js`.
After any change to `binary/src`, rebuild before running the harness or it will see a stale adapter:

```
cd binary && pnpm build
```

**Step 2 - build the webview bundle.**

`build.mts` bundles `harness-main.ts` + `App.svelte` via esbuild+esbuild-svelte and writes the gitignored
`app.html` into this directory. It runs under `tsx` (it imports `theme-vars.ts`):

```
pnpm exec tsx binary-editor/test/harness/build.mts
```

The output `app.html` must exist before running any driver. Rebuild it after changing `harness-main.ts` or
any Svelte component it imports.

**Step 3 - run a driver.**

```
pnpm exec tsx binary-editor/test/harness/render.mts
pnpm exec tsx binary-editor/test/harness/render-itm.mts
pnpm exec tsx binary-editor/test/harness/render-spl.mts
pnpm exec tsx binary-editor/test/harness/render-form.mts
pnpm exec tsx binary-editor/test/harness/render-primitives.mts
pnpm exec tsx binary-editor/test/harness/render-pro-eff.mts
pnpm exec tsx binary-editor/test/harness/render-map-objects.mts
```

Expected output ends with `ALL OPS PASS` / `ALL ITM OPS PASS` / `ALL SPL OPS PASS` (and the equivalent
summary for the other drivers), exit 0. Any assertion failure prints `FAIL  <label>  <detail>` and exits
non-zero.

## Gitignored outputs

`app.html` and `*.png` screenshots are regenerated on every run and are listed in `.gitignore` in this
directory. Do not commit them.

`map-bytes.generated.ts` (a 730 KB blob that pre-dates this harness) is not used; drivers read real fixtures
directly from `client/testFixture/` and `external/`. Do not re-introduce a generated bytes file here.
