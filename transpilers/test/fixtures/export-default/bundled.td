/**
 * A dialog declared through `export default`, in a file that imports something and so is bundled. Must emit
 * the same dialog as plain.td, which differs only in writing the imported value inline.
 */

import { VALUE } from "./lib";

export default begin("TDDEF", Start);

function Start() {
    say("hello");
    action(SetGlobal("x", "GLOBAL", VALUE)).exit();
}
