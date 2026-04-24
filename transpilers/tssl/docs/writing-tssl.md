# Writing TSSL

TSSL is a TypeScript subset that transpiles to Fallout SSL (Star-Trek Scripting Language). You write `.tssl` files using standard TypeScript syntax, and the transpiler converts them to `.ssl` files that the sslc compiler then compiles to `.int` bytecode for the Fallout engine. TSSL gives you type checking, autocomplete, go-to-definition, and module imports while targeting the same runtime as hand-written SSL.

## Supported Syntax

### Variables

**Top-level `const`** becomes `#define` (compile-time constant):

```typescript
const MY_VALUE = 42; // → #define MY_VALUE 42
const MSG_HELLO = 100; // → #define MSG_HELLO 100
```

**`let`** becomes `variable` (runtime variable):

```typescript
let count = 0; // → variable count = 0;
let name: string; // → variable name;
```

**`const` inside a function** also becomes `variable` (same as `let`):

```typescript
function example() {
    const x = 5; // → variable x = 5;
    let y = 10; // → variable y = 10;
}
```

Only top-level `const` produces `#define`. Inside function bodies, `const` and `let` are equivalent.

**Scoping rules:** All variables are function-scoped, like `var` in JavaScript. There is no block scoping. Variable declarations are hoisted to the top of the function. See [Gotchas](#gotchas-and-pitfalls) for important implications.

### Functions

Regular `function` declarations become SSL `procedure`:

```typescript
function my_proc() {
    debug_msg("hello");
}
// → procedure my_proc begin
//       debug_msg("hello");
//   end
```

**Parameters with defaults:**

```typescript
function damage(target: ObjectPtr, amount = 10) {
    // ...
}
// → procedure damage(variable target, variable amount = 10)
```

**Return values:**

```typescript
function get_hp(who: CritterPtr): number {
    return get_critter_stat(who, STAT_hp);
}
// → procedure get_hp(variable who) begin
//       return get_critter_stat(who, STAT_hp);
//   end
```

**`call` keyword:** User-defined functions (defined in the same file or bundled imports) called as standalone statements get the `call` keyword automatically. External engine functions do not:

```typescript
my_proc(); // → call my_proc();    (user-defined, gets call)
debug_msg("hello"); // → debug_msg("hello"); (external, no call)
let x = get_hp(dude_obj); // → variable x = get_hp(dude_obj);  (assignment, no call)
```

### Control Flow

**if/else:**

```typescript
if (x > 0) {
    // ...
} else {
    // ...
}
// → if (x > 0) then begin ... end else begin ... end
```

**while:**

```typescript
while (condition) {
    // ...
}
// → while (condition) do begin ... end
```

**for:**

```typescript
for (let i = 0; i < 10; i++) {
    // ...
}
// → for (variable i = 0; i < 10; i++) begin ... end
```

**do...while:**

```typescript
do {
    // ...
} while (condition);
// → Emulated with a flag variable and while loop
```

**for...of** (sfall foreach):

```typescript
for (const item of arr) {
    // ...
}
// → foreach (variable item in arr) begin ... end
```

**for...of with destructuring** (key-value iteration, exactly 2 elements):

```typescript
for (const [k, v] of myMap as unknown as [string, number][]) {
    // ...
}
// → foreach (variable k: v in myMap) begin ... end
```

**for...in:**

```typescript
for (const key in obj) {
    // ...
}
// → foreach (variable key in obj) begin ... end
```

**switch/case:**

```typescript
switch (x) {
    case 1:
        // ...
        break;
    case 2:
        // ...
        break;
    default:
    // ...
}
// → switch (x) begin case 1: ... case 2: ... default: ... end
```

**break, continue, return** all work as expected.

### Operators

The transpiler converts TypeScript operators to SSL equivalents:

| TypeScript | SSL     | Description |
| ---------- | ------- | ----------- |
| `&&`       | `and`   | Logical AND |
| `\|\|`     | `or`    | Logical OR  |
| `!`        | `not`   | Logical NOT |
| `&`        | `bwand` | Bitwise AND |
| `\|`       | `bwor`  | Bitwise OR  |
| `^`        | `bxor`  | Bitwise XOR |
| `~`        | `bnot`  | Bitwise NOT |

Operators that pass through unchanged: `==`, `!=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `%`, `=`, `+=`, `-=`, `*=`, `/=`, `++`, `--`.

**Ternary operator** is supported:

```typescript
const result = x > 0 ? a : b;
// → #define result (x > 0) ? a : b
```

### Enums

TypeScript `enum` declarations are flattened to constants using the `EnumName_Member` pattern:

```typescript
enum DamageType {
    Normal = 0,
    Fire = 3,
    Electrical = 6,
}
// → #define DamageType_Normal 0
// → #define DamageType_Fire 3
// → #define DamageType_Electrical 6
```

Enum member accesses (`DamageType.Fire`) are replaced with the flat constant (`DamageType_Fire`). Unused enum members are tree-shaken from the output.

### @inline Functions

Functions tagged with `@inline` in JSDoc become `#define` macros instead of procedures. This eliminates function call overhead:

```typescript
/** @inline */
function dude_tile(): number {
    return tile_num(dude_obj);
}
// → #define dude_tile tile_num(dude_obj)
```

**With parameters:**

```typescript
/** @inline */
function get_stat(who: CritterPtr, stat: number): number {
    return get_critter_stat(who, stat);
}
// → #define get_stat(who, stat) get_critter_stat(who, stat)
```

**Zero-arg inline functions:** At call sites, parentheses are stripped:

```typescript
const t = dude_tile(); // → dude_tile  (no parens in output)
```

The `@inline` tag must appear in a JSDoc comment (`/** @inline */`), not a regular comment.

### list() and map() Helpers

The special functions `list()` and `map()` convert to SSL array/map literals:

```typescript
const arr = list(1, 2, 3);
// → [1, 2, 3]

const m = map({ [PID_MINIGUN]: 9, [PID_SHOTGUN]: 5 });
// → {PID_MINIGUN: 9, PID_SHOTGUN: 5}
```

### Array and Object Literals

Array literals pass through:

```typescript
const arr = [1, 2, 3]; // → [1, 2, 3]
```

Object literals require **computed property keys** when using constants:

```typescript
const weapons = { [PID_MINIGUN]: 9, [PID_SHOTGUN]: 5 };
// → {PID_MINIGUN: 9, PID_SHOTGUN: 5}
```

See [Gotchas](#gotchas-and-pitfalls) for why non-computed keys don't work.

### Element and Property Access

```typescript
arr[i]; // → arr[i]
obj[key]; // → obj[key]
```

### Imports

**From [folib](https://github.com/BGforgeNet/folib)** (typed wrappers for engine headers):

```typescript
import { debug_msg, display_msg } from "folib";
import { get_sfall_global_int } from "folib/sfall";
```

**From local `.ts` files** (bundled into output):

```typescript
import { MY_CONST, helper } from "./my-lib";
```

**From `.d.ts` files** (declarations only, stripped from output):

```typescript
import { dude_obj, self_obj } from "folib/base.d";
```

`.d.ts` imports are externalized by esbuild. They provide type information but produce no output code. All `declare function` and `declare const` for engine builtins must live in `.d.ts` files.

### // #include Magic Comments

For headers that don't have folib equivalents, use magic comments:

```typescript
// #include "headers/my_custom_header.h"
```

These are extracted before bundling and emitted as `#include` directives at the top of the SSL output.

### @tra Tag

To specify a translation file, add a `@tra` tag in a comment:

```typescript
/** @tra mymod.tra */
```

Both `.tra` and `.msg` extensions are accepted. This emits `/** @tra mymod.tra */` in the SSL output header for the compiler.

### sfall_typeof() Workaround

TypeScript reserves the `typeof` keyword, so use `sfall_typeof()` instead:

```typescript
if (sfall_typeof(x) == 2) {
    /* string */
}
// → if (typeof(x) == 2) then begin ... end
```

The transpiler replaces all `sfall_typeof` occurrences with `typeof` in the output.

### FLOAT1 Constant

esbuild strips `.0` from float literals (e.g., `1.0` becomes `1`). To force float division in SSL, use `FLOAT1`:

```typescript
const ratio = (FLOAT1 * a) / b;
// → #define ratio 1.0 * a / b
```

`FLOAT1` is replaced with `1.0` in the output.

### Engine Procedures

These 27 function names are recognized as engine entry points and preserved from tree-shaking. You do not need to export them or call them -- just defining them is enough:

`start`, `map_enter_p_proc`, `map_exit_p_proc`, `map_update_p_proc`, `create_p_proc`, `destroy_p_proc`, `critter_p_proc`, `combat_p_proc`, `combat_is_starting_p_proc`, `combat_is_over_p_proc`, `damage_p_proc`, `talk_p_proc`, `look_at_p_proc`, `description_p_proc`, `use_p_proc`, `use_obj_on_p_proc`, `use_skill_on_p_proc`, `pickup_p_proc`, `drop_p_proc`, `is_dropping_p_proc`, `push_p_proc`, `spatial_p_proc`, `timed_event_p_proc`, `barter_p_proc`, `barter_init_p_proc`, `use_ad_on_p_proc`, `use_disad_on_p_proc`

### Hook-Registered Functions

Functions passed to `register_hook_proc` or `register_hook_proc_spec` are also preserved from tree-shaking:

```typescript
function on_combat_turn(event: number) {
    /* ... */
}
register_hook_proc(HOOK_COMBATTURN, on_combat_turn);
```

### JSDoc Comments

JSDoc comments on functions are preserved as SSL comments in the output:

```typescript
/**
 * Initialize the script.
 * @param mode The init mode
 */
function init(mode: number) {
    /* ... */
}
// JSDoc is preserved above the procedure in SSL output
```

JSDoc is extracted before bundling (since esbuild strips it), so it works on the main file's functions.

## Forbidden Syntax

These produce explicit transpiler errors:

| Syntax                                      | Error                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| `try/catch/finally`                         | "try/catch is not supported in SSL"                      |
| `Object.keys(...)`, `Array.from(...)`, etc. | "Object/Array/... is not available in SSL runtime"       |
| `JSON.parse(...)`, `Math.floor(...)`, etc.  | Same -- all 13 forbidden globals                         |
| `let list = 0` or `let map = 0`             | "Variable name 'list'/'map' conflicts with folib export" |
| foreach destructuring != 2 elements         | "foreach destructuring must have exactly 2 elements"     |

**Forbidden globals** (full list): `Object`, `Array`, `JSON`, `Math`, `Date`, `Promise`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Symbol`, `Reflect`, `Proxy`. None of these exist in the SSL runtime. The only runtime data structures are sfall lists and sfall maps, created with folib's `list()` and `map()` helpers.

**Reserved variable names**: `list`, `map` (they conflict with folib's `list()` and `map()` helper functions).

## Unsupported Syntax

These produce broken output or are silently ignored -- no explicit error:

| Syntax                                  | What Happens                               |
| --------------------------------------- | ------------------------------------------ |
| Arrow functions `() => {}`              | Broken output (not recognized as function) |
| Template literals `` `${x}` ``          | Broken output                              |
| Optional chaining `x?.y`                | Broken output                              |
| Nullish coalescing `x ?? y`             | Broken output                              |
| Spread `...arr`                         | Broken output                              |
| Exponentiation `x ** y`                 | Broken output                              |
| Destructuring (except for-of 2-element) | Broken output                              |
| `instanceof`                            | Broken output                              |
| `new Foo()`                             | Broken output                              |
| `await` / `async`                       | Broken output                              |
| `yield` / generators                    | Broken output                              |
| Classes (runtime use)                   | Silently ignored (type-only use is fine)   |
| Decorators (runtime)                    | Silently ignored                           |

## Gotchas and Pitfalls

### Variable Hoisting

All `let` variables are hoisted to function scope, including their initializers. A `let x = value` inside a loop runs the assignment only once at function start, not each iteration:

```typescript
// WRONG: assignment hoisted, runs once
for (const pid of pids) {
    let divisor = 100; // → variable divisor = 100; at function top!
}

// CORRECT: separate declaration from assignment
let divisor: number; // Declaration hoisted (fine)
for (const pid of pids) {
    divisor = 100; // Assignment stays in loop body
}
```

### Zero-Arg External Functions

External functions (from `.d.ts` or folib) with zero arguments have their parentheses stripped in the output. You must still write parentheses in TSSL to call them:

```typescript
if (game_loaded()) {
} // → if (game_loaded) then begin ... end
game_loaded; // Wrong: this is a reference, not a call
```

### Map Access Semantics

For sfall maps, `map[key]` and `scan_array(map, key)` are different operations:

- `map[key]` -- looks up by KEY, returns VALUE (or 0 if missing)
- `scan_array(map, key)` -- searches VALUES, returns KEY where found (or -1)

### No undefined, No Objects

SSL has no `undefined`. Missing map keys return `0`:

```typescript
if (map[key] == 0) {
} // Correct: missing keys return 0
if (map[key] == undefined) {
} // Wrong: undefined doesn't exist
```

The only runtime data structures are sfall lists (flat arrays) and sfall maps (key-value stores), created with folib's `list()` and `map()` helpers. There are no objects, classes, or other data structures at runtime. TypeScript classes and interfaces are type-only -- they exist for compile-time checking but produce nothing in the SSL output.

### Computed Property Keys

Object literals with non-computed keys turn constants into string literals:

```typescript
const x = { [PID_MINIGUN]: 9 }; // Correct: PID_MINIGUN stays a constant
const x = { PID_MINIGUN: 9 }; // Wrong: becomes "PID_MINIGUN": 9
```

Always use `[CONSTANT]` syntax for object keys.

### Import Aliasing

Importing the same function from different module paths causes esbuild to rename one (`func` becomes `func2`). Import each function from a single consistent path.

### Float Literal Stripping

esbuild optimizes `1.0` to `1`, losing the float type in SSL. Use the `FLOAT1` constant to force float context:

```typescript
const ratio = (FLOAT1 * a) / b; // → 1.0 * a / b  (float division)
const ratio = (1.0 * a) / b; // → 1 * a / b    (integer division!)
```

## Compilation

Press **Ctrl+R** in VSCode (with the extension active) to compile the current `.tssl` file. The pipeline is:

1. `.tssl` source is bundled with esbuild (resolving imports, tree-shaking)
2. The bundled TypeScript AST is converted to SSL syntax
3. The `.ssl` file is written next to the `.tssl` file
4. sslc compiles the `.ssl` to `.int` bytecode

You can also compile from the command line using the transpile CLI.
