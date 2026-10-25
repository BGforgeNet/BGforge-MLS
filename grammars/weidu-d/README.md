# tree-sitter-weidu-d

Tree-sitter grammar for WeiDU D (dialog) files.

## D Syntax Reference

D files define Infinity Engine dialogues for WeiDU modding.

### String Types

| Type          | Example          | Status                                          |
| ------------- | ---------------- | ----------------------------------------------- |
| Double quote  | `"text"`         | Supported                                       |
| Tilde         | `~text~`         | Supported                                       |
| Percent       | `%text%`         | Supported as `%var%`; a run stops at whitespace |
| Five tildes   | `~~~~~text~~~~~` | Supported (may hold single tildes)              |
| Concatenation | `"a" ^ "b"`      | Supported in text slots                         |
| Bare word     | `text`           | Supported wherever WeiDU takes a string         |

A bare word or a `%var%` is the same string token as a quoted one, so a trigger, an action or a text may be written
without quotes (a keyword may not). A `%var%` standing for structure, such as a whole transition, is an error. An integer slot (`FLAGS`, the `BEGIN` non-pausing flag, a transition-number list, the
`ADD_TRANS_TRIGGER ... DO` list) takes a number bare, in hex, octal or binary, or quoted (`~-1~`), and nothing else.

### Keywords

Every keyword of WeiDU's D lexer is reserved, so it is never read as a dialog name, a state label or a variable:
`GOTO EXIT` is an error, as in WeiDU. `EXTEND_TOP_REGEXP` and `EXTEND_BOTTOM_REGEXP`, keywords no D construct uses,
are the exception: they read as names here.

### D Actions

#### BEGIN - Create New Dialogue

```d
BEGIN filename [nonPausing]
  state list...
```

#### APPEND - Add States

```d
APPEND [IF_FILE_EXISTS] filename
  state list...
END
```

Also: `APPEND_EARLY`

#### CHAIN - Multi-Speaker Dialogue

```d
CHAIN [IF [WEIGHT #n] ~trigger~ THEN] [IF_FILE_EXISTS] filename label
  ~sayText~ [DO ~action~] = [IF ~condition~ [THEN]] ~next line~ [DO ~action~]
  == otherFile ~otherSpeaker says~
  == anotherFile IF ~condition~ THEN ~conditional text~
  BRANCH ~condition~ BEGIN == speaker ~text~ ... END
END filename stateLabel
```

Each `=` line takes its own condition and action. A line is one text slot, so `~male~ ~female~` is one line with
a female variant; only `=` or `==` starts a new line. A `BRANCH` holds speakers and other `BRANCH`es.

Chain epilogue options: `END file state`, `EXTERN file state`, `COPY_TRANS file state`, `EXIT`

#### INTERJECT - One-Time Interjection

```d
INTERJECT [IF_FILE_EXISTS] filename label globalVar
  == speaker ~interjection text~
END filename stateLabel
```

Also: `INTERJECT_COPY_TRANS [SAFE] [IF_FILE_EXISTS]`, `INTERJECT_COPY_TRANS2`, `INTERJECT_COPY_TRANS3`,
`INTERJECT_COPY_TRANS4` (aliases `I_C_T`, `I_C_T2`, `I_C_T3`, `I_C_T4`), which end in a plain `END`. The global
variable is any string: a bare word, `~quoted~` or `%var%`.

#### EXTEND_TOP / EXTEND_BOTTOM - Add Transitions

```d
EXTEND_TOP filename stateLabel [#position]
  transition list...
END
```

`EXTEND` is an alias for `EXTEND_BOTTOM`. The state list may be empty. A `#position` or `#weight` is one token:
`# 1` is an error, as in WeiDU.

#### States

```d
IF [WEIGHT #n] ~trigger~ [THEN] [BEGIN] stateLabel
  SAY text [= text ...]
  transition list...
END
```

A state missing its `END` is closed where the next state's `IF ~...~ THEN BEGIN` starts, by a zero-width
`implicit_end` node, so the next state keeps its shape; the file is still a syntax error (a missing `END`).

### Transitions

#### Full Form

```d
IF ~trigger~ [THEN] [REPLY text] [DO ~action~] GOTO label
IF ~trigger~ [THEN] [REPLY text] [DO ~action~] EXIT
IF ~trigger~ [THEN] [REPLY text] [DO ~action~] EXTERN file label
```

