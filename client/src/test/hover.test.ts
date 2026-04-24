/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as assert from "assert";
import { getDocUri, activate } from "./helper";

suite("Should get hover", () => {
    const docUri = getDocUri("hover.ssl");

    test("Hover for Fallout SSL", async () => {
        const mds = new vscode.MarkdownString(
            "```fallout-ssl-tooltip\n" +
                "int get_proto_data(int pid, int offset)\n```\n" +
                "Used to read the in-memory copies of the .pro files Fallout makes when they are loaded. " +
                "The offset refers to the offset in memory from the start of the proto to the element you are reading.",
        );
        const eh = { contents: [mds] };
        const pos = new vscode.Position(0, 15);
        await testHover(docUri, pos, eh);
    });
});

async function testHover(docUri: vscode.Uri, position: vscode.Position, expectedHover: vscode.Hover) {
    await activate(docUri);

    const actualHover = (await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        docUri,
        position,
    )) as vscode.Hover[];
    const hover = actualHover[0];
    assert.ok(hover, "Expected hover result");
    const { contents } = hover;
    // Hover doesn't expose contents properly for some reason
    // Inspired by https://github.com/microsoft/vscode-extension-samples/issues/434
    const actualContent = contents[0];
    const expectedContent = expectedHover.contents[0];
    assert.ok(actualContent !== undefined, "Expected hover to have content");
    assert.ok(expectedContent !== undefined, "Expected expectedHover to have content");
    assert.equal(
        typeof actualContent === "string" ? actualContent : actualContent.value,
        typeof expectedContent === "string" ? expectedContent : expectedContent.value,
    );
}
