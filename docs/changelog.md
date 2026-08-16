# Changelog

## Unreleased

### Fallout SSL

- Compiled `.int` scripts open as editable SSL. Opening one from the explorer shows its decompiled source
  with the usual highlighting, outline and search - no command to run - and saving compiles it back over
  the `.int` in place. Saving a script you have not edited reproduces it byte for byte. Local and argument
  names are not stored in a compiled script, so those are generated, and constants, macros and comments
  were resolved away before it was compiled. A script that cannot be structured back into source opens as
  a commented instruction listing instead, and that cannot be saved.
- A second compiler is available through `bgforge.falloutSSL.compiler`. Setting it to `built-in` compiles
  the text in the editor - including edits not yet saved - without starting a process or writing a
  temporary file beside the script. A script it cannot parse is reported as a syntax error at the line it
  gave up on, and no `.int` is written. An engine function called with the wrong number of arguments is
  refused for the same reason the other compiler refuses it: the opcode takes a fixed number of values off
  the stack whatever the call pushed, so a miscounted call leaves everything after it reading the wrong
  values.
- The `built-in` compiler reads `bgforge.falloutSSL.compileOptions` and optimises. `-O1` drops procedures
  and variables nothing references; `-O2` additionally folds constants, removes unreachable code and dead
  stores, and reclaims unused slots, producing the same bytes as the WebAssembly compiler at both levels. `-s`
  compiles `and`/`or` as short-circuit operators. `-O3` is honoured as `-O2`: the WebAssembly compiler's own
  source marks that level's extra passes as known to break code. A `#pragma sce` anywhere in the source asks
  for the same short-circuit evaluation as `-s`. `-I` and `-m` in that setting are honoured
  too, so a header directory or a macro defined there applies to both compilers. `-b` is reported as an
  error rather than ignored: it decides which words are keywords, so compiling without it would build the
  script against a different language than the setting asked for.
- A failed compile reports everything it found wrong, instead of stopping at the first problem. A script
  with four syntax errors, or a header with three bad directives, is now one compile rather than four. A
  name that is misspelled and then used twenty times is reported once, at its first use.
- The `built-in` compiler warns about three things that compile but rarely mean what they say: an escape
  no table entry covers, where `"C:\path"` quietly loses its backslash; a variable declared twice, where
  the second declaration and its initial value are ignored; and a script with no `start` procedure, which
  the engine has no way into. They are controlled by `-n` in `bgforge.falloutSSL.compileOptions`, which
  that setting's default includes - so removing it from there is what turns them on.
- `set_shader_mode` is documented with the shader it applies to: `set_shader_mode(int ID, int mode)`.
  Hover and completion previously showed it taking the mode alone, which is one argument short of what
  the engine reads.
- Formatting a `foreach` loop no longer drops its `while` guard. The guard is part of the loop's bounds
  test, so losing it changed how many times the loop ran.
- Keywords are read in any casing, as the language itself reads them: `PROCEDURE`, `Procedure` and
  `procedure` are one word to highlighting, completion and compilation. Formatting keeps whichever spelling
  the source used.
- Formatting a `for` loop no longer rewrites `variable i := 0` to `variable i = 0`.
- Procedure modifiers are recognised: `pure`, `inline` and `critical`. `critical` marks a procedure the
  engine runs to completion without interleaving other scripts, and combines with `pure` or `inline` when
  written before them. Highlighting, formatting and compilation all handle them.
- Timed and guarded procedures are recognised: `procedure foo in 5` fires at a set time, and
  `procedure foo when (cond)` runs only while its condition holds. Scheduling a call with
  `call foo in 10` works too.
- Compound assignment into an array or map element - `a[k] += 1`, `a.field *= 2` - compiles. An index with
  a side effect, such as a call, is evaluated once rather than twice.
- `#elif` is supported, and `#error` stops the build with the message the author wrote. `#line` is accepted
  and ignored, so diagnostics keep pointing at the file you can actually open.
- A procedure that is declared and never defined is reported, naming the procedure and the line it was
  declared on.
