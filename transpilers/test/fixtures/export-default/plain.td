/**
 * The same dialog as bundled.td with no import, so it skips the bundler: the reference output.
 */

export default begin("TDDEF", Start);

function Start() {
    say("hello");
    action(SetGlobal("x", "GLOBAL", 5)).exit();
}
