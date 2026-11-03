/**
 * The .td half, several actions in one action string (`~SetGlobal(...) SetGlobal(...)~`).
 *
 * The relative import is extensionless, matching the only relative import in the real corpus
 * (wm_chaos.tbaf -> ./lib.wm_chaos). A .td importing another .td is not a shape the corpus has.
 *
 * `SetGlobal` is left bare rather than imported from `@bgforge/iets/bg2` the way real mod files do:
 * that package is not installed here, so importing it would fail the bundle (bundle-unresolved.test.ts
 * covers that behaviour) and the fixture would stop testing the fold.
 */

import { Lib, OFFSET } from "./lib";

begin("TDFOLD", Start);

function Start() {
    say("hello");
    action(
        SetGlobal("imported_enum", "GLOBAL", Lib.Base + 1),
        SetGlobal("imported_const", "GLOBAL", OFFSET + 1),
    ).exit();
}