- Compiling a script in a directory whose name contains a dot (`fo2.rp`, `mymod.v2`) failed with an opaque
  `ErrnoError undefined undefined` and no output file. The WebAssembly compiler cannot build there at all, so
  this is now reported as such, naming the directory and pointing at the `built-in` compiler, which has
  no such limit.
- `bgforge.falloutSSL.headersDirectory` is now honoured when the directory's name contains a dot
  (`fo2.rp`, `headers.v2`). Everything after the last dot was being dropped, so the compiler was pointed at
  a directory that does not exist and the headers were never found.
- Two string literals written next to each other are one string, as the WebAssembly compiler has always read
  them: `"ab" "cd"` is `abcd`, and a long message can be split across lines. Both compilers accept it, and
  the editor no longer marks it as a syntax error.
- Character constants are recognised: `'A'` is 65, with the escapes `'\n'`, `'\t'` and the octal `'\0101'`.
  They were reported as a syntax error, in the editor as well as by the `built-in` compiler.
- `foreach` accepts its `while` guard in every spelling, not only the parenthesised one:
  `foreach v in arr while (cond)` checks the condition before each iteration.
- An array element can be stepped: `a[1]++`, `a.field--` and `a[i + 1]++` compile the way `a[1] += 1`
  already did, evaluating a complex index once.
- `++x` is reported as a syntax error. The language has no prefix increment - only `x++` - so a script
  using it never compiled with the WebAssembly compiler.
- The process-control statements compile: `spawn`, `callstart`, `exec` and `fork` start a child script,
  `wait` suspends, `cancel` and `cancelall` drop pending events, `startcritical` and `endcritical` mark a
  critical section, and `exit`, `detach` and `noop` do what they say. They were reported as syntax errors
  in the editor and refused by the `built-in` compiler; the engine has always run them.
- The `built-in` compiler refuses the same statements the bundled one does: a procedure called without
  `call` (`foo(1);`), a bare variable or expression as a statement, and a parenthesised operand in a global
  initialiser (`variable g := -(7);` - write `((-7))`).
- `variable a[10];` creates its array. The two-argument form `variable a[10, 2]`, which sets the array's
  flags, was read as a plain declaration followed by an unrelated statement; it now parses as one
  declaration. Declaring an array outside a procedure is reported.
- A global initialiser accepts `not` and `bwnot`, not only a negation: `variable g := not 0;` compiles.
- `break` or `continue` written outside a loop is reported at the statement. The language has no such jump
  to make there, so a script using one built and then misbehaved in-game.
- Several engine function signatures were wrong and are corrected: nine had the wrong number of arguments
  (`give_exp_points`, `explosion`, `gSay_End` and six others), `art_anim` and `critter_heal` were shown as
  returning nothing, and `attack_complex`, `critter_set_flee_state` and `has_trait` were missing the closing
  parenthesis of their parameter list. Hover and signature help show all of these.

## 3.13.2

### WeiDU TP2

- No more false syntax errors on `QUICK_MENU`, on the top-level directives `ASK_EVERY_COMPONENT`, `LOAD`,
  `MENU_STYLE`, `MODDER`, `SCRIPT_STYLE` and `UNINSTALL_ORDER`, or on the component flags
  `FORCED_SUBCOMPONENT`, `INSTALL_BY_DEFAULT`, `METADATA` and `NO_LOG_RECORD`. A directive written after
  `README` or another list-taking directive is no longer swallowed by it.
- `SUBCOMPONENT`, `GROUP` and `FORCED_SUBCOMPONENT` accept their optional predicate. `LOAD` and
  `MENU_STYLE` are offered in completion and highlighted.
- `ACTION_PHP_EACH` and `PATCH_PHP_EACH` accept a quoted loop variable, as WeiDU does:
  `ACTION_PHP_EACH arr AS data => ~~ BEGIN`.
- More syntax parses instead of reporting a false error: `COPY_LARGE` with several file pairs,
  `APPEND_COL_OUTER`, `ALTER_TLK_LIST`, `PATCH_BASH_FOR`, `GET_FILE_ARRAY`, `GET_DIRECTORY_ARRAY`,
  `RESOURCE_CONTAINS`, `DECOMPRESS_INTO_FILE`, `COMPRESS_INTO_FILE`, `COMPRESS_INTO_VAR`, the female and
  sound variants of `ACTION_GET_STRREF`, `EVAL` as a standalone patch, `STRING_SET` with male/female text
  and sound references, subtraction written without spaces (`%size%-12`), a string whose whole content is
  `//`, and names that start with a digit (functions, macros, parameters and `TO_UPPER` targets).