#### Short Form

```d
+ ~trigger~ + replyText [DO ~action~] + label
++ replyText [DO ~action~] + label
```

#### COPY_TRANS

```d
COPY_TRANS [SAFE] filename stateLabel
COPY_TRANS_LATE [SAFE] filename stateLabel
```

### Transaction Features

- `REPLY text` - Player response text
- `DO ~action~` - Execute action script
- `JOURNAL text` - Add to journal
- `SOLVED_JOURNAL text` - Add to solved section
- `UNSOLVED_JOURNAL text` - Add to unsolved section
- `FLAGS integer` - Binary flags (`4`, `0x4`, `~4~`)

### Text (Player-Visible Strings)

| Form           | Example                           | Node            |
| -------------- | --------------------------------- | --------------- |
| String         | `~text~`, `%var%`                 | `string`        |
| Concatenation  | `~a~ ^ ~b~`                       | `concat_string` |
| String + sound | `~text~ [sound]`                  | `compound_text` |
| Male/female    | `~male~ [m.wav] ~female~ [f.wav]` | `compound_text` |
| Forced ref     | `!123 ~text~`                     | `forced_text`   |
| Reference      | `@123`, `#-1`, `(AT ~var~)`       | `tra_ref`, ...  |

### Identifiers and Labels

Identifiers (filenames, state labels) and variable references support `#` for namespacing:

```d
BEGIN RR#INT01                    // filename with #
IF ~~ THEN BEGIN RR#ZA00          // state label with #
%RR#DimensionDoor%                // variable ref with #
EXTERN ~RR#VEND~ ~13~             // string as state label
```

### References

| Type     | Example      | Description                         |
| -------- | ------------ | ----------------------------------- |
| TRA ref  | `@123`       | Translation file reference          |
| TLK ref  | `#123`       | DIALOG.TLK string reference         |
| Variable | `%varname%`  | WeiDU variable (allows `#` in name) |
| AT var   | `(AT "var")` | Variable TRA reference              |

### Comments

```d
// Line comment
/* Block comment /* nested */ still the same comment */
/** @tra file.tra */   // MLS TRA directive
```

Block comments nest, as in WeiDU.

### dActionWhen (Conditional)

```d
IF ~regexp~       // Process if element matches
UNLESS ~regexp~   // Skip if element matches
```

## Supported D Actions

### Create/Append

- `BEGIN`
- `APPEND` / `APPEND_EARLY`
- `EXTEND_TOP` / `EXTEND_BOTTOM` / `EXTEND`
- `REPLACE`

### Chain/Interject

- `CHAIN` / `CHAIN3`
- `INTERJECT`
- `INTERJECT_COPY_TRANS` / `INTERJECT_COPY_TRANS2` / `INTERJECT_COPY_TRANS3` / `INTERJECT_COPY_TRANS4`

### Modify Existing

- `ALTER_TRANS`
- `ADD_STATE_TRIGGER` / `A_S_T`
- `ADD_TRANS_TRIGGER` / `A_T_T`
- `ADD_TRANS_ACTION`
- `SET_WEIGHT`
- `REPLACE_SAY`
- `REPLACE_STATE_TRIGGER` / `R_S_T`

### Replace Text

- `REPLACE_ACTION_TEXT` / `R_A_T` / `REPLACE_ACTION_TEXT_REGEXP`
- `REPLACE_ACTION_TEXT_PROCESS` / `R_A_T_P_R`
- `REPLACE_TRANS_TRIGGER`
- `REPLACE_TRANS_ACTION`
- `REPLACE_TRIGGER_TEXT` / `R_T_T` / `REPLACE_TRIGGER_TEXT_REGEXP`

### Legacy, inside a state list (WeiDU doc says "avoid")

- `APPENDI` (`inline_append`) - use `APPEND` instead
- `CHAIN2` (`inline_chain`) - use `CHAIN` instead

## Building

```bash
tree-sitter generate
tree-sitter build --wasm
```

## Testing

```bash
pnpm test
```

## Formatter

See [formatter.md](./formatter.md) for complete documentation on the WeiDU D formatter, including:

- Comment preservation (decorative separators, block comments, trailing comments)
- Multi-line string formatting
- Whitespace normalization rules
- Usage examples (VSCode and CLI)
