/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from "path";

import { runTests } from "@vscode/test-electron";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./index.js");
        const workspacePath = process.env["CODE_TESTS_WORKSPACE"];
        const launchArgs = [
            ...(workspacePath ? [workspacePath] : []),
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--ozone-platform=headless",
        ];

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs });
    } catch (error) {
        console.error(`Failed to run tests: ${error}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
});