- WeiDU's older spellings of a dozen keywords are accepted - `DEFINE_MACRO_ACTION`, `ACTION_INCLUDE`,
  `SUB_COMPONENT`, `I_S_I` and the rest - while completion and highlighting keep offering the canonical
  spelling.

### Formatter

- `QUICK_MENU` groups are laid out one component per line.
- Comments written on the operands of a multi-line condition are no longer dropped, and such a condition is
  no longer rewrapped differently on each reformat.
- A comment between the file pairs of a `COPY` header no longer flips the rest of the header into patch
  layout, which moved content on every reformat.
- No more stray double space before `BEGIN` on `ACTION_BASH_FOR`, `PATCH_BASH_FOR` and `PHP_EACH` loops.

## 3.13.1

### Binary editor

- An item's "Unusable By Kit" checkbox shared by several Enhanced Edition kits now reads "EE kits" and names
  them on hover.
- The "open" button beside a resource field now appears only where the resource can be shown. A creature's
  script slots and dialogue file offered one and opened raw bytes.
- Portraits and sounds now open in VS Code's image and audio previews instead of the text editor, including a
  `.bmp` or `.wav` opened from the IE Game Resources view.
- Item and spell icons, and creature portraits, show the picture beside the value when the game has it.
  Clicking it opens it, replacing the "open" button on those fields.

### Other editors

- Tree-sitter grammars are now published as `bgforge-mls-tree-sitter-grammars.zip`, attached to every release:
  generated parsers, highlight queries and WASM builds, one directory per grammar. The Neovim, Helix, Zed and
  Emacs guides install from it.
- The bundle carries Helix highlight queries under `queries/helix/`, using the capture names Helix themes
  colour. Numbers rendered as plain text there before.
- The Helix guide now puts the queries under the language name (`runtime/queries/fallout-ssl/`), not the
  grammar name.

### Fixes

- A compile that produced only warnings is no longer announced as "Failed to compile". It wrote its output
  file, so reporting a failure contradicted what was on disk; the warnings themselves are unchanged and
  still listed. Applies to Fallout SSL and WeiDU alike.
- An Infinity Engine `.pro` opened as a plain file now says it is an IE projectile instead of reporting an
  unknown object type.
- Fallout SSL name matching now spans files: a procedure declared in a header is found from a script that
  spells it with different capitalisation. Macros keep matching exactly - the preprocessor distinguishes case.
- WeiDU `.d` and `.baf` completion no longer offers keywords inside a comment, nor in `.d` inside dialogue
  text, a filename or any other tilde-quoted string. Trigger and action strings still complete.
- Fallout SSL completion no longer fires inside a string, where message text and `#include` paths were getting
  the whole vocabulary.
- TP2 completion inside a string now offers the variables alone.
- Go to definition now follows a tp2 path whose language is a variable - `USING ~mymod/tra/%LANGUAGE%/x#npc.tra~`
  opens the file in the language directory `mls.translation.directory` names.
- Fallout SSL no longer reports a spurious error on a `#define` whose last statement omits its semicolon, as in
  `#define export_self_obj if (is_night) then export_obj := self_obj`.
- TP2 block comments now nest, matching WeiDU: `/* outer /* inner */ still commented */` is one comment.

## 3.13.0

### Infinity Engine game resources

New IE Game Resources view: point it at a game's `chitin.key` and browse game resources, NI/DLTCEP like. Open from sidebar ("BGforge" item), or command ("BGforge: Open IE game").
It will automatically set `bgforge.weidu.gamePath`. It will also load the game when the view is first shown, if the setting is set and path exists.
When a game is opened, mod file values (IDS, 2DA references, strings from `dialog.tlk`, etc) will resolve against it. When there's no game, BGEE defaults will be used.

### Binary editor

- With a game open, a resref field offers that game's resources of the right type as a searchable list.
  Names the game does not have are still accepted, for files a later install step creates.
