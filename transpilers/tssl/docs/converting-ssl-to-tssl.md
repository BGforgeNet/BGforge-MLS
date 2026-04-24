# Converting SSL to TSSL

Step-by-step guide for converting existing Fallout SSL scripts to TSSL.

## Quick Reference

| SSL                                        | TSSL                                                      | Notes                                                 |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------- |
| `#include "headers/sfall/sfall.h"`         | `import { func } from "folib/sfall"`                      | Import specific functions                             |
| `#include "headers/custom.h"`              | `// #include "headers/custom.h"`                          | Magic comment for non-folib headers                   |
| `#define MY_VALUE 42`                      | `const MY_VALUE = 42`                                     | Becomes `#define` in output                           |
| `#define macro(x) func(x, 1)`              | `/** @inline */ function macro(x) { return func(x, 1); }` | Becomes `#define` macro                               |
| `#define macro (expr)`                     | `/** @inline */ function macro() { return expr; }`        | Zero-arg macro                                        |
| `procedure name begin ... end`             | `function name() { ... }`                                 |                                                       |
| `procedure name(variable x) begin ... end` | `function name(x: number) { ... }`                        | Types optional but recommended                        |
| `variable x;`                              | `let x: number;`                                          | Declaration without initializer                       |
| `variable x := 5;`                         | `let x = 5;`                                              | Declaration with initializer                          |
| `if cond then begin ... end`               | `if (cond) { ... }`                                       | Parentheses required                                  |
| `while cond do begin ... end`              | `while (cond) { ... }`                                    |                                                       |
| `for (i = 0; i < n; i++) begin ... end`    | `for (let i = 0; i < n; i++) { ... }`                     |                                                       |
| `foreach k: v in arr begin ... end`        | `for (const [k, v] of arr as [K, V][]) { ... }`           | Cast for type safety                                  |
| `foreach x in arr begin ... end`           | `for (const x of arr) { ... }`                            |                                                       |
| `switch x begin case 1: ... end`           | `switch (x) { case 1: ... break; }`                       |                                                       |
| `x and y`                                  | `x && y`                                                  | Auto-converted                                        |
| `x or y`                                   | `x \|\| y`                                                | Auto-converted                                        |
| `not x`                                    | `!x`                                                      | Auto-converted                                        |
| `x bwand y`                                | `x & y`                                                   | Auto-converted                                        |
| `x bwor y`                                 | `x \| y`                                                  | Auto-converted                                        |
| `x bxor y`                                 | `x ^ y`                                                   | Auto-converted                                        |
| `bnot x`                                   | `~x`                                                      | Auto-converted                                        |
| `typeof(x)`                                | `sfall_typeof(x)`                                         | `typeof` is a TS keyword                              |
| `game_loaded`                              | `game_loaded()`                                           | Zero-arg functions need parens                        |
| `call my_proc;`                            | `my_proc();`                                              | `call` added automatically for user-defined functions |

## Step-by-Step Conversion

### 1. Replace #include with import

