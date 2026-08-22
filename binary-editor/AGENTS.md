# Binary-editor UI guidelines

The binary-editor's UI conventions and the rationale behind them, plus the brief for reviewing a rendered
screenshot. The actionable rules are CO-LOCATED with the code that owns them, so a writer gets the relevant
slice at write time:

- **Render layer** (the Svelte webview): [`client/src/binary-editor/webview/AGENTS.md`](../client/src/binary-editor/webview/AGENTS.md) -
  width tiers, column-major fill, uniform spacing, honoring stable-layout reserves, flag rendering, nested-group
  tab strips.
- **Schema layer** (the declarative layout): [`binary/src/AGENTS.md`](../binary/src/AGENTS.md) - one shared
  fragment per record, effect wire-byte-order layout, where to reserve a relabeled column, flag-boxing
  decisions, hex-for-type-IDs, faithful bytes / labels.

This file is the INDEX + the holistic review brief; it does not duplicate the per-layer rules. General UI/UX
principles (size to content, align columns, legible contrast, don't encode meaning in color alone, scan the
whole surface) are assumed - the per-layer files record only what is SPECIFIC to this editor, including which
apparent oddities are intentional so a review doesn't flag them.

## How the layers collaborate: stable layout (worked end-to-end)

The one behavior that spans both layers, and the easiest to get wrong: **editing a field must never shift the
column layout.**

- Value controls use fixed display-width tiers (render), so a longer value never widens its box.
- Labels are static EXCEPT in the effect detail, where the opcode overlay relabels `parameter1` / `parameter2`
  per opcode. ONLY those two fields mutate.
- **Schema side** (`binary/`): `effectBodyRows` emits `labelReserve` on the fields block naming those two
  fields, sized to the common longest label ("Statistic Modifier").
- **Render side** (`client/`): each label column is `max-content` (hugs its own labels); the reserved column is
  floored with `minmax(<reserveCh>ch, max-content)` so it can't jump, while static columns hug. There is NO
  blanket label min-width - a static label like "Opcode" sits tight to its value (the label->value gap must
  read tighter than the inter-column gap, or the value reads as belonging to the next column).
- This replaced an older blanket `labelWidthCh` (one fixed label track for the whole panel, longer labels
  wrapping within it). Guarded by the ITM render harness ("value columns stay put when labels change").

## Reviewing a rendered screenshot

Render with the harness (see `binary-editor/test/harness/README.md`), then check the screenshot against the
per-layer rules above PLUS:

- Read the actual text in every label / header / cell - text clipped to an ellipsis is a width defect to fix,
  not chrome.
- Scan the WHOLE surface (every panel / tab / variant), not just the area changed.
- The intentional patterns named in the per-layer files are NOT defects - do not flag a roomy dropdown, a
  control narrower than its track, a bare-vs-boxed flag difference, a folded Dice / Probability cell, mojibake
  in a raw-byte field, a lone-field PRO panel, or an effect with no semantic panel titles.

### Harness-render artifacts (NOT defects)

- The large empty area at the bottom of some screenshots is the harness's tall capture viewport.
- `shot-primitives.png` is a standalone primitives gallery (raw controls), not the dense field layout - the
  tier sizing does not apply there.
- Screenshots are captured at a reduced device scale (so tall forms stay under the readable image-size limit);
  minor softness is expected.

## File wiring

These paths and the cross-references between them (this index, the two nested `AGENTS.md`/`CLAUDE.md` pairs in
`client/src/binary-editor/webview/` and `binary/src/`, and the root `AGENTS.md` pointer) are pinned by
`scripts/utils/test/ui-guidelines-refs.test.ts` - it fails if a file or reference goes missing or stale.

This file is itself an `AGENTS.md`, with the same `CLAUDE.md` symlink beside it: it lives here rather than in
`docs/` because it is written for whoever is about to change the editor, not for someone using it, and because
`binary-editor/` owns the harness whose screenshots the review brief is about. It auto-loads when you edit the
layout layer or the harness; the two per-layer files auto-load in their own dirs and link back here.