- A resref the open game can resolve carries a chip that opens it in its own editor - including numeric
  fields whose value names a file, like an ability's projectile.
- Default IE opcode list includes BGEE opcodes now.
- When an IE game is opened, context-dependent fields reflect its data values.
- The extra parameter, special and power fields an effect record carries now take the name the current opcode
  gives them, the way Parameter 1 and Parameter 2 already did.

### Syntax highlighting

- WeiDU `.d` patch commands now highlight their trigger and action as script rather than as a plain string.
  `ADD_STATE_TRIGGER`, `ADD_TRANS_TRIGGER`, `REPLACE_STATE_TRIGGER`, `REPLACE_TRANS_TRIGGER`,
  `ADD_TRANS_ACTION` and `REPLACE_TRANS_ACTION` colour their tilde-quoted body with the BAF vocabulary, the
  way `IF ~...~` and `DO ~...~` already did.

### Fixes

- Various values such as Save Bonus, THAC0/Damage Bonus and AC and DR Modifier, etc are now correctly
  interpreted as signed for display.
- Unsaved binary-editor and animation-editor changes now survive a window reload or crash, instead of being
  silently lost.
- CRE kits whose identifier is keyed in the high half of the table entry - Barbarian and Wild Mage on the
  Enhanced Editions - can now be named and selected. They were missing from the list entirely.
- Values in the CRE sound-slot grid no longer clip, and the cells line up in columns.
- Opening an Infinity Engine `.pro` from a game no longer fails with "Unknown object type": `.pro` is a
  projectile there and a Fallout prototype here, and the viewer was routing it to the Fallout reader. Formats
  the binary editor cannot read now open in the ordinary editor, unless another editor handles them.
- Undoing a binary-editor dropdown change now updates the dropdown. The document was restored correctly, but
  the control kept showing the value you had just undone until you opened and closed it.
- Pressing an editor shortcut while a binary-editor dropdown has focus - Ctrl+Z, Ctrl+S - no longer pops the
  dropdown list open over the form.
- Typing in a binary-editor dropdown now starts a fresh search even after clicking into the value shown. The
  click placed a cursor there, so what you typed was appended to the value and matched nothing.
- Fallout SSL dialog nodes whose procedure and its callers spell the name with different capitalisation are now
  treated as one node, matching the compiler, which ignores case.
- Go to definition, find references and rename now match Fallout SSL names the way the compiler does, ignoring
  case for procedures and variables. Macros keep matching exactly, since the preprocessor that expands them
  distinguishes case.
- Find references on a Fallout SSL procedure no longer lists same-named procedures belonging to other scripts.
  A procedure is local to its own file, but references were collected by name across the whole workspace, and
  since nearly every dialog script defines its own `Node004` the result was mostly unrelated files. Symbols that
  genuinely come from an included header still resolve across files.

## 3.12.0

- New animation viewer/player/converter: Fallout FRM and Infinity Engine BAM files.
  - FR0-5 files are supported, they load together; save only saves to combined FRM.
  - BAMC and BAM E orientation files are also supported.
  - Cross-format save, including PNG (directory), as well as animated PNG.
  - Import from a PNG directory.
  - The only editable option is FPS.

## 3.11.0

### Language features

