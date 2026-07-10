# Dialog editor render harness

Headless Playwright harness that loads the **production** dialog-editor webview in Chromium.
e2e-tier: run out of process, **not** part of `pnpm test` / `pnpm test:all`.

Two host modes: the render/behavior drivers run **hostless** (`postToHost` no-ops, as in the old
standalone harness), while `edit-roundtrip.mts` attaches the **real host session core**
(`DialogHostCore`, the logic `panel.ts` runs in production) over an in-memory document via
`fake-host.ts` - so the emit -> splice -> reparse -> adopt (+ editing overlay) -> `.tra` flush protocol is
exercised under automation, not only in a live code-server drive.

## Why it mounts the real `App` (not `DialogGraph`)

`harness-main.ts` mounts the production root `App.svelte` and the driver delivers the model
through the real `window.postMessage` channel App listens on. App holds the model in a Svelte
`$state` proxy and passes that proxy down to `DialogGraph`. This is the live webview's exact
path - the `postMessage` boundary, the `$state` proxy, the message handshake, the loading /
error / timeout states, and the production-shaped CSP (nonce'd script, `style-src
'unsafe-inline'`).

An earlier version mounted `DialogGraph` directly with a raw object literal. That skipped every
one of those seams and rendered green while the live editor was stuck on "Parsing dialog..." -
three production-only bugs hid in the gap (external `<script src>` blanking the panel,
`structuredClone($state)` throwing `DataCloneError`, a silent hang). Do not revert to a
direct `DialogGraph` mount: the point of the harness is to exercise what production does.

## Run

```bash
# Build app.html (a generated bundle - gitignored, not committed; required before any driver runs,
# and rebuilt after any webview/Svelte change):
pnpm exec tsx client/src/dialog-editor/test/harness/build.mts
# Drive the production path (posts the model, asserts render + a Duplicate edit + the
# error state; fails on any uncaught page error or CSP violation; writes the screenshot to repo tmp/):
pnpm exec tsx client/src/dialog-editor/test/harness/render.mts [out.png]
```

Prereqs are environmental, not repo deps: Playwright + a Chromium browser on `PATH`.

## Files

- `harness-main.ts` - runs the production webview entry (`webview/main.ts`: mounts `App.svelte`, posts `ready`).
- `build.mts` - bundles it to `app.html` (gitignored) with a production-shaped CSP.
- `driver-util.ts` - shared driver plumbing: app.html resolution (fail-loud when unbuilt), `.tra` parsing,
  condition polling, and the check/report accumulator.
- `render.mts` - the production-path driver (assertions + screenshot).
- `render-search.mts` - the tree find-bar driver (find-as-you-type, navigation, node-id dim guard).
- `edit-behavior.mts` - the selection/add/edit driver (the unified `select()` primitive + shared add/remove paths).
- `fake-host.ts` - `DialogHostCore` bound to an in-memory document/`.tra` (real server-side D parse, real splice).
- `edit-roundtrip.mts` - the host round-trip driver: injects `acquireVsCodeApi`, wires the webview to
  `fake-host.ts`, and pins the protocol end to end (option commit reaches the `.d`, minted `@N` appends to the
  `.tra`, no emit swallow, no echo loop, multi-invocation stability).
- `sample-model.ts` - a small hand-built `DialogModel` (also used by the unit tests).
- `real-model.ts` - frozen output of `modelFromD` on a real `.d` fixture; regenerate with
  `gen-real-model.ts` when the fixture or adapter changes.

The pure render-path logic (`modelToFlow`, `layoutFlow`) is unit-tested under `client/test/`
(`dialog-model-to-flow.test.ts`, `dialog-layout.test.ts`) and gates in `pnpm test`; this
harness covers the browser-only wiring those cannot reach.
