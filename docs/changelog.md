# Changelog

## Unreleased

- Binary editor: fixed armor stat fields (AC, damage resistance, damage threshold, perk) being annotated as signed `int32` in the field-detail view; they are unsigned in the file format and now display as `uint32`.
- **BREAKING (`@bgforge/binary` library, `.pro.json` snapshots):** the canonical document shapes for armor and drug PROs have been flattened to match the wire format.
    - `armorStats`: replaced `damageResistance: { normal, laser, ... }` and `damageThreshold: { normal, ... }` nested groups with flat `drNormal`..`drExplosion` and `dtNormal`..`dtExplosion` fields.
    - `drugStats`: replaced `affectedStats: { stat0..stat2 }`, `instantEffect: { amount0..amount2 }`, `delayedEffect1: { duration, amount0..amount2 }`, `delayedEffect2: { ... }`, `addiction: { rate, effect, onset }` nested groups with flat `stat0..stat2`, `amount{0,1,2}Instant`, `duration1`, `amount{0,1,2}Delayed1`, `duration2`, `amount{0,1,2}Delayed2`, `addictionRate`, `addictionEffect`, `addictionOnset` fields.
    - Anyone with saved `.pro.json` snapshots for armor or drug PROs needs to regenerate them (re-save in the binary editor, or pipe the file through `fgbin` again).
- `fgbin` and the binary editor now reject Fallout `.map` files whose header reports more global or local variables than fit in the remaining file, instead of attempting a multi-billion-iteration read.
- `fgtp --help` now lists the `--save-and-check` flag (write the transpiled output and re-verify it on a second pass), bringing the help text in line with the actual CLI surface.
- Minimum supported Node.js version raised from 18 to 20. Node 18 reached end-of-life in April 2025; Node 20 is the current LTS minimum. Affects users installing `@bgforge/mls-server` or `@bgforge/transpile` standalone via npm.
- `.bgforge.yml` `directory` values that resolve outside the workspace root (via an absolute path elsewhere on disk, or via `..` segments) are now ignored with a warning logged to the BGforge MLS output channel. Translation lookup still works for workspace-internal `directory` values.
- Project-loading progress spinner now self-resolves after 60 seconds instead of hanging indefinitely if the server never reports project load completion.
- Long-running Fallout SSL and WeiDU compilations are now aborted on extension shutdown, rather than holding tmp-file locks until their own timeout.
- Provider initialization failures now surface a user-visible error naming the affected language, instead of silently producing an empty language.
- TSSL CLI diagnostics are now written to stderr (matching TBAF and TD), so piping `fgtp file.tssl` no longer contaminates stdout with progress messages.
- Webview panels (binary editor, dialog tree preview) now enforce a strict per-render Content-Security-Policy with nonced styles and scripts; the dialog-tree panel's allowed resource roots are narrowed to the directories it actually loads from.
- `@bgforge/mls-server`: `quick-lru` is now correctly declared as a runtime dependency (previously misclassified as devDependency, which would cause module-not-found errors for downstream npm consumers).
- New library `@bgforge/transpile` published on npm. It exposes the TSSL/TBAF/TD transpilers (`tssl`, `tbaf`, `td` named exports plus an extension-dispatching `transpile()` helper) for use as a library in custom build pipelines, and ships the `fgtp` CLI as a `bin` entry. Replaces the previous standalone `@bgforge/fgtp` package.
- New library `@bgforge/format` published on npm. It exposes formatters for all supported file types (Fallout SSL, WeiDU BAF/D/TP2/TRA, Fallout MSG, Infinity Engine 2DA, and scripts.lst) for use as a library in custom build pipelines, and ships the `fgfmt` CLI as a `bin` entry.
- New library `@bgforge/binary` published on npm. It exposes parsers for Fallout `.pro` and `.map` binary files with round-trip JSON snapshot helpers for use as a library in custom build pipelines, and ships the `fgbin` CLI as a `bin` entry.
- TSSL/TBAF/TD transpile success notifications now show just the output filename (e.g. `Transpiled to foo.d`), matching the format of compile notifications instead of including the full absolute path.

## 3.7.0 (2026-04-12)