- Expand Selection (Shift+Alt+Right/Left) now follows the syntax tree in Fallout SSL, WeiDU BAF, D, and TP2, instead of VS Code's word/bracket guesses.
- WeiDU `.d` files now offer BAF trigger/action completion and hover inside embedded `IF`/`DO`/condition strings, and syntax-highlight BAF inside WEIGHT-guarded triggers (`IF WEIGHT #5 ~...~`).
- WeiDU BAF and D completion now include Enhanced Edition IDS constants - allegiance (`NEUTRAL`, `ENEMY`, ...), general type, race, and gender - for trigger/action arguments like `Allegiance(Myself,NEUTRAL)`, highlighted from the same set so completion and coloring agree.
- Fixed: every uppercase IDS constant in WeiDU BAF is now highlighted. Animation and inventory-slot constants were never colored, and others only if present in a hand-maintained list.
- Fixed: code completions no longer pop up inside `//` comments in Fallout SSL, WeiDU BAF, D, and TP2.
- Fixed: WeiDU BAF coordinates mixing signs or variables (`ScreenShake([4.-4],20)`) or a plain pair (`MoveToPoint([10.10])`) are now read as points instead of reporting a syntax error or being read as an object reference; they are told apart from object specifiers by their numeric components.
- WeiDU BAF object specifiers and points (`[ENEMY.0.0.MAGE]`, `[10.10]`) now color their brackets and dots separately from their contents, each component keeping its own color. Tree-sitter editors (Neovim, Helix, Zed, Emacs) previously colored them as one flat blob.
- WeiDU TP2 file paths in `COPY`/`COMPILE`/`INCLUDE` are now Ctrl+Clickable: Go to Definition opens the referenced file in the matching editor, including `%MOD_FOLDER%`/directory-variable paths and inline `<<<<<<<< ... >>>>>>>>` blocks. Ambiguous or non-file targets now do nothing rather than jumping to an unrelated same-named function.
- Fixed: Ctrl+Click / F12 on a Fallout SSL `#include` no longer jumps to an unrelated procedure or macro sharing the filename when the header can't be found.
- Fixed: hovering a file path in a WeiDU `COPY`/`COMPILE`/`INCLUDE` or Fallout SSL `#include` no longer shows an unrelated function's documentation.
- WeiDU TP2 `DEFINE_DIMORPHIC_FUNCTION` is now recognized instead of misread as broken syntax: Go to Definition, completion, folding, and formatting all work from `LAF` and `LPF` launches.
- WeiDU TP2 now supports Call Hierarchy (Shift+Alt+H) on `DEFINE_*_FUNCTION`/`DEFINE_*_MACRO` definitions and their `LAF`/`LPF`/`LAM`/`LPM` launches, resolved across the workspace's `.tp2`/`.tph`/`.tpa` files.
- Fallout SSL now supports Call Hierarchy (Shift+Alt+H) on procedures and code macros, following every call form - `call`, expression-form calls, `@proc` references, and dialog-option macro target nodes - so on a dialog script the hierarchy follows the conversation flow.

### Translations

- Translation references to a missing string are now flagged in the Problems panel: an `@N` reference or a message-function call (`mstr(N)`, `NOption(N)`, ...) whose number has no entry in the resolved `.tra`/`.msg` gets an information-level squiggle. Files with no resolved translation are never marked. Inlay hints now show only resolved previews, no longer the inline "no such string" note.
- Fixed: message-reference features no longer mis-read a function whose name ends in a known one - `g_mstr(20000)` is no longer treated as `mstr(20000)`; only whole-word names match.
- `.tra`/`.msg` files now have an Outline, one entry per `@N` / `{N}` string with a text preview, with foldable multiline entries.
- Fixed: valid `.tra` entries no longer report a false syntax error for sound references containing a variable, space, or `#`; separate male/female sound references; or `%text%`-delimited strings.

### Binary editor

- Item, spell, and effect fields (ITM/SPL/EFF and CRE-embedded effects) now show their IESDP documentation in the tooltip, with a `?` marker linking to the full IESDP page for longer write-ups.
- CRE inventory slots holding an item now link the slot label to that item's entry in the Items section.
- Numeric fields now show their valid range in the tooltip and outline the field with a warning while the value is out of range, across form, grid, and matrix layouts.

### Dialog editor

- WeiDU `.d` trigger, condition, and action fields are now syntax-highlighted live as you edit, instead of flat monochrome text.
- Fallout SSL condition fields are now syntax-highlighted live, matching the SSL text editor.
- `.td` and `.tssl` condition and trigger fields now color as TypeScript (a `.td` action field stays WeiDU-colored), instead of the ill-fitting WeiDU/SSL rules.
- The find bar has a new Code toggle to search node triggers, choice conditions, and actions in addition to dialogue text.
- Fixed: editing the source of an open dialog no longer freezes the tree view on a transient parse error.

### Snippets

- New WeiDU `.d` snippets: state blocks, replies, CHAIN, INTERJECT_COPY_TRANS, APPEND, and EXTEND_BOTTOM.

