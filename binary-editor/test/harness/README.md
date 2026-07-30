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

- `render-itm.mts` - ITM format; exercises every structure-op on Abilities and Effects, plus the
  wm_sbook.itm regression (remove the only effect of an item with equipping count 0).
- `render-spl.mts` - SPL format; same op coverage as ITM, plus the casting-free spell regression
  (same equipping-range clamp path as ITM, via the shared IE structure-op core).
- `render-primitives.mts` - bits-ui primitives showcase + CSP gate (Select, Combobox, Checkbox, Menu,
  Tabs, compact RowActions) under the real strict nonce CSP.
- `render-pro-eff.mts` - PRO (Fallout item proto) and EFF (Infinity Engine effect), both via the
  declarative layout; asserts each resolves its variant, renders fields with NO section tabs under CSP, and
  that the EFF opcode is a searchable combobox.
- `render-pro.mts` - PRO critter via the declarative single-page layout (LayoutRenderer); asserts the
  Header / Demographics / Final / Stats-matrix / Skills-grid panels render with two flag columns and NO
  section tabs, and screenshots at 1400x860 for visual review against the approved mockup.
- `render-pro-subtypes.mts` - the remaining PRO variants (item weapon/drug/armor, scenery door, wall, tile,
  misc); per fixture asserts the variant resolves, the page renders with no tabs and a non-zero label/value
  gap, and the bytes round-trip identically.
- `render-cre.mts` - CRE via the declarative layout; asserts the curated header panels, item-slots grid,
  and the five master-detail list sections (with caps) render with no tabs, the effect opcode is a
  searchable combobox, structure ops on two sections round-trip, and the file round-trips byte-identical.
- `render-map.mts` - MAP via the declarative layout; asserts header + flag panel, inline variable lists, the
  per-elevation object lists and present script sections render with no tabs, absent optional sections leave
  no panel, structure ops apply, and the file round-trips byte-identical.
- `render-resource-picker.mts` - the resref resource picker. The only driver that plays a host WITH an
  installed game: it runs each reply through the real `withGameContext` and answers `requestResourceList` from
  a synthetic index, so the picker renders at all. Asserts a resref field is a plain input without a game and a
  searchable combobox with one, that the list loads on first open and once per type, that the rendered-option
  cap reports its overflow, and that a name the install does not have still commits while only a resolvable one
  grows the open chip.
- `render-clip-sweep.mts` - the cross-format value-control clipping sweep. Opens every format, walks each
  primary tab (and selects the first list row to sweep detail forms), and runs the `clip-gate.ts` check on each
  view - failing if any value control clips its text or any dropdown renders without a `dd-*` width class. The
  one driver that verifies the single "no control clips" invariant across all formats, so a new clip anywhere
  is caught in one place. IE formats (external corpus) skip when absent; PRO/MAP always run.

Each driver prints per-op `PASS`/`FAIL` lines and an `ALL <FMT> OPS PASS` summary; exits non-zero on any
failure.

Three shared helpers back the drivers:

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
- When adding structure-ops to a new binary format (e.g. CRE, PRO) - add a `render-<fmt>.mts` driver
  mirroring the existing ones and extend this README with the new driver's coverage notes.
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
pnpm exec tsx binary-editor/test/harness/render-itm.mts
pnpm exec tsx binary-editor/test/harness/render-spl.mts
pnpm exec tsx binary-editor/test/harness/render-primitives.mts
pnpm exec tsx binary-editor/test/harness/render-pro-eff.mts
pnpm exec tsx binary-editor/test/harness/render-pro.mts
pnpm exec tsx binary-editor/test/harness/render-pro-subtypes.mts
pnpm exec tsx binary-editor/test/harness/render-cre.mts
pnpm exec tsx binary-editor/test/harness/render-map.mts
pnpm exec tsx binary-editor/test/harness/render-clip-sweep.mts
```

Expected output ends with `ALL OPS PASS` / `ALL ITM OPS PASS` / `ALL SPL OPS PASS` (and the equivalent
summary for the other drivers), exit 0. Any assertion failure prints `FAIL  <label>  <detail>` and exits
non-zero.

## Gitignored outputs

`app.html` and `*.png` screenshots are regenerated on every run and are listed in `.gitignore` in this
directory. Do not commit them.

`map-bytes.generated.ts` (a 730 KB blob that pre-dates this harness) is not used; drivers read real fixtures
directly from `client/testFixture/` and `external/`. Do not re-introduce a generated bytes file here.
