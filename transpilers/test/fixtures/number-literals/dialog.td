/**
 * The .td half of the number-literals fixture: the same round numbers, through a dialog action string.
 * `SetGlobal` is left bare for the reason constant-folding/dialog.td gives.
 */

import { LIMIT } from "./lib";

begin("TDNUM", Start);

function Start() {
    say("hello");
    action(
        SetGlobal("literal", "GLOBAL", 1000),
        SetGlobal("imported", "GLOBAL", LIMIT),
    ).exit();
}
