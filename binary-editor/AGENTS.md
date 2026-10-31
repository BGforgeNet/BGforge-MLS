# Binary editor

The framework-free editor core - session, model, layout and protocol dispatch - shipped inlined into the client's
binary-editor worker.

UI conventions for both layers, plus the reasoning behind them:
[docs/binary-editor-ui.md](../docs/binary-editor-ui.md). Per-layer rules:
`client/src/binary-editor/webview/AGENTS.md` (render), `binary/src/AGENTS.md` (schema).
Screenshot harness: `binary-editor/test/harness/README.md`.

## Reviewing a rendered screenshot

Render first - never reason about the cascade blind, and never fall back to a sketch without checking that a
driver exists.

What to check, and the intentional patterns **not to flag** with the reason for each:
[docs/binary-editor-ui.md](../docs/binary-editor-ui.md) (Reviewing a rendered screenshot).

Harness artifacts that are also not defects: `binary-editor/test/harness/README.md` (Reading the screenshots).
