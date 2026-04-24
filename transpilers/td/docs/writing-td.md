# Writing TD

TD is a TypeScript DSL that transpiles to WeiDU D dialog files for Infinity Engine games. You write `.td` files where functions become dialog states, method chains define transitions, and the transpiler handles state collection, text references, and patch operations. TD gives you type checking, autocomplete, and module imports while generating standard WeiDU D code.

## Core Concepts

WeiDU D files describe dialog trees. The fundamental building blocks are:

- **States** -- NPC text with transitions. Each state has a label, optional trigger, SAY text, and a list of transitions.
- **Transitions** -- Player responses that lead to another state, exit the dialog, or copy transitions from another state. Transitions can have triggers (conditions), reply text, and actions.
- **Constructs** -- Top-level operations: `BEGIN` (create new dialog), `APPEND` (add states), `EXTEND_TOP`/`EXTEND_BOTTOM` (add transitions), `CHAIN` (multi-speaker conversations), `INTERJECT` (one-shot interjections), and patch operations.

In TD, functions are dialog states. A function with no parameters is a state function -- its name becomes the state label, its body defines the SAY text and transitions. A function with parameters is a helper that gets inlined at call sites.

## Dialog Operations

### `begin()` -- Create a New Dialog

Creates a new DLG file from scratch. Any existing DLG with the same name is overwritten.

```typescript
function greeting() {
    say(tra(1));
    reply(tra(2)).goTo(quest);
    reply(tra(3)).exit();
}

function quest() {
    say(tra(4));
    exit();
}

begin("MYDLG", [greeting, quest]);
```

States can be passed as an array or as rest arguments:

```typescript
begin("MYDLG", greeting, quest); // rest args
begin("MYDLG", [greeting, quest]); // array
```

Inline states with `state()`:

```typescript
begin("MYDLG", [
    state("greeting", () => {
        say(tra(1));
        exit();
    }),
]);
```

Options: `{ nonPausing: true }` as the last argument creates a non-pausing dialog.

### `append()` -- Add States to Existing Dialog

```typescript
function newState() {
    say(tra(10));
    exit();
}

append("EXISTDLG", newState);
```

Supports the same forms as `begin()` (array, rest args, inline `state()`). Add `{ ifFileExists: true }` as the last argument for conditional append.

### `appendEarly()` -- Add States Early

Like `append()`, but states are added early in the compilation timeline (just after BEGIN). They can be targets for `INTERJECT_COPY_TRANS`.

```typescript
appendEarly("EXISTDLG", earlyState);
```

### `extendTop()` / `extendBottom()` -- Add Transitions

Add transitions to the top or bottom of an existing state's transition list:

```typescript
extendBottom("MYDLG", "greeting", () => {
    if (PartyHasItem("SWORD01")) {
        reply(tra(20)).goTo(quest);
    }
});
```

With position (inserts at specific index):

```typescript
extendBottom("MYDLG", "greeting", { position: 2 }, () => {
    reply(tra(21)).goTo(quest);
});
```

### `replaceState()` -- Replace an Existing State

Replace a state by numeric index:

```typescript
replaceState("MYDLG", 5, () => {
    say(tra(50));
    exit();
});
```

### `replace()` -- Replace Multiple States

Replace multiple states by numeric index using a record:

```typescript
replace("MYDLG", {
    0: () => {
        say(tra(60));
        exit();
    },
    3: () => {
        say(tra(61));
        reply(tra(62)).exit();
    },
});
```

## State Functions

Inside a state function, use these to define the state:

### `say()` -- NPC Text

Set the SAY text for the state. Variadic form creates multisay (random selection by engine):

```typescript
function myState() {
    say(tra(1)); // single text
    say(tra(1), tra(2), tra(3)); // multisay: SAY @1 = @2 = @3
}
```

### `weight()` -- State Priority

Lower weights are evaluated first. Only use for patching existing dialogs:

```typescript
function myState() {
    weight(5);
    say(tra(1));
    exit();
}
```

### `copyTrans()` -- Copy Transitions

Copy all transitions from another state. This copying takes place before all other D actions:

```typescript
function myState() {
    say(tra(1));
    copyTrans("OTHERDLG", "otherState");
    copyTrans("OTHERDLG", "otherState", { safe: true }); // suppress warnings
}
```

## Transitions

Transitions define how the player responds and where the dialog goes next. Two syntax forms:

### Chain Form (Method Chaining)

The builder pattern: `reply().action().goTo()`:

```typescript
function myState() {
    say(tra(1));
    reply(tra(2))
        .action(SetGlobal("quest", "GLOBAL", 1))
        .goTo(nextState);
    reply(tra(3)).exit();
    reply(tra(4)).extern("OTHERDLG", "otherState");
}
```

Full chain API:

| Method                          | Description                        |
| ------------------------------- | ---------------------------------- |
| `reply(text)`                   | Player says this text              |
| `.action(...actions)`           | Execute engine actions             |
| `.journal(text)`                | Add journal entry                  |
| `.solvedJournal(text)`          | Add solved journal entry           |
| `.unsolvedJournal(text)`        | Add unsolved journal entry         |
| `.flags(n)`                     | Set transition feature flags       |
| `.goTo(target)`                 | Go to another state in same dialog |
| `.exit()`                       | End conversation                   |
| `.extern(dialog, state)`        | Go to state in another dialog      |
| `.copyTransLate(dialog, state)` | Copy transitions (late binding)    |

Terminals (`.goTo()`, `.exit()`, `.extern()`, `.copyTransLate()`) end the chain.

The `extern` method accepts an options object: `.extern("DLG", "state", { ifFileExists: true })`.

### Statement Form

Individual function calls that build transitions step by step:

```typescript
function myState() {
    say(tra(1));

    reply(tra(2));
    action(SetGlobal("quest", "GLOBAL", 1));
    goTo(nextState);

    reply(tra(3));
    exit();
}
```

Each `reply()` starts a new transition. `goTo()`, `exit()`, `action()`, `journal()`, etc. modify the most recent transition.

### No-Reply Transitions

Transitions without player text (auto-transitions). Use `if` for conditional:

```typescript
function myState() {
    say(tra(1));

    if (Global("quest", "GLOBAL", 1)) {
        goTo(questComplete);
    }

    // Unconditional fallback
    goTo(questActive);
}
```

### `goTo()` Targets

`goTo()` accepts a state label (string), numeric index, or function reference:

```typescript
goTo(nextState); // function reference -> label "nextState"
goTo("nextState"); // string label
goTo(5); // numeric state index
```

When using a function reference, the function is **automatically collected** -- if it's not already listed in `begin()`/`append()`, the transpiler automatically includes it (see [Automatic State Collection](#automatic-state-collection)).

## Conditional Transitions (`if` / `else`)

Use `if` inside state functions for conditional transitions:

```typescript
function myState() {
    say(tra(1));

    if (Global("quest", "GLOBAL", 0)) {
        reply(tra(2))
            .action(SetGlobal("quest", "GLOBAL", 1))
            .goTo(questStart);
    }

    if (Global("quest", "GLOBAL", 1)) {
        reply(tra(3)).goTo(questEnd);
    }

    reply(tra(4)).exit();
}
```

Each `if` branch creates a transition with a trigger condition. The trigger is emitted in the D output.

**State-level wrapping if:** When a single `if` wraps the entire state body (including `say()`), it becomes a state entry trigger rather than a transition trigger:

```typescript
function myState() {
    if (Global("active", "GLOBAL", 1)) {
        say(tra(1));
        reply(tra(2)).exit();
    }
}
// -> IF ~Global("active","GLOBAL",1)~ myState SAY @1 ...
```

**`else` / `else if`:** Creates additional transitions without triggers (else) or with negated triggers:

```typescript
function myState() {
    say(tra(1));

    if (PartyHasItem("SWORD01")) {
        reply(tra(2)).goTo(hasSword);
    } else {
        reply(tra(3)).goTo(noSword);
    }
}
```

## Chain Dialogs

Multi-speaker conversations where the PC says nothing.

### New Form (Recommended)

```typescript
chain("SPEAKER1", "chainLabel", () => {
    say(tra(1));

    from("SPEAKER2");
    say(tra(2));
    say(tra(3)); // multisay continuation

    from("SPEAKER1");
    say(tra(4));

    exit();
});
```

With entry trigger:

```typescript
chain(Global("quest", "GLOBAL", 1) && See("Imoen2"), "BJKLSY", "myChain", () => {
    say(tra(1));
    from("IMOEN2J");
    say(tra(2));
    exit();
});
```

**`from(speaker)`** -- Switch speaker. Subsequent `say()` calls use this speaker.

**`fromWhen(speaker, condition)`** -- Conditional speaker switch. The speaker's lines are only included if the condition is true:

```typescript
chain("BJKLSY", "pizzaChain", () => {
    say(tra(100));

    from("IMOEN2J");
    say(tra(101));

    fromWhen("BJKLSY", PartyHasItem("pepperoni"));
    say(tra(102));

    fromWhen("IMOEN2J", !PartyHasItem("pepperoni"));
    say(tra(103));

    exit();
});
```

Chain epilogues: `exit()`, `goTo(target)`.

### Old Form

Pass a function expression to `chain()`:

```typescript
chain(function myChain() {
    say("SPEAKER1", tra(1));
    say("SPEAKER2", tra(2));
    say("SPEAKER1", tra(3));
    exit();
});
```

With trigger:

```typescript
chain(Global("quest", "GLOBAL", 1), function myChain() {
    say("SPEAKER1", tra(1));
    say("SPEAKER2", tra(2));
    exit();
});
```

In the old form, `say(speaker, text)` switches the speaker. `say(text)` continues with the current speaker (multisay).

## Interject Operations

One-shot interjections guarded by a global variable (set once, never repeated).

### `interject()`

Creates a chain guarded by a global variable, with an explicit exit point:

```typescript
interject(
    "ENTERDLG",
    "enterState",
    "MyInterjectVar",
    () => {
        from("IMOEN2J");
        say(tra(1));
        from("MINSC");
        say(tra(2));
    },
    "EXITDLG",
    "exitState",
);
```

### `interjectCopyTrans()`

Like `interject`, but copies transitions from the entry state instead of using an explicit exit:

```typescript
interjectCopyTrans("ENTERDLG", "enterState", "MyVar", () => {
    from("IMOEN2J");
    say(tra(1));
});
```

### `interjectCopyTrans2()`

Like `interjectCopyTrans`, but actions in the entry state's transitions are preserved with the original speaker.

## Text References

### `tra(n)` -- Translation Reference

Maps to `@N` in D output. References a line in the `.tra` file:

```typescript
say(tra(1)); // -> SAY @1
reply(tra(2)); // -> ++ @2 ...
```

With sound: `tra(1, { sound: "MYSOUND" })` -> `@1 [MYSOUND]`.

### `tlk(n)` -- TLK String Reference

Maps to `#N` in D output. References an entry in the game's dialog.tlk:

```typescript
say(tlk(12345)); // -> SAY #12345
```

### `tlkForced(n, text)` -- Forced TLK Reference

Maps to `!N` in D output.

### String Literals

Plain strings become tilde-delimited text:

```typescript
say("Hello world"); // -> SAY ~Hello world~
```

### Male/Female Variants

Pass an object with `male` and `female` properties:

```typescript
say({ male: tra(1), female: tra(2) });
// -> SAY @1 @2
```

With sound variants:

```typescript
say({ male: tra(1), female: tra(2), maleSound: "M_GREET", femaleSound: "F_GREET" });
```

## Patch Operations

Modify existing dialog files without rewriting them entirely.

### `alterTrans()`

Fine-grained modification of transitions:

```typescript
alterTrans("wsmith01", [32], [0], {
    trigger: False(),
});
```

Options: `trigger` (set condition, `false` to clear), `action` (set action), `reply` (set reply text).

### `addStateTrigger()`

Add a trigger to existing states:

```typescript
addStateTrigger("BJALVAR", "state1", Global("newCondition", "GLOBAL", 1));
// Also accepts array of states:
addStateTrigger("BJALVAR", ["state1", "state2"], Global("cond", "GLOBAL", 1));
```

### `addTransTrigger()`

Add a trigger to transitions:

```typescript
addTransTrigger("BJALVAR", ["state1"], !Global("blocked", "GLOBAL", 1), { trans: [0, 1, 2] });
```

### `addTransAction()`

Add action to transitions:

```typescript
addTransAction("BJALVAR", ["state1"], [0, 1], SetGlobal("acted", "GLOBAL", 1));
```

### `replaceTransTrigger()` / `replaceTransAction()`

Find/replace text in transition triggers or actions:

```typescript
replaceTransTrigger("wsmith01", ["g_2things"], [], "PartyGoldGT(7499)", "PartyGoldGT(12499)");
replaceTransAction("wsmith01", ["g_2things"], [], "TakePartyGold(7500)", "TakePartyGold(12500)");
```

### `replaceTriggerText()` / `replaceActionText()`

Global find/replace across all triggers or actions in a dialog:

```typescript
replaceTriggerText("BJALVAR", "OldTrigger", "NewTrigger");
replaceActionText(["player1"], "ReputationInc(-1)", "ReputationInc(-2)");
```

### `setWeight()`

Set state weight:

```typescript
setWeight("BJALVAR", "state1", 5);
```

### `replaceSay()`

Replace SAY text:

```typescript
replaceSay("BJALVAR", "state1", tra(999));
```

### `replaceStateTrigger()`

Replace state trigger:

```typescript
replaceStateTrigger("BJALVAR", [1, 2, 3], Global("newTrigger", "GLOBAL", 1));
```

## Variables and Functions

### Compile-Time Variables

All variables are compile-time only. Values are substituted textually:

```typescript
const DIALOG = "MYDLG";
const QUEST_VAR = "my_quest";

begin(DIALOG, [myState]);
// DIALOG is substituted to "MYDLG"
```

### Helper Functions (With Parameters)

Functions with parameters are helper functions. They are inlined at call sites, not emitted as states:

```typescript
function setQuestStage(stage: number) {
    action(SetGlobal("quest", "GLOBAL", stage));
    goTo(nextState);
}

function state1() {
    say(tra(1));
    if (PartyHasItem("SWORD01")) {
        reply(tra(2));
        setQuestStage(1); // Inlined: action(SetGlobal("quest", "GLOBAL", 1)); goTo(nextState);
    }
}
```

### State Functions (No Parameters)

Functions with no parameters are state functions. Their name becomes the state label:

```typescript
function greeting() {
    // -> state label "greeting"
    say(tra(1));
    exit();
}
```

## Control Flow

### `if` / `else` in States

