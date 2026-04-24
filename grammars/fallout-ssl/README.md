# Fallout SSL Tree-sitter Grammar

Tree-sitter grammar for Fallout 2 Star-Trek Scripting Language (SSL).

## Table of Contents

- [Syntax Reference](#syntax-reference)
    - [Source File](#source-file)
    - [Preprocessor](#preprocessor)
    - [Procedures](#procedures)
    - [Variables](#variables)
        - [Variable Scoping Rules](#variable-scoping-rules)
    - [Statements](#statements)
        - [If Statement](#if-statement)
        - [While Loop](#while-loop)
        - [For Loop](#for-loop-sfall)
        - [Foreach Loop](#foreach-loop-sfall)
        - [Switch Statement](#switch-statement)
        - [Return Statement](#return-statement)
        - [Break/Continue](#breakcontinue-sfall)
        - [Call Statement](#call-statement)
        - [Assignment](#assignment)
        - [Expression Statement](#expression-statement)
    - [Blocks](#blocks)
    - [Expressions](#expressions)
        - [Ternary Expression](#ternary-expression-sfall)
        - [Binary Operators](#binary-operators)
        - [Unary Operators](#unary-operators)
        - [Function Call](#function-call)
        - [Subscript Access](#subscript-access-sfall)
        - [Member Access](#member-access-sfall)
        - [Procedure Reference](#procedure-reference)
        - [Array Literal](#array-literal-sfall)
        - [Map Literal](#map-literal-sfall)
        - [Parenthesized Expression](#parenthesized-expression)
    - [Terminals](#terminals)
    - [Comments](#comments)
- [Operator Precedence](#operator-precedence-high-to-low)
- [Notes](#notes)

## Syntax Reference

### Source File

A source file consists of top-level declarations:

```
source_file = (preprocessor | procedure_forward | procedure | variable_decl | export_decl | macro_call_stmt)*
```

### Preprocessor

Preprocessor directives start with `#`. Supports line continuation with `\`.

```ssl
#define NAME value
#define MACRO(a, b) ((a) + (b))
#include "path/to/file.h"
#undef NAME
#ifdef NAME
#ifndef NAME
#else
#endif
```

Function-like macros require the opening `(` immediately after the macro name.
`#define MACRO(x)` is parameterized; `#define MACRO (x)` is an object-like macro whose
replacement text starts with parentheses.

#### Token Pasting (`##`)

The C preprocessor `##` operator is supported inside macro bodies:

```ssl
#define anim_to(x, type, dist)  animate_##type##_to_tile(dist)
#define PASTE(a, b)  a##b
```

The `##` operator is context-sensitive: it is only recognized inside `#define` bodies
(where `_line_end` is a valid token). Outside macro bodies it remains a syntax error.
This is enforced by the external scanner (`src/scanner.c`).

#### Omitting the trailing `;` in macro bodies

The C preprocessor performs textual substitution — the macro body is pasted into the
call site as-is. Whether a trailing `;` is needed depends on how the macro is invoked,
not on the macro body itself. It is therefore common to omit the final `;`:

```ssl
#define set_counter  counter := 0    // no ; — pasted as-is at call site
#define reset        x := 0; y := 0  // ; on all but last — valid
```

The grammar supports this for the simple case where the final statement is a top-level
assignment directly inside the macro body.

**Limitation:** when the no-`;` assignment is nested inside a control-flow branch, the
grammar does not handle it and will produce a parse error:

```ssl
// NOT supported — assignment inside else branch lacks ;
#define set_obj  if (x) then a := 1 else a := 0
```

Full support would require duplicating the statement grammar for macro context.

Token-pasted call expressions are parsed as `token_paste_identifier` nodes:

```
(call_expr
  func: (token_paste_identifier
    (identifier)   ; animate_
    (identifier)   ; type
    (identifier))  ; _to_tile
  args: ...)
```

### Procedures

Forward declaration:

```ssl
procedure name;
procedure name(variable arg1, variable arg2);
```

Definition:

```ssl
procedure name begin
    // statements
end

procedure name(variable arg1, variable arg2 = default_value) begin
    // statements
end
```

Parameter defaults are limited to simple values: identifiers, numbers, strings, booleans,
optional parentheses around a simple value, and unary forms such as `-1` or `not false`.
Function calls and compound expressions are not valid parameter defaults.

### Variables

Global variables:

```ssl
variable name;
variable name = value;
variable a, b, c;
variable a = 1, b = 2;

// Static array (sfall)
variable arr[10];
variable matrix[100];

// Block form
variable begin
    a;
    b = 1;
    c = 2, d = 3;  // comma-separated on same line
end

// Imported
import variable name;
```

Export declaration:

```ssl
export variable name;
export variable name = value;
```

#### Variable Scoping Rules

SSL has two scope levels:

1. **Script-scope**: Variables declared at the top level (outside any procedure). Visible throughout the entire file.
2. **Procedure-scope**: Variables declared inside a procedure (including `variable` declarations, `for` loop variables, `foreach` variables, and parameters). Visible only within that procedure.

**Key rules:**

- **No shadowing**: If a variable is declared at script-scope, it cannot be redeclared inside a procedure. Procedures can use script-scope variables but cannot shadow them.
- **Same names allowed across procedures**: Different procedures may declare variables with the same name. These are distinct variables, each local to its own procedure.

```ssl
variable global_count := 0;  // script-scope, visible everywhere

procedure process_items begin
    variable i;              // procedure-scope, local to process_items
    for (variable j := 0; j < 10; j++) begin
        global_count += 1;   // accessing script-scope variable
    end
end

procedure process_other begin
    variable i;              // different i, local to process_other
    variable j := 5;         // different j, local to process_other
    // both are independent from process_items' i and j
end
```

**Implications for tooling:**

- When resolving a variable reference inside a procedure, first check procedure-local declarations, then script-scope.
- Rename operations must respect scope boundaries: renaming `i` in `process_items` must not affect `i` in `process_other`.
- Go-to-definition must find the correct declaration based on the cursor's containing procedure.

### Statements

#### If Statement

```ssl
if condition then statement;

if condition then begin
    // statements
end

if condition then begin
    // statements
end else begin
    // statements
end

if condition then
    statement
else
    statement
```

#### While Loop

```ssl
while condition do statement;

while condition do begin
    // statements
end
```

#### For Loop (sfall)

```ssl
for (init; condition; update) begin
    // statements
end

for (variable i = 0; i < 10; i++) begin
    // statements
end

// Init without variable keyword (assigns to existing variable)
for (i = 0; i < 10; i++) begin
    // statements
end
```

#### Foreach Loop (sfall)

```ssl
foreach item in array begin
    // statements
end

foreach key: value in map begin
    // statements
end

// Parenthesized form (allows while condition)
foreach (key: value in map) begin
    // statements
end

// With while condition
foreach (item in array while condition) begin
    // statements
end
```

#### Switch Statement

```ssl
switch value begin
    case VALUE1:
        // statements
    case VALUE2:
        // statements
    default:
        // statements
end
```

#### Return Statement

```ssl
return;
return value;
```

#### Break/Continue (sfall)

```ssl
while condition do begin
    if done then break;
    if skip then continue;
end
```

#### Call Statement

```ssl
call procedure_name;
call procedure_name(arg1, arg2);
call procedure_name in ticks;    // delayed call
```

#### Assignment

```ssl
variable = value;
variable = value;
variable += value;
variable -= value;
variable *= value;
variable /= value;
array[index] = value;
```

#### Expression Statement

```ssl
function_call(args);
MACRO_NAME
MACRO_NAME(args)
```

### Blocks

```ssl
begin
    // statements
end
```

Keywords `begin` and `end` are case-insensitive.

### Expressions

#### Ternary Expression (sfall)

```ssl
value_if_true if condition else value_if_false
```

#### Binary Operators

Logical (precedence low to high):

- `or` - logical OR
- `orelse` - short-circuit OR (sfall)
- `and` - logical AND
- `andalso` - short-circuit AND (sfall)

Bitwise:

- `bwor` - bitwise OR
- `bwxor` - bitwise XOR
- `bwand` - bitwise AND

Comparison:

- `==`, `!=` - equality
- `in` - membership test (sfall): `expr in array`
- `<`, `>`, `<=`, `>=` - relational

Arithmetic:

- `+`, `-` - addition, subtraction
- `*`, `/`, `%` - multiplication, division, modulo
- `^` - exponentiation

All logical and bitwise operators are case-insensitive.

#### Unary Operators

- `not` - logical NOT
- `bnot` - bitwise NOT
- `-` - negation
- `++`, `--` - increment/decrement (pre and post)

#### Function Call

```ssl
function_name(arg1, arg2, ...)
```

Inside macro bodies, the function name may use `##` token pasting:

```ssl
animate_##type##_to_tile(dist)   // parsed as token_paste_identifier
```

#### Subscript Access (sfall)

```ssl
array[index]
map["key"]
```

#### Member Access (sfall)

Dot notation for accessing named array fields:

```ssl
obj.field
obj.field = value;
array[0].name
obj.list[5].value
```

#### Procedure Reference

```ssl
@procedure_name
```

#### Array Literal (sfall)

```ssl
[1, 2, 3]
[]
```

#### Map Literal (sfall)

```ssl
{"key": value, "key2": value2}
{0: "value", 1: "other"}
{}
```

#### Parenthesized Expression

```ssl
(expression)
```

### Terminals

#### Identifier

```
[a-zA-Z_][a-zA-Z0-9_]*
```

#### Number

```ssl
42          // integer
3.14        // float
.5          // float
0xFF        // hexadecimal
```

#### Boolean

```ssl
true
false
```

#### String

```ssl
"string content"
```

### Comments

```ssl
// line comment

/* block comment */

/*
   multi-line
   block comment
*/
```

## Operator Precedence (high to low)

| Precedence | Operators                                             |
| ---------- | ----------------------------------------------------- |
| 12         | `()` function call, `[]` subscript, `.` member access |
| 11         | `not`, `bnot`, `-` (unary), `++`, `--`                |
| 10         | `^` exponentiation                                    |
| 9          | `*`, `/`, `%`                                         |
| 8          | `+`, `-`                                              |
| 7          | `<`, `>`, `<=`, `>=`                                  |
| 6          | `==`, `!=`, `in`                                      |
| 5          | `bwand`                                               |
| 4          | `bwxor`                                               |
| 3          | `bwor`                                                |
| 2          | `and`, `andalso`                                      |
| 1          | `or`, `orelse`                                        |
| -1         | ternary `x if c else y`                               |

## Notes

- Keywords `procedure`, `begin`, `end` are case-insensitive
- Logical/bitwise operators (`and`, `or`, `not`, `bwand`, etc.) are case-insensitive
- Line continuation with `\` is supported in preprocessor directives
- Features marked (sfall) require the sfall script extender

## Reserved Words

The following words are reserved and cannot be used as identifiers:

```
begin end procedure variable if then else while do for foreach in
switch case default return break continue call import export
and or not bwand bwor bwxor bwnot
```

### Technical Notes

SSL does not formally reserve most keywords — the language spec allows identifiers
like `default` or `begin` as variable names. However, tree-sitter's `word` property
(set to `$.identifier`) causes the lexer to prefer a keyword token over the identifier
token whenever that keyword appears in the current lookahead set. In practice, keywords
such as `default` (used in `switch`) are effectively reserved in most parser states,
because a `switch` statement can appear anywhere a statement is expected.

Tree-sitter's regex-based lexer cannot exclude keywords from the identifier pattern
(negative lookahead is not supported). The formatter detects keyword-as-identifier
usage and reports it as an error — this semantic check keeps the grammar simple.

#### External Scanner

`src/scanner.c` handles three tokens:

- **`_newline`** — newlines outside `#define` bodies (treated as whitespace via `extras`)
- **`_line_end`** — newline inside a `#define` body (terminates the macro)
- **`_token_paste`** — the `##` operator; only emitted when `_line_end` is also valid
  (i.e. inside a `#define` body), making `##` context-sensitive

The scanner runs in both native and WASM builds. `TREE_SITTER_WASM` is not defined
by the build system, so there is no WASM-specific code path.

For example, in `end begin` (missing `else`), the parser doesn't expect a keyword after
`end`, so `begin` is parsed as an identifier. This is syntactically invalid but not
caught at parse time.

The formatter detects reserved words used as identifiers and reports them as errors.
This semantic check ensures code correctness while keeping the grammar simple.

## Formatter

See [formatter.md](./formatter.md) for complete documentation on the Fallout SSL formatter.