Map each SSL header to the corresponding [folib](https://github.com/BGforgeNet/folib) module:

| SSL Header             | folib Module               |
| ---------------------- | -------------------------- |
| `sfall/sfall.h`        | `folib/sfall`              |
| `sfall/define_lite.h`  | `folib/sfall/define_lite`  |
| `sfall/command_lite.h` | `folib/sfall/command_lite` |

```ssl
// Before (SSL)
#include "headers/sfall/sfall.h"
#include "headers/fo2tweaks/fo2tweaks.h"
```

```typescript
// After (TSSL)
import { game_loaded, get_sfall_global_int } from "folib/sfall";
import { ndebug } from "folib";
// #include "headers/fo2tweaks/fo2tweaks.h"
```

For headers without a folib equivalent, use the `// #include` magic comment. These are emitted as `#include` directives in the SSL output.

Import only the specific functions you use. Unused imports are tree-shaken.

### 2. Replace #define constants with const

```ssl
// Before
#define MAX_ITEMS  50
#define PID_WEAPON 12
```

```typescript
// After
const MAX_ITEMS = 50;
const PID_WEAPON = 12;
```

Top-level `const` becomes `#define` in the output. Inside function bodies, `const` becomes `variable` (same as `let`).

Constants that are already provided by folib (like standard PID values) should be imported instead of redefined.

### 3. Replace #define macros with @inline functions

**Zero-argument macros:**

```ssl
// Before
#define dude_tile (tile_num(dude_obj))
```

```typescript
// After
/** @inline */
function dude_tile(): number {
    return tile_num(dude_obj);
}
```

**Macros with parameters:**

```ssl
// Before
#define get_stat(who, stat) get_critter_stat(who, stat)
```

```typescript
// After
/** @inline */
function get_stat(who: CritterPtr, stat: number): number {
    return get_critter_stat(who, stat);
}
```

The `@inline` tag must be in a JSDoc comment (`/** */`), not a regular comment (`//` or `/* */`).

### 4. Replace procedure with function

```ssl
// Before
procedure do_damage(variable target, variable amount) begin
    critter_damage(target, amount);
end
```

```typescript
// After
function do_damage(target: CritterPtr, amount: number) {
    critter_damage(target, amount);
}
```

Types are optional but recommended. The transpiler ignores them (they're for TypeScript checking only).

### 5. Replace variable with let

```ssl
// Before
variable count;
variable name := "test";
```

```typescript
// After
let count: number;
let name = "test";
```

**Important:** If the variable is inside a loop and needs to reset each iteration, separate declaration from assignment:

```typescript
let count: number; // Declaration at function level
for (const x of items) {
    count = 0; // Assignment in loop body
}
```

See [writing-tssl.md](writing-tssl.md#variable-hoisting) for details on hoisting behavior.

### 6. Replace begin/end with {}

```ssl
// Before
if (x > 0) then begin
    display_msg("positive");
end else begin
    display_msg("not positive");
end
```

```typescript
// After
if (x > 0) {
    display_msg("positive");
} else {
    display_msg("not positive");
}
```

### 7. Remove then/do keywords

These SSL keywords have no TSSL equivalent. The curly braces replace them:

- `if ... then begin` becomes `if (...) {`
- `while ... do begin` becomes `while (...) {`

### 8. Replace SSL operators with TS operators

| SSL     | TSSL   |
| ------- | ------ |
| `and`   | `&&`   |
| `or`    | `\|\|` |
| `not`   | `!`    |
| `bwand` | `&`    |
| `bwor`  | `\|`   |
| `bxor`  | `^`    |
| `bnot`  | `~`    |

```ssl
// Before
if (x > 0 and y > 0) or (not z) then begin
    val = a bwand b;
end
```

```typescript
// After
if ((x > 0 && y > 0) || !z) {
    val = a & b;
}
```

### 9. Replace typeof() with sfall_typeof()

```ssl
// Before
if typeof(x) == 2 then begin
```

```typescript
// After
if (sfall_typeof(x) == 2) {
```

The transpiler converts `sfall_typeof` back to `typeof` in the output.

### 10. Add parentheses to zero-arg function calls

In SSL, functions with no arguments are called without parentheses. In TSSL, you must add them:

```ssl
// Before (SSL)
if game_loaded then begin
    x = active_hand;
    y = get_sfall_arg;
end
```

```typescript
// After (TSSL)
if (game_loaded()) {
    x = active_hand();
    y = get_sfall_arg();
}
```

The transpiler strips the parentheses in the output, producing the same SSL.

### 11. Add types (optional but recommended)

Types provide autocomplete, error checking, and documentation:

```typescript
function get_weapon(who: CritterPtr): ItemPtr {
    return critter_inven_obj(who, 0) as ItemPtr;
}
```

Common branded types: `ObjectPtr`, `CritterPtr`, `ItemPtr`, `TileNum`. These are compile-time only -- at runtime everything is numbers, strings, or sfall lists/maps (created with folib's `list()` and `map()`). There are no objects, classes, or other data structures at runtime.

## Common Patterns

### Script entry point

```ssl
// SSL
procedure start begin
    if game_loaded then begin
        ndebug("Script loaded");
    end
end
```

```typescript
// TSSL
import { ndebug } from "folib";
import { game_loaded } from "folib/sfall";

function start() {
    if (game_loaded()) {
        ndebug("Script loaded");
    }
}
```

### Hook registration

```ssl
// SSL
procedure start begin
    if game_loaded then begin
        register_hook_proc(HOOK_COMBATTURN, combat_hook);
    end
end

procedure combat_hook begin
    // handle combat turn
end
```

```typescript
// TSSL
import { register_hook_proc, HOOK_COMBATTURN } from "folib/sfall";
import { game_loaded } from "folib/sfall";

function start() {
    if (game_loaded()) {
        register_hook_proc(HOOK_COMBATTURN, combat_hook);
    }
}

function combat_hook() {
    // handle combat turn
}
```

### Map iteration

```ssl
// SSL
foreach k: v in damage_map begin
    debug_msg("key=" + k + " val=" + v);
end
```

```typescript
// TSSL
for (const [k, v] of damage_map as unknown as [number, number][]) {
    debug_msg("key=" + k + " val=" + v);
}
```

### Float division

```ssl
// SSL
variable ratio;
ratio = 1.0 * a / b;
```

```typescript
// TSSL
let ratio: number;
ratio = (FLOAT1 * a) / b;
```

`FLOAT1` is needed because esbuild strips `.0` from float literals.

## Validation Checklist

After converting, verify:

- [ ] All `#include` replaced with `import` or `// #include` magic comments
- [ ] All `#define` constants replaced with `const`
- [ ] All `#define` macros replaced with `@inline` functions
- [ ] All `procedure` replaced with `function`
- [ ] All `variable` replaced with `let`
- [ ] All `begin/end` replaced with `{}`
- [ ] All SSL operators replaced with TS operators
- [ ] `typeof()` replaced with `sfall_typeof()`
- [ ] Zero-arg function calls have parentheses
- [ ] No forbidden JS builtins (`Object`, `Array`, `Math`, etc.)
- [ ] Variables in loops use separate declaration and assignment
- [ ] Object literal keys use computed syntax `[CONSTANT]` not bare `CONSTANT`
- [ ] Compile and compare SSL output against original