## 3.10.1

### Dialog editor

- New interactive Dialog Editor for D, TD, SSL, TSSL dialogue.

### Diagnostics

- New `bgforge.diagnostics` setting (on by default): instant syntax-error reporting for all parsed languages (Fallout SSL and MSG, WeiDU BAF, D, TP2, TRA), alongside compiler diagnostics.

### Binary editor

- Read-only fields are now enforced on save, not only disabled in the interface, and show a tooltip explaining why.
- Fixed: a size-shrinking CRE edit could corrupt an empty section's offset, producing a file that failed to reopen.

### Translations

- `.tra`/`.msg` files are now read as UTF-8 first, falling back to windows-1252 for older files that predate UTF-8 - accented and other special characters in `@N` text now display correctly instead of being mangled.
- Editing an open `.tra`/`.msg` file now refreshes the `@N` inlay hint previews in other open files immediately, instead of waiting for their own next edit.
- `.msg` comments must now be marked (`#`, `//`, or `/* */`); unmarked trailing text is a syntax error.

### Requirements

- Minimum supported VS Code is now 1.91 (was 1.73).

### WeiDU

- Added parsing and highlighting for more WeiDU constructs: TP2 `REQUIRE_FILE` / `FORBID_FILE` / `FORBID_PREDICATE` component flags, `EXTEND_TOP` / `EXTEND_BOTTOM ... USING`, and `REMOVE_CRE_ITEMS`; D `CHAIN3`, `%var%`-interpolated names, hyphenated state labels, `ALTER_TRANS` bareword `ACTION`, and trailing `IF`/`UNLESS` after `ADD_TRANS_ACTION`.
- Fixed: in TP2 hover tooltips, `buffString` and `ascString` parameter names were not highlighted because of an unreachable pattern branch.
- Fixed: dropped several phantom TP2 keywords the grammar never matched, and corrected highlighting of the real ones.
- Fixed: the WeiDU D formatter was not idempotent when a `~string~` immediately followed a keyword.

### Transpilers

- Built-in transpiler no longer relies on system Node.
- Fixed: the TD loop unroller silently dropped all but the first variable of a multi-variable `for` initializer; it now reports an error.

### Performance

- Fixed: on large mod workspaces the language server could use excessive memory while indexing at startup. It now skips `node_modules` and dotfile directories and limits how many files it reads at once.
- Fixed: startup indexing of files that may reference `@N` translation strings read the whole workspace synchronously with no concurrency limit; it's now read asynchronously with the same bounded concurrency as the rest of the startup scan.

### Data

- Refreshed Infinity Engine BAF documentation from IESDP (2026-07-11).

## 3.9.1

### Binary editor

- Fixed: dropdown values and wide numeric fields were clipped in some views; they now size to fit.
- CRE sound slots now lay out 20 per column.

## 3.9.0

### Binary editor

- The editor is greatly expanded, now it supports full operation range; interface composed to reflect underlying structures.

### Icons

- Added file icons for the binary formats: Fallout `.pro` and `.map`, and Infinity Engine `.itm`, `.spl`, `.eff`, and `.cre`.
- Fallout proto files additionally get a per-type icon based on their `proto/<type>/` folder: item, critter, scenery, wall, tile, and misc. A `.pro` outside the standard layout falls back to the generic crate icon.
- The text-language file icons (`.ssl`, `.msg`, `.tp2`/`.tpa`/`.tph`/`.tpp`, `.baf`, `.tra`, `.slb`, `.2da`, and `worldmap.txt`) now display under any active file icon theme, not only the bundled bgforge theme.

### Fallout SSL

- Updated the built-in SSL compiler (sslc) to the 2026-05-23 build.

### WeiDU

- Fixed: on Windows, compiler diagnostics could be attached to the wrong document (or to none) because of a path-separator mismatch.

### Compilation

- Fixed: a compile command that failed unexpectedly (file I/O, process spawn, or an internal error, as opposed to a normal parse diagnostic) gave no feedback; such failures are now surfaced as an error.

### Editors

- The Kate editor bundle now ships file icons.

## 3.8.2

### WeiDU

- Fixed: TP2 built-in intellisense missing (introduced in 3.8.0).