- Document formatting is now available for `.tra`, `.msg`, `.2da`, and `scripts.lst` files.
- 2DA tables have improved highlighting.
- Built-in WeiDU functions have their parameters data structured, enabling better intellisense.

## 3.6.0 (2026-04-09)

- Find references from `.tra` and `.msg` files: cursor on any entry finds all usages across consumer files (`.ssl`, `.baf`, `.d`, `.tp2`, `.tssl`, `.tbaf`, `.td`).
- Fallout SSL: go to definition on `#include` path navigates to the included file.
- `weidu.log`: go to definition on `~mod/path.tp2~` navigates to the corresponding `.tp2` file (case-insensitive path resolution).
- Added syntax highlighting for `weidu.log`.
- Binary editor save and JSON export now clamp out-of-range PRO and MAP values to the nearest supported in-format value instead of writing invalid data.
- Binary editor JSON dump now produces strict canonical JSON.

## 3.5.0 (2026-04-04)

- Binary viewer is now an editor, supporting **Dump to JSON** and **Load from JSON** actions, and `autoDumpJson` setting.
- Added best-effort support for Fallout 2 MAP files in the editor and bin cli.
- Added `bit` type support to JSdoc.

## 3.4.0 (2026-03-26)

### Fallout SSL

- Hovering over engine procedure definitions (e.g. `map_enter_p_proc`, `start`) now shows the built-in engine description. If the procedure has user JSDoc, the engine description is appended after a separator.
- Strings with escape sequences (e.g. `\"` and `\\`) now parse correctly.
- `for` loop update expressions now support compound assignment operators (`+=`, `-=`, `*=`, `/=`), e.g. `for (i := 0; i < 10; i += 2)`.
- `##` token-paste operator is now supported in macro bodies — variable declarations, assignments, and expressions — in addition to procedure names. Fixes parse errors in files that use `##` outside of identifiers.
- Fixed hover not working for procedures defined in header files that contain macros using the `##` token-paste operator (e.g. `animate_##type##_to_tile`). The grammar now parses `##` correctly as a context-sensitive operator inside `#define` bodies, preventing a parse error that previously swallowed the rest of the file.
- `##` token-paste operator is now syntax-highlighted as a preprocessor keyword; surrounding identifier segments get function coloring.
- `#include` directives now accept bare identifier paths (without quotes), as used in some real-world scripts.
- `switch` `case` and `default` clauses now accept a `begin ... end` block body (sfall extension), in addition to the standard statement list.
- Macro bodies now allow a top-level assignment without a trailing semicolon.
- Fixed parse errors caused by backslash line-continuation followed by a blank line.
- Fixed parse errors caused by whitespace-only blank lines inside procedure bodies.
- Hover signatures for procedures and macros now show untyped parameters as `var name` and highlight parameter names with `variable.parameter` coloring.
- Fixed rename not working for macro parameters.

### WeiDU

- `ADD_STATE_TRIGGER` now accepts multiple state numbers after the trigger string (e.g. `ADD_STATE_TRIGGER ~file~ N ~trigger~ N1 N2 N3`), matching the WeiDU spec.

### Formatter

- The formatter CLI now exits with a non-zero status when the input file contains syntax errors, instead of silently producing output from a broken AST.

### Transpilers

- Fixed notification popups (success/error messages) appearing on every keystroke or save during automatic validation for TSSL, TBAF, and TD transpilers. Notifications now only appear when compile is triggered manually.

### TSSL

- `map()` with no arguments now transpiles to `{}` (empty map literal).
- Fixed a crash when the source contains empty statements (bare semicolons).

## 3.3.1 (2026-03-22)

Fix standalone LSP package publish after repository rename.

## 3.3.0

- New: semantic highlighting
    - Fallout SSL: function, macro parameters.
    - WeiDU TP2: function parameters, loop vars, JSdoc types.
- WeiDU: translation references (`@NNN`) styling unified across BAF, D, and TP2.
- Textmate highlighting: Fallout SSL, WeiDU TP2, BAF, D are updated to match intellisense data more closely.
- Fallout SSL: header macros definitions are no longer shipped with LSP.
- WeiDU TP2: ielib symbols data is no longer shipped with LSP.

## 3.2.1 (2026-03-19)

### Formatter Improvements

**WeiDU D formatter:**

