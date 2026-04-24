# tree-sitter-weidu-d

Tree-sitter grammar for WeiDU D (dialog) files.

## D Syntax Reference

D files define Infinity Engine dialogues for WeiDU modding.

### String Types

| Type          | Example          | Status                                       |
| ------------- | ---------------- | -------------------------------------------- |
| Double quote  | `"text"`         | Supported                                    |
| Tilde         | `~text~`         | Supported                                    |
| Percent       | `%text%`         | Not supported (conflicts with variable refs) |
| Five tildes   | `~~~~~text~~~~~` | Not supported (regex limitation)             |
| Concatenation | `"a" ^ "b"`      | Not supported                                |

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
  ~sayText~
  == otherFile ~otherSpeaker says~
  == anotherFile IF ~condition~ THEN ~conditional text~
END filename stateLabel
```

Chain epilogue options: `END file state`, `EXTERN file state`, `COPY_TRANS file state`, `EXIT`

#### INTERJECT - One-Time Interjection

```d
INTERJECT filename label globalVar
  ~interjection text~
END filename stateLabel
```

Also: `INTERJECT_COPY_TRANS`, `INTERJECT_COPY_TRANS2`, `INTERJECT_COPY_TRANS3`, `INTERJECT_COPY_TRANS4`

#### EXTEND_TOP / EXTEND_BOTTOM - Add Transitions

```d
EXTEND_TOP filename stateLabel [#position]
  transition list...
END
```

#### States

```d
IF [WEIGHT #n] ~trigger~ [THEN] [BEGIN] stateLabel
  SAY text [= text ...]
  transition list...
END
```

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
- `FLAGS integer` - Binary flags

### Text (Player-Visible Strings)

| Form           | Example                           | Status        |
| -------------- | --------------------------------- | ------------- |
| String         | `~text~`                          | Supported     |
| String + sound | `~text~ [sound]`                  | Not supported |
| Male/female    | `~male~ [m.wav] ~female~ [f.wav]` | Not supported |
| Forced ref     | `!123 ~text~`                     | Not supported |
| Reference      | `@123`, `#123`                    | Supported     |

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
/* Block comment */
/** @tra file.tra */   // MLS TRA directive
```

### dActionWhen (Conditional)

```d
IF ~regexp~       // Process if element matches
UNLESS ~regexp~   // Skip if element matches
```

## Supported D Actions

### Create/Append

- `BEGIN`
- `APPEND` / `APPEND_EARLY`
- `EXTEND_TOP` / `EXTEND_BOTTOM`
- `REPLACE`

### Chain/Interject

- `CHAIN`
- `INTERJECT`
- `INTERJECT_COPY_TRANS` / `INTERJECT_COPY_TRANS2` / `INTERJECT_COPY_TRANS3` / `INTERJECT_COPY_TRANS4`

### Modify Existing

- `ALTER_TRANS`
- `ADD_STATE_TRIGGER`
- `ADD_TRANS_TRIGGER`
- `ADD_TRANS_ACTION`
- `SET_WEIGHT`
- `REPLACE_SAY`
- `REPLACE_STATE_TRIGGER`

### Replace Text

- `REPLACE_ACTION_TEXT` / `REPLACE_ACTION_TEXT_REGEXP`
- `REPLACE_ACTION_TEXT_PROCESS` / `R_A_T_P_R`
- `REPLACE_TRANS_TRIGGER`
- `REPLACE_TRANS_ACTION`
- `REPLACE_TRIGGER_TEXT` / `REPLACE_TRIGGER_TEXT_REGEXP`

## Not Supported

### String Types

- `%text%` - conflicts with `%variable%` refs
- `~~~~~text~~~~~` - five tildes (regex limitation)
- `String ^ String` - concatenation

### Text Features

- `String [WAVEFILE]` - sound file attachment
- `String [WAVEFILE] String [WAVEFILE]` - male/female variants
- `!integer text` - forced string reference

### Legacy (WeiDU doc says "avoid")

- `APPENDI` - use `APPEND` instead
- `CHAIN2` - use `CHAIN` instead

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