### Data

- Updated Fallout sfall data to v4.5 and refreshed Infinity Engine (BAF) action/trigger documentation from IESDP.

## 3.8.1

- Publishes the npm packages introduced in 3.8.0 - `@bgforge/binary`, `@bgforge/format`, `@bgforge/transpile`, and `@bgforge/mls-server` - which did not reach npm in the 3.8.0 release. The extension is otherwise unchanged from 3.8.0.

## 3.8.0

### NPM packages

3 new npm packages, each including an API and a corresponding cli tool:

- `@bgforge/binary` - binary bindings for IE and Fallout 1/2 formats. CLI is `fgbin`.
- `@bgforge/format` - formatting library for all supported text formats. CLI is `fgfmt`.
- `@bgforge/transpile` - transpiling for TSSL, TBAF, TD. CLI is `fgtp`.

### Binary editor / `fgbin`

- New: support for full Fallout MAP decode with Fallout 2 default and proto-dir override.
- New: support for Infinity Engine `.itm` (item), `.spl` (spell), `.eff` v2 (effect), and `.cre` v1 (creature) files supported alongside Fallout `.pro` / `.map`.
- New: `fgbin --extensions` prints the list of supported binary file extensions, one per line.
- Change: flag-word fields in JSON snapshots are now serialised as a flat sorted array of strings instead of a `{flags, flagsRaw}` wrapper object. Each entry is either a named slug (e.g. `"lightThru"`) or `bit<N>` for set bits the spec doesn't name (e.g. `"bit13"`). Snapshots produced by previous versions need to be re-saved through this version's CLI before consumers on the new shape can read them.
- More robust parse and display.
- MAP truncation / undecodable-region notes in JSON snapshots and the binary editor tree are now labelled `Truncated` instead of the previous `TODO` placeholder.
- Fields inside a MAP's undecodable region now carry a "read-only" hover tooltip explaining why they cannot be edited, and the edit-rejection message describes them as "read-only" rather than "locked" to keep them distinct from the in-game "Locked" object flag.
- `fgbin` rejects oversized binary input files (e.g. a `.map` exceeding 16 MB) with a clear error before allocating a Buffer, so a malformed or accidentally-truncated download cannot trigger a multi-GB allocation.
- The MAP parser caps inventory recursion depth at 2 (game format invariant: items can carry an inventory exactly one level deep). Crafted MAPs that advertise nested-inside-nested inventories now surface as a parse error instead of recursing until the JS stack overflows.

### GitHub Actions

- New: `actions/binary` refreshes / checks JSON snapshots for every format `@bgforge/binary` recognises.

### Transpilers

- TSSL / TBAF / TD transpile success notifications now show just the output filename (e.g. `Transpiled to foo.d`), matching the format of compile notifications instead of including the full absolute path.
- TSSL CLI diagnostics are now written to stderr (matching TBAF and TD), so piping `fgtp file.tssl` no longer contaminates stdout with progress messages.
- `fgtp --help` now lists the `--save-and-check` flag (write the transpiled output and re-verify it on a second pass), bringing the help text in line with the actual CLI surface.

### Formatter

- New: WeiDU TP2 formatter preserves blank lines inside body blocks and keeps `BEGIN` on the header line for macros.
- Change: comment spacing is now normalized consistently across every formatter (Fallout SSL, WeiDU BAF/D/TP2): exactly one space after `//`, a single space inside `/* ... */`, and hand-aligned multi-space indentation after `//` collapsed to one space. All-slash divider lines (`//////`) and `/**` doc-comment openers are preserved verbatim. Previously each format normalized comments differently (some preserved multi-space alignment, some left block-comment spacing untouched).

### Extension / server