- Fixed comment preservation:
    - Decorative separator comments (`//////`) no longer have space added.
    - Block comments preserve all internal whitespace exactly.
    - Trailing comments stay on the same line as code.
- Fixed multi-line tilde string formatting in transitions.
- Fixed blank line preservation between comments and code blocks.

**WeiDU TP2:**

- Fixed formatter mangling of string literals containing newlines.
- Fixed `INCLUDE` failing to parse when multiple files are provided.

### Data Updates

**Infinity Engine:**

- BAF trigger definitions are now pulled from IESDP.

**Fallout (sfall):**

- Updated sfall data.

### Core Improvements

- Fixed completion detail and hover for overloaded symbol names.
- Unified provider indexing and scoped workspace symbols by language.

## 3.2.0 (2026-03-16)

Compile/validate:

- Fixed possible race conditions.
- Fixed transpile chains not awaiting external compiler.
- Improved compilation reliability: debouncing, async I/O, guaranteed temp file cleanup.
- Fixed diagnostics silently cleared when external compiler fails with unparseable output.
- In-flight compiler processes are now cancelled when a new compilation starts for the same file.
- `validateOnSave`, `validateOnType` toggles are consolidated into a single `validate` enum.

Fallout SSL

- Added find references.
- Fixed rename for symbols used inside macros.
- `.tmp.ssl` is now hidden by default from VScode explorer.
- Fixed SSL compiler attempting external compile after user declines built-in fallback prompt.
- Fixed temp file leak when `writeFile` fails before compilation.
- Document symbols now show procedure parameters and local variables as children in the outline view.
- Outline icons: parameterized macros now use Method icon instead of Function.
- Variadic macros tooltips are more function-line now.
- Fixed top-level var rename.
- Added `falloutSSL.compileOnValidate` toggle which allows to control whether each validation is automatically saved to the output path.
- Removed the separate "use built-in compiler" toggle, use empty `falloutSSL.compilePath` instead.

WeiDU

- Added actionable error message when WeiDU binary is not found.
- Simplified diagnostics: a few detail lines instead of full stdout.
- Fixed concurrent compilations of same-extension files overwriting shared temp file.
- Added find references for TP2 and D files.
- Document symbols now show function/macro body variables and parameters as children in the outline view.
- Outline icons: macros use Method icon, arrays use Array icon, UPPER_first_word variables use Constant icon.
- Variables now appear as top-level symbols.

## 3.1.3 (2026-03-08)

- Really really fixed npm publish failing in CI.

## 3.1.2 (2026-03-08)

- Really fixed npm publish failing in CI.

## 3.1.1 (2026-03-08)

- Fixed npm publish failing in CI.

## 3.1.0 (2026-03-08)

Fallout SSL

- Added workspace symbols (Ctrl+T search across all workspace files).
- Added workspace-level rename (procedures, macros, exports across files).
- Added `list` and `map` types, renamed `ObjPtr` to `ObjectPtr`.
- Fixed completions getting duplicated in `.h` header files.
- Fixed completion icons for function-like macros.
- Formatting now validates output like other languages.

WeiDU TP2

- Added workspace symbols (Ctrl+T search across all workspace files).
- Added details (parameters) to document outline symbols.
- Fixed spurious variable completions.
- Fixed completion icons for constant-like variables.
- Fixed snippets inserting an extra blank line after expansion.
- Relaxed overzealous completion filters.

WeiDU BAF

- Disabled completions inside comments.

WeiDU D

- Added JSDoc support, hover, and rename.

Transpilers

- Fixed transpile CLI missing BAF fixups.
- Fixed transpile CLI missing `obj`/`tra`/`tlk` expansion.

General

- Added Geany editor support.
- Allowed `.cmd`/`.bat` files in compile path setting.
- Fixed crash when compiling with external sslc on Windows.
- Updated editor setup documentation.

## 3.0.1 (2026-03-06)

- Bumped sslc to 2026-02-07 release.
- Added tree-sitter highlights.scm for Neovim and other editors.
- Added tra and msg grammars for other editors.
- Added setup guides for Neovim, Helix, Emacs, Sublime Text, JetBrains, Zed, Kate, Notepad++.
- Removed single quote from TP2 autoclosing pairs.
- Prepared standalone LSP server for npm publishing.

## 3.0.0 (2026-03-05)