See [Conditional Transitions](#conditional-transitions-if--else) above.

### `for` / `for...of` Loops (Compile-Time)

Loops are unrolled at compile time (max 1000 iterations):

```typescript
const npcs = ["IMOEN2J", "MINSC", "JAHEIRA"];

for (const npc of npcs) {
    extendBottom("MYDLG", "greeting", () => {
        if (InParty(npc)) {
            reply(tra(10)).extern(npc, 0);
        }
    });
}
```

Array destructuring is supported:

```typescript
const patches: [string, number][] = [
    ["state1", 5],
    ["state2", 10],
];

for (const [state, weight] of patches) {
    setWeight("MYDLG", state, weight);
}
```

Loops can also appear inside state function bodies to generate multiple transitions.

## Automatic State Collection

When you pass functions to `begin()` or `append()`, the transpiler follows all `goTo(functionRef)` references and automatically includes any reachable state functions that weren't explicitly listed.

```typescript
function start() {
    say(tra(1));
    goTo(middle); // middle is auto-collected
}

function middle() {
    say(tra(2));
    goTo(ending); // ending is auto-collected
}

function ending() {
    say(tra(3));
    exit();
}

begin("MYDLG", [start]); // Only start listed, but middle and ending are auto-collected
```

Functions with parameters are skipped (they're helpers, not states). Numeric `goTo` targets (state indices) are skipped.

**First dialog wins:** If two constructs share a `goTo` target, the first one processed gets the state. List shared states explicitly in the intended construct.

## Orphan Detection

The transpiler warns about functions that look like state functions (no parameters) but are never collected by any construct and never called as helpers. These are likely mistakes -- states you forgot to include. Unreferenced functions are also removed from the output.

## `@tra` Tag

Set the translation file:

```typescript
/** @tra my_dialog.tra */
```

Must be in a JSDoc comment (`/** ... */`).

## Scope Constants

`GLOBAL`, `LOCALS`, `MYAREA` are auto-quoted. Don't double-quote them:

```typescript
Global("quest", GLOBAL, 1);
// -> Global("quest","GLOBAL",1)
```

## Imports

Engine builtins come from [IETS](https://github.com/BGforgeNet/iets):

```typescript
import { tra, tlk, obj } from "@bgforge/iets";
import { Global, SetGlobal, See } from "@bgforge/iets/triggers.d";
import { Player1, Myself } from "@bgforge/iets/objects.d";
```

Local files can also be imported:

```typescript
import { helper } from "./my-lib";
```

## Point Arguments

BAF uses dot-separated `[x.y]` notation for coordinate points. In TD actions, use standard TypeScript tuples `[number, number]` and the transpiler converts them automatically:

```typescript
function myState() {
    say(tra(1));
    reply(tra(2))
        .action(CreateCreature("ccguard2", [2791, 831], 6))
        .exit();
}
// -> DO ~CreateCreature("ccguard2",[2791.831],6)~ EXIT
```

Negative coordinates are supported (e.g. `[-1, -1]` for "current location"). Only two-element numeric arrays are converted. Three-element arrays and object identifiers like `[PC]` are left unchanged.

## Gotchas and Pitfalls

1. **Unreferenced state functions are removed and warned about.** If a state function isn't passed to `begin()`/`append()` and isn't reachable via `goTo()`, it is removed. The orphan detection will warn you.

2. **First dialog claims shared states.** If two `begin()`/`append()` constructs reach the same state via `goTo()`, the first one processed claims it. List shared states explicitly in both constructs.

3. **Variables must be compile-time primitives.** No objects, arrays of objects, or computed values. Only strings and numbers.

4. **`copyTrans` vs `copyTransLate`.** `copyTrans()` at state level copies transitions before other D actions. `.copyTransLate()` in a transition chain copies them after. Use `copyTransLate` when the target state might not exist yet at compile time.

5. **State-level if wrapping.** A single `if` wrapping the entire body (including `say()`) becomes a state entry trigger, not a transition trigger. This is detected automatically.

6. **Helper vs state detection.** Functions with parameters are always helpers (inlined). Functions without parameters are always states (emitted as D states). There is no annotation to override this.

7. **Scope constants auto-quoted.** `GLOBAL`, `LOCALS`, `MYAREA` become `"GLOBAL"`, `"LOCALS"`, `"MYAREA"`. Don't wrap them in quotes yourself.

## Compilation

```
.td -> transpiler -> .d -> WeiDU -> game
```

Press Ctrl+R in VSCode or use the transpile CLI to compile.
