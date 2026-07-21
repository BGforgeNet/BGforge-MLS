#!/usr/bin/env node
// Stand-in child CLI for the --jobs fan-out tests. runChild() spawns
// process.argv[1] (normally the real CLI bundle re-invoking itself); the tests
// point argv[1] here instead. Mirrors the child-mode contract: process the
// --files-from list, print one line per file, report counts over IPC.
// FAIL_MARKER: a file whose content contains "fail" makes the child exit 1
// after writing a diagnostic to stderr, to exercise the parent's failure path.

const fs = require("fs");

const listFlag = process.argv.indexOf("--files-from");
if (listFlag === -1 || !process.argv[listFlag + 1]) {
    process.stderr.write("jobs-child: missing --files-from\n");
    process.exit(2);
}
const files = fs
    .readFileSync(process.argv[listFlag + 1], "utf-8")
    .split("\n")
    .filter((line) => line !== "");

let changed = 0;
for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    if (content.includes("fail")) {
        process.stderr.write(`jobs-child: refusing ${file}\n`);
        process.exit(1);
    }
    fs.writeFileSync(file, content.toUpperCase());
    process.stdout.write(`Processed: ${file}\n`);
    changed++;
}
if (process.send) {
    // A malformed message first: the parent must ignore anything that is not
    // a well-formed counts object and keep the later valid one.
    process.send({ bogus: true });
    process.send({ changed, unchanged: 0 });
}