Fallout SSL

- Added tree-sitter grammar.
- New features: rename, file symbols, autoformat, JSdoc for variables, folding ranges.
- Intellisense now uses function definitions as the source of truth, and JSdoc only does enrichment.
- Multiple base low-level functions added.
- Function callgraph is replaced with Dialog Preview.

WeiDU TP2

- Added tree-sitter grammar.
- New features: rename, file symbols, autoformat, JSdoc and definition for variables, extended JSdoc format for functions, folding ranges.
- Multiple insert snippets.
- Completion filtering, in particular in function parameter list context, but others too.
- Added WeiDU v251 keywords.
- Variables now can be typed, and receive different coloring based on name.

WeiDU BAF

- Added tree-sitter grammar.
- New features: autoformat, folding ranges.

WeiDU D

- Added tree-sitter grammar.
- New features: go to definition (label), file symbols, autoformat, folding ranges.

Transpilers

- 2 new transpilers added: TSSL and TD.
- TBAF (and TD) now support enums and point tuples.
- TD has a builtin D-like runtime.

General

- Refactored tooltip formatting (unified look across providers).
- SSL, D, TSSL and TD receive Dialog Preview feature.
- Added a binary viewer. Currently supports only Fallout .pro files.
- In all languages with translations, using go to definition on a tra/msg reference jumps to that reference.
- Added completion for tags in JSdoc.
- File icons for .slb, .2da, .lst, worldmap.txt, weidu-ssl.
- .tpl support dropped.

## 2.3.0

Add built-in .ssl compiler.

## 2.2.6

Cosmetic: fixed double dot in tmp filenames, introduced in 2.2.5.

## 2.2.5

- Added spread expression to TBAF.
- When parsing, intermediate D is saved with `.d` extension now.
- TBAF no longer tries to substitite negated trigger functions nor open negated parentheses.
- TBAF now properly unrolls loops with variable boundaries.

## 2.2.4

Fixed expansion of parentheses with OR inside in TBAF.

## 2.2.3

Fixed death var string passing to TBAF `$obj`.

## 2.2.2

Allowed to pass any string to TBAF `$obj`.

## 2.2.1

Added a no-edit warning to `BAF` files generated from `TBAF`.

## 2.2.0

- Fallout
    - Sfall data updated to 4.4.5.1.