- Fallout SSL and WeiDU D hover and signature help now recognise a `/** */` doc comment that is separated from its definition by a blank line or a line comment; previously Fallout SSL required the comment to sit immediately above. This matches TypeScript/JSDoc behaviour.
- WeiDU D find references and rename now include cross-dialog `EXTERN` targets: an `EXTERN` in one dialog that points at a state defined in another dialog of the same file is now found when locating references to (or renaming) that state. Previously such references were missed.
- Minimum supported Node.js version raised to 20.
- Fix: `quick-lru` is now correctly declared as a runtime dependency in `@bgforge/mls-server` (previously misclassified as devDependency, which would cause module-not-found errors for downstream npm consumers).
- New setting `bgforge.debug` enables debug logging in the BGforge MLS output panel. Useful for troubleshooting rename, include resolution, and other issues.
- `.bgforge.yml` `directory` values that resolve outside the workspace root (via an absolute path elsewhere on disk, or via `..` segments) are now ignored with a warning logged to the BGforge MLS output channel. Translation lookup still works for workspace-internal `directory` values.
- Project-loading progress spinner now self-resolves after 60 seconds instead of hanging indefinitely if the server never reports project load completion.
- Long-running Fallout SSL and WeiDU compilations are now aborted on extension shutdown, rather than holding tmp-file locks until their own timeout.
- Provider initialization failures now surface a user-visible error naming the affected language, instead of silently producing an empty language.
- Dialog tree preview now surfaces persistent refresh failures to the user instead of silently failing.

## 3.7.0

- Document formatting is now available for `.tra`, `.msg`, `.2da`, and `scripts.lst` files.
- 2DA tables have improved highlighting.
- Built-in WeiDU functions have their parameters data structured, enabling better intellisense.

## 3.6.0

- Find references from `.tra` and `.msg` files: cursor on any entry finds all usages across consumer files (`.ssl`, `.baf`, `.d`, `.tp2`, `.tssl`, `.tbaf`, `.td`).
- Fallout SSL: go to definition on `#include` path navigates to the included file.
- `weidu.log`: go to definition on `~mod/path.tp2~` navigates to the corresponding `.tp2` file (case-insensitive path resolution).
- Added syntax highlighting for `weidu.log`.
- Binary editor save and JSON export now clamp out-of-range PRO and MAP values to the nearest supported in-format value instead of writing invalid data.
- Binary editor JSON dump now produces strict canonical JSON.

## 3.5.0

- Binary viewer is now an editor, supporting **Dump to JSON** and **Load from JSON** actions, and `autoDumpJson` setting.
- Added best-effort support for Fallout 2 MAP files in the editor and bin cli.
- Added `bit` type support to JSdoc.

## 3.4.0

### Fallout SSL

- Hovering over engine procedure definitions (e.g. `map_enter_p_proc`, `start`) now shows the built-in engine description. If the procedure has user JSDoc, the engine description is appended after a separator.
- Strings with escape sequences (e.g. `\"` and `\\`) now parse correctly.
- `for` loop update expressions now support compound assignment operators (`+=`, `-=`, `*=`, `/=`), e.g. `for (i := 0; i < 10; i += 2)`.
- `##` token-paste operator is now supported in macro bodies - variable declarations, assignments, and expressions - in addition to procedure names. Fixes parse errors in files that use `##` outside of identifiers.
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

## 3.3.1

Fix standalone LSP package publish after repository rename.

## 3.3.0

- New: semantic highlighting
  - Fallout SSL: function, macro parameters.
  - WeiDU TP2: function parameters, loop vars, JSdoc types.
- WeiDU: translation references (`@NNN`) styling unified across BAF, D, and TP2.
- Textmate highlighting: Fallout SSL, WeiDU TP2, BAF, D are updated to match intellisense data more closely.
- Fallout SSL: header macros definitions are no longer shipped with LSP.
- WeiDU TP2: ielib symbols data is no longer shipped with LSP.

## 3.2.1

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

## 3.2.0

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

## 3.1.3

- Really really fixed npm publish failing in CI.

## 3.1.2

- Really fixed npm publish failing in CI.

## 3.1.1

- Fixed npm publish failing in CI.

## 3.1.0

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

## 3.0.1

- Bumped sslc to 2026-02-07 release.
- Added tree-sitter highlights.scm for Neovim and other editors.
- Added tra and msg grammars for other editors.
- Added setup guides for Neovim, Helix, Emacs, Sublime Text, JetBrains, Zed, Kate, Notepad++.
- Removed single quote from TP2 autoclosing pairs.
- Prepared standalone LSP server for npm publishing.

## 3.0.0

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
