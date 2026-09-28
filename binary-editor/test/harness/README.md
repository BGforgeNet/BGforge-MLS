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

The drivers are the `render-*.mts` files in this directory (`ls binary-editor/test/harness/render-*.mts`); each
opens with a header saying what it drives and asserts. Each prints per-op `PASS`/`FAIL` lines and an
`ALL <FMT> OPS PASS` summary, and exits non-zero on any failure.

Among the shared helpers (the other modules here, each with its own header):

- `page-gate.ts` - `installPageGate(page, label)` registers the page-health listeners and returns an
  `assertPageClean()` that fails the run on any Content-Security-Policy violation or uncaught page error.
  Every driver uses it so the gate stays identical across formats. An uncaught error fails rather than logs
  because it is usually a driver's own `waitForFunction` predicate throwing, which silently turns that wait
  into a no-op while the run still reports every assertion green.
- `clip-gate.ts` - `collectClipViolations(page, context)` scans the current view for clipped value inputs
  (`scrollWidth > clientWidth`) and unsized dropdowns (a `.bb-combobox` with no `dd-*` width class), and
  `reportClipViolations(all, label)` logs and fails the run on any. Used by `render-clip-sweep.mts`; reusable
  from any driver to gate a view it renders.
- `theme-vars.ts` - `THEME_VARS`, the canonical VS Code Dark+ fallback `:root` block defining every
  `--vscode-*` variable `styles.css` consumes. `build.mts` and `render-primitives.mts` import it so adding a
  new variable to `styles.css` only needs one harness update.

## When to use it

- After changing the webview layer (`App.svelte`, `VirtualList`, `RowActions`, `ListSection`, `bridge.ts`).
- After changing the dispatch or structure-op path in `binary-editor/src/`.
- When adding structure-ops to a new binary format - add a `render-<fmt>.mts` driver mirroring the existing
  ones, with a header saying what it covers.
- As a manual integration check before releasing binary-editor changes.

This harness is e2e-tier and intentionally NOT part of `pnpm test` or `pnpm test:all`, for the same reason
`pnpm test:e2e` is not: it requires a real browser and is not runnable in all environments.

It is type-checked via `test/harness/tsconfig.json`, which includes the DOM lib for the in-browser
`page.evaluate` callbacks; it is not part of the package build.

## Prerequisites

- **Playwright** is a pinned devDependency (`pnpm install` provides it), so `pnpm exec tsx <driver>` resolves
  `import { chromium } from "playwright"` with no global install. Its browser postinstall is skipped by pnpm's
  build-script gate, so install the one browser the drivers launch:

  ```
  pnpm exec playwright install chromium
  ```

- **Node 20+** (matched to the project's minimum supported runtime).

- **`tsx`** - available via the repo's dev dependencies (`pnpm exec tsx ...`).

- **`esbuild`, `esbuild-svelte`, `svelte` and `playwright`** - devDependencies of this package, installed by
  `pnpm install`.

## How to run

**Step 1 - rebuild the binary bundle if `binary/src` changed.**

The harness imports `@bgforge/binary` as a package, which resolves to the prebuilt `binary/out/index.js`.
After any change to `binary/src`, rebuild before running the harness or it will see a stale adapter:

```
cd binary && pnpm build
```

**Step 2 - build the webview bundle.**

`build.mts` bundles the webview entries via esbuild+esbuild-svelte and writes the gitignored `app.html` (binary
editor) and `image-app.html` (animation editor) into this directory. It runs under `tsx` (it imports
`theme-vars.ts`):

```
pnpm exec tsx binary-editor/test/harness/build.mts
```

The output HTML must exist before running any driver. Rebuild it after changing a harness entry or any Svelte
component it imports.

**Step 3 - run a driver**, or all of them with `pnpm test:harness`:

```
pnpm exec tsx binary-editor/test/harness/render-itm.mts
```

Expected output ends with the driver's `ALL ... PASS` summary, exit 0. Any assertion failure prints
`FAIL  <label>  <detail>` and exits non-zero. Screenshots land in the repository's `tmp/` directory
(`out-dir.ts`).

## Reading the screenshots

What to check in a screenshot, and which patterns are intentional: `binary-editor/AGENTS.md`. What the harness
itself leaves in one, and which is not a defect:

- The empty area at the bottom of some screenshots is the capture viewport: a full-page shot of a short form
  still extends to the viewport height.
- `shot-primitives.png` is a standalone gallery of raw controls, not the dense field layout, so the tier sizing
  does not apply there.
- Some drivers capture at device scale 1 rather than 2, so minor softness is expected.

## Where these run in CI

The drivers run as a regression suite in the separate `Harness` workflow, via `scripts/test-harness.sh` (which
covers both editors' harnesses). They are deliberately excluded from `pnpm test` and `pnpm test:all`, which run
browserless - so a green `pnpm test:all` says nothing about these gates, and a change to the render layer needs
a driver run of its own.

## Gitignored outputs

`app.html` and `image-app.html` are regenerated by `build.mts` and gitignored in this directory. Do not commit
them.

`map-bytes.generated.ts` (a 730 KB blob that pre-dates this harness) is not used; drivers read real fixtures
directly from `client/testFixture/` and `external/`. Do not re-introduce a generated bytes file here.