- IE
    - IESDP data update as of 2025.01.26.
    - Initial TBAF support.
    - BAF parse now works with [older weidu](https://github.com/WeiDUorg/weidu/issues/237).

## 2.1.11

- Fallout
    - Sfall data updated to 4.4.4.
    - Added `variable` to completion.
    - Tooltips now show function arguments, even if they are missing from JSdoc comment.
- IE
    - IESDP data update as of 2024.08.15.

## 2.1.10

- Fallout
    - Updated `is_success`, `is_critical` description ([related](https://github.com/BGforgeNet/Fallout2_Unofficial_Patch/issues/112)).
    - Sfall data updated to 4.4.1.
    - `unsigned int` renamed to `uint` in tooltips.
    - Updated `start_gdialog` description to include usage with sfall.
    - Macros are marked as such in tooltips.
    - Fixed some macros erroneously recognized as constants.
    - Enabled displaying return type for macro as specified in its docstring.
- IE
    - IESDP data update as of 2024.04.21.

## 2.1.9

Added `CompOption` to translation and inlay hints, also `GMessage/NMessage/BMessage` to inlay.

## 2.1.8

Fixed some hovers and signatures missing after opening their source files.

## 2.1.7

Fixed compile/parse issue introduced in 2.1.6.

## 2.1.6

- Fallout
    - Sfall data update as of 4.4.2.
- IE
    - Added `WEIDU_EXECUTABLE`, `ADD_PROJECTILE` to intellisense.
    - Added `STR_CMP`, `WRITE_ASCIIL`, additional value operators to highlighting.
    - Variables in trarefs are also highlighted now.
    - IESDP data update as of 2024.02.24.

## 2.1.5

- Added translation hints to `GMessage/NMessage/BMessage`.
- Fixed highlighting for tra references with negative numbers.
- Fixed extension crash when opening a single file instead of a directory.

## 2.1.4

- Fixed wrong paths being reported by diagnostics on Linux/wine.
- Fixed compile.exe reported problems not clearing on Windows due to incorrect paths.

## 2.1.3

[Fixed](https://github.com/BGforgeNet/BGforge-MLS/issues/61) diagnostics being attributed to the wrong file when there are errors in included files.

## 2.1.2

Updated IElib, now including cleric scrolls.

## 2.1.1

Fixed `TEXT_SPRINT` imports from IElib.

## 2.1.0

- Support for Fallout `worldmap.txt`.
- Prettier `GAME_IS/INCLUDES` doc.

## 2.0.6

- Prettified `GAME_IS`, `GAME_INCLUDES` doc.
- Fixed `set_critter_stat` doc.
- Added begin-end snippet in TP2.
- Disabled outdent on `END` in TP2.
- IElib `ITEMTYPE_` constants renamed to `ITEM_TYPE_`.

## 2.0.5

- Fixed missing hovers for defines from the same file.
- Added "offset" to offset tooltips, and their values too.
- Prettified doc for `GET_OFFSET_ARRAY`, `GET_OFFSET_ARRAY2`.
- Colored `AS` ans `USING` back as keywords in TP2.
- STO v1 and item types are now imported from IESDP.

## 2.0.4

Fixed SSL compile when source or destination directory contains spaces.

## 2.0.3

Fixed patch flow control keyword color for tp2.

## 2.0.2

- SSL constant defines colored as constants.
- `scripts.lst` highlighting.
- Local functions definitions no longer override builtin language functions for SSL.
- Removed single quotes from SSL autoclose, as they don't work for quoting.
- Prettier builtin functions descriptions for SSL.

## 2.0.1

Fixed crash on mod directory open on Windows.

## 2.0.0

- New feature: docstrings.
- Settings reworked, now with pretty names and sfall compile path is separate from options.
- RPU defines are no longer loaded statically, instead all headers are searched at runtime.
- Completion and hover items show source file.
- New feature: go to definition.
- New feature: functions can be marked as deprecated.
- New features: validate on save, validate on change.
- Prettier completion items (less plaintext, more markdown).
- Completion and hovers for WeiDU `D` format.
- Added file icons for `TRA`, `MSG`, `SSL` files.
- New feature: hover tooltips for `TRA`/`MSG` references.
- New feature: header support for WeiDU (`TPH`). Completion, hover, go to definition.
- Improved `TP2` tooltip highlighting.
- New feature: inlay hints for `TRA`/`MSG` references.
- For `TP2`, `READ_*` and `WRITE_*` patch highlitht style aligned with corresponding IElib types' styles.
- In `TP2`, action and patch flow control tokens switched to native action/patch highlight style.
- New feature: callgraph for `SSL`.
- Various smaller changes, mostly styling.
- Minimal VScode version is 1.69.2.

## 1.16.3

- IE
    - Only include BG2/EE `spell.ids` defines from IElib, as some of IWD spells clash with those.
    - Added missing `STRING_COMPARE_REGEXP` to syntax highlighting.
- Fallout
    - Update headers to RPU v26, sfall v4.3.3.1.
    - Note Smooth Talker for `giQ_Option` tooltip.

## 1.16.2

- IE
    - Added missing "GTIMES.IDS" and "LOCAL_SET/LOCAL_TEXT_SPRINT/LOCAL_SPRINT".
    - Added some missing WeiDU control keywords,

## 1.16.1

- Fallout
    - Added `start_gialog`/`start_gdialog` synonyms.
    - Added notes about visibility and `move_to` during fallout [game load](https://github.com/sfall-team/sfall/issues/380).
- IE
    - Fixed typo in `CLERIC_FAVOR_OR_ILMATER`.
    - Added some missing `tp2-vars` to autocompletion.
    - Added one missing spell to `spell-ids-iwdee`.
    - Allow more char types in weidu var names.
    - Added some missing STO-related functions.

## 1.16.0

- Fallout
    - Updated [RPU](https://github.com/BGforgeNet/Fallout2_Restoration_Project) defines to v21, [sfall](https://github.com/phobos2077/sfall) to 4.3.0.2.
    - Clarified `set_obj_visibility` description.
- IE
    - Updated [IESDP](https://gibberlings3.github.io/iesdp/) and [IElib](https://ielib.bgforge.net/) defines.
    - Added custom [icon theme](https://github.com/BGforgeNet/BGforge-MLS/blob/master/docs/icon-theme.md).
    - Added rudimentary gcc [preprocessing](https://forums.bgforge.net/viewtopic.php?f=35&t=334) support.

## 1.15.3

- Fallout
    - Updated data from upstream.
    - Added more preprocessor directives: highlighting, completion, indentation.
    - Moved comments higher in highlighting for better performance.
- IE
    - Updated data from upstream.
    - Fixed highlighting for var names with `-`.

## 1.15.2

- Fallout
    - Fixed displaying source files for dynamically loaded defines.
- IE
    - WeiDU is now searched in system PATH by default.

## 1.15.1

- IE
    - Added `LAF`, `LPM`, `LPF` and `LAM` to tooltips.
    - For `LAUNCH_ACTION_MACRO`, `LAUNCH_PATCH_MACRO` set proper action/patch color.
    - Fixed color of `DEFINE_ACTION_MACRO`, `DEFINE_PATCH_MACRO`. Properly color `DEFINE_ACTION_FUNCTION`, `DEFINE_PATCH_FUNCTION` when `BEGIN` is on the same line.
    - Updated defines from upstream.
- Fallout
    - Updated defines from upstream.

## 1.15.0

- Added basic indentation rules for Fallout SSL, WeiDU BAF and TP2.
- Added IF-THEN block snippet for BAF.

## 1.14.1

Fixed 1.14.0 packaging issue.

## 1.14.0

- IE:
    - Added support for `TPA`, `TPH`, `TPP` `BAF` and `D` parsing with new WeiDU v247.
    - New keywords from WeiDU v247.
    - More details for some WeiDU constants.
    - Updated IESDP defines.
- Fallout:
    - Updated RPU and sfall defines.

## 1.13.0

- General:
    - Added a custom theme to allow futher tailoring of the style.
- IE:
    - Added support for importing file formats from IESDP.
    - Clearly separated actions from patches, coloring them differently.
    - Changed tp2 values to be italic blue to distinguish them from actions.
    - IElib and IESDP constants now display type in tooltip, IElib ones also display value.
    - Known IElib functions are now colored according to their type, even if invocation is wrong.
    - Duplicate constants removed from completion.
- Fallout:
    - Updated RP and sfall defines.

## 1.12.0

- IE:
    - Added weidu's `GET_OFFSET_ARRAY/2` predefined sets to completion.
    - Added support for [IElib](https://ielib.bgforge.net) functions.
    - Fixed IElib's constants coloring inside associative array declarations.

## 1.11.0

- IE:
    - Updated [IElib](https://github.com/BGforgeNet/BGforge-MLS-IElib) and [IESDP](https://iesdp.bgforge.net) defines.
    - Added WeiDU's `REM`.

## 1.10.0

- General:
    - Switched all helper scripts to Ruamel for YAML.
- IE:
    - Added WeiDU's `LOCAL_SET`, `LOCAL_SPRINT`, `WITH`, `DEFAULT`, multuple `SOURCE_*` vars.
    - Fixed `TargetBlock`/`TriggerBlock` highlighting in SSL.
    - Updated [IElib](https://github.com/BGforgeNet/BGforge-MLS-IElib) and [IESDP](https://iesdp.bgforge.net) defines.
    - Fixed error in WeiDU completion formatting, which was breaking some completion items.
- Fallout:
    - Updated sfall and [RPU](https://github.com/BGforgeNet/Fallout2_Restoration_Project) defines.

## 1.9.1

- General:
- Reverted client to `vscode` module to fix missing tooltips.

## 1.9.0

- General:
    - Switched to `@types/vscode` for tests, removed old unused dependencies, bumped minimal VScode version.
- IE:
    - Fixed dashes/quotes in function names breaking highlighting.
    - Fixed dashes in SLB `TARGET` breaking highlighting.
    - Added support for array construct highlighting.
- Fallout:
    - Updated RP defines.

## 1.8.0

- Common:
    - Fixed hovers display/highlight.
- IE:
    - Added `WRITE_ASCIIL`, `WRITE_ASCIIT`, `WRITE_ASCIIE`, `BUT_ONLY`, `STR_EQ`, `STR_CMP`, `R_B_B`, `ON_MISMATCH` aliases.
    - Added text defines, in particular spell names.
    - Added support for partial syntax: inlined BAF scripts.
    - Added `kit.ids` defines.
    - Added some hidden script actions.
    - Added completion for BAF actions (BG2/EE only).
    - Fixed shorted highlighting keys overriding longer ones in some cases.
    - Fixed highlighting of unbalanced `%`s for [IElib](https://github.com/BGforgeNet/BGforge-MLS-IElib) defines.
- Fallout:
    - Loaded aliased defines from RP.
    - Allowed empty arg list for ssl function invocation.
    - Allowed whitespace between function name and parentheses.
    - Updated sfall defines to version 4.2.3+develop.

## 1.7.0

- IE:
    - Added colorization for [IElib](https://github.com/BGforgeNet/BGforge-MLS-IElib) defines.
- Fallout:
    - Fixed colorization bug when procedure begins on the next line.

## 1.6.0

- IE:
    - More symbolic references.
    - Added support for hexadecimal numbers in BAF and D files.
    - Removed '(?i)' from triggers: everything is case sensitive now.
    - Colored ELSE and THIS.
      Fallout:
    - Updated definitions: sfall 4.2.2, RPU 12.

## 1.5.4

- IE:
    - Fixed highlighting for double variable references.

## 1.5.3

- IE:
    - Added highlighting for double variable references (`EVAL ~%%my%_var%~`).

## 1.5.2

- IE:
    - Really really fixed macro invocation highlighting.

## 1.5.1

- IE:
    - Really fixed macro invocation highlighting.

## 1.5.0

- IE:
    - Added support for Sword Coast Stratagems Scripting Language.
    - Fixed macro invocation highlighting.
    - Added vars highlighting in tra strings.
    - Added many more IDS tokens.

## 1.4.0

- IE:
    - Added syntax highlighting for IWD:EE `spell.ids` tokens.
    - Fixed `PLAYER1-PLAYER6` highlighing in `tra` files.

## 1.3.0

- IE:
    - Added `2da` syntax highlighting.

## 1.2.0

- WeiDU:
    - Added `tra` syntax highlighting.
- Fallout:
    - Added `msg` syntax highlighting.
    - Added missing `ifndef`, `endif`, `%`.

## 1.1.0

- WeiDU:
    - Fixed line breaks in `CLONE_EFFECT`.
    - Fixed highlighting in `LAF`/`LPF` invocation when strings contain keywords or names contain variables.
    - Fixed variable highlighing in function definition.
    - Added missing `ALTER_ITEM_HEADER`, `INNER_PATCH`.
- Fallout SSL:
    - Added highlighting for defines (constants, variables, defines with variables, procedures) from [sfall](https://github.com/phobos2077/sfall/) and [RPU](https://github.com/BGforgeNet/Fallout2_Restoration_Project) headers.
    - Added support for automatic update of defines sfall/RPU headers.
    - Added LVARs highlighting.
    - Added descriptions for builtin procedures (`map_enter_p_proc`, etc).
    - Fixed `obj_being_used_with` description.

## 1.0.9

- FSSL: added support for more data types and standartized display of functions without args (strip parhenthesis).
- Last built-in WeiDU macros added.
- Allow to compile files uppercased names.

## 1.0.8

- Added more WeiDU macros.
- Added newlines to WeiDU macro docs.
- Updated Fallout module with latest functions and hooks.
- Fixed import typo in server.

## 1.0.7

- Added WeiDU patch and macro functions.
- Fixed minor typos.

## 1.0.6

- Fixed detail missing from weidu completion.

## 1.0.5

- More IE constants supported.

## 1.0.4

- Fixed comment color in weidu function invocation.
- Fixed `EVAL` color in weidu function invocation.

## 1.0.3

- Fixed console error spam for languages with missing signatures.
- Set weidu IDS to constant scope.

## 1.0.2

- Added IN as a keyword, fix color of numbers inside parenthesis without space.
- Added THEN as a keyword, and ADD_STORE_ITEM flags.

## 1.0.1

- Fixed `#NUM` notation, variable highlight in `d` and `baf`, and some missing highlight in function definitions.

## 1.0.0

- Initial release.
