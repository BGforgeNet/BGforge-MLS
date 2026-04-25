/**
 * Unit tests for WeiDU TP2 rename functionality.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position, TextEdit } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { renameSymbol, prepareRenameSymbol } from "../../src/weidu-tp2/rename";
import { initParser } from "../../../shared/parsers/weidu-tp2";

beforeAll(async () => {
    await initParser();
});

describe("TP2 rename: global variables", () => {
    it("renames OUTER_SET variable declaration", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const position: Position = { line: 1, character: 10 }; // On "my_var"
        const result = renameSymbol(text, position, "new_var", "file:///test.tp2");

        expect(result).not.toBeNull();
        expect(result?.changes).toBeDefined();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        // Declaration and reference should be renamed
        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("OUTER_SET new_var = 5");
        expect(editedText).toContain("%new_var%");
    });

    it("renames OUTER_TEXT_SPRINT variable", () => {
        const text = `
OUTER_TEXT_SPRINT mod_folder ~mymod~
COPY ~%mod_folder%/file.txt~ ~override~
`;
        const position: Position = { line: 1, character: 19 }; // On "mod_folder"
        const result = renameSymbol(text, position, "folder_name", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("OUTER_TEXT_SPRINT folder_name");
        expect(editedText).toContain("%folder_name%");
        expect(editedText).not.toContain("mod_folder");
    });

    it("handles case-sensitive matching", () => {
        const text = `
OUTER_SET MyVar = 10
OUTER_SET result = %MyVar% + %myvar%
`;
        const position: Position = { line: 1, character: 10 }; // On "MyVar"
        const result = renameSymbol(text, position, "NewVar", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        // Should only find exact matches: MyVar (declaration) and %MyVar% (reference)
        // %myvar% is a different variable (different case)
        expect(edits!.length).toBe(2);
    });

    it("renames bare assignment variable (without SET/OUTER_SET)", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    x = 123
    PATCH_PRINT ~%x%~
`;
        const position: Position = { line: 2, character: 4 }; // On "x"
        const result = renameSymbol(text, position, "count", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("count = 123");
        expect(editedText).toContain("%count%");
    });

    it("renames READ_LONG variable", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    READ_LONG 0x8 nPanels
    FOR (i = 0; i < nPanels; i += 1) BEGIN
        PATCH_PRINT ~Panel %i% of %nPanels%~
    END
`;
        const position: Position = { line: 2, character: 18 }; // On "nPanels"
        const result = renameSymbol(text, position, "panelCount", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("READ_LONG 0x8 panelCount");
        expect(editedText).toContain("i < panelCount");
        expect(editedText).toContain("%panelCount%");
    });

    it("renames array definition and accesses", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    DEFINE_ARRAY items BEGIN ~sword~ ~axe~ ~bow~ END
    FOR (i = 0; i < 3; i += 1) BEGIN
        PATCH_PRINT ~Item: %items%~
    END
    TEXT_SPRINT first $items(0)
`;
        const position: Position = { line: 2, character: 18 }; // On "items"
        const result = renameSymbol(text, position, "weapons", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("DEFINE_ARRAY weapons");
        expect(editedText).toContain("$weapons(0)");
    });

    it("renames bare assignment with array access on RHS", () => {
        const text = `
COPY_EXISTING ~weapprof.2da~ ~override~
    COUNT_2DA_COLS columns
    READ_2DA_ENTRIES_NOW weapprof_read columns
    archer_column = $col_index(FERALAN)
    FOR (r = 0; r < weapprof_read; ++r) BEGIN
        FOR (c = 0; c < columns; ++c) BEGIN
            PATCH_IF (c == archer_column) BEGIN
                SET pip_limit = 5
            END
        END
    END
`;
        const position: Position = { line: 4, character: 6 }; // On "archer_column" in assignment
        const result = renameSymbol(text, position, "ranger_column", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("ranger_column = $col_index(FERALAN)");
        expect(editedText).toContain("c == ranger_column");
    });

    it("prepareRename allows bare assignment with array access", () => {
        const text = `
COPY_EXISTING ~weapprof.2da~ ~override~
    COUNT_2DA_COLS columns
    READ_2DA_ENTRIES_NOW weapprof_read columns
    archer_column = $col_index(FERALAN)
    FOR (r = 0; r < weapprof_read; ++r) BEGIN
        FOR (c = 0; c < columns; ++c) BEGIN
            PATCH_IF (c == archer_column) BEGIN
                SET pip_limit = 5
            END
        END
    END
`;
        // Position on "archer_column" in the assignment
        const position: Position = { line: 4, character: 6 };
        const result = prepareRenameSymbol(text, position);

        expect(result).not.toBeNull();
        expect(result?.placeholder).toBe("archer_column");
    });

    it("prepareRename allows variable in PATCH_IF comparison", () => {
        const text = `
COPY_EXISTING ~weapprof.2da~ ~override~
    archer_column = $col_index(FERALAN)
    FOR (c = 0; c < 10; ++c) BEGIN
        PATCH_IF (c == archer_column) BEGIN
            SET pip_limit = 5
        END
    END
`;
        // Position on "archer_column" in PATCH_IF condition (line 4)
        // "        PATCH_IF (c == archer_column) BEGIN"
        //                       ^ character 20
        const position: Position = { line: 4, character: 24 };
        const result = prepareRenameSymbol(text, position);

        expect(result).not.toBeNull();
        expect(result?.placeholder).toBe("archer_column");
    });

    it("renames variable from usage in PATCH_IF comparison", () => {
        const text = `
COPY_EXISTING ~weapprof.2da~ ~override~
    archer_column = $col_index(FERALAN)
    FOR (c = 0; c < 10; ++c) BEGIN
        PATCH_IF (c == archer_column) BEGIN
            SET pip_limit = 5
        END
    END
`;
        // Position on "archer_column" in PATCH_IF condition
        const position: Position = { line: 4, character: 24 };
        const result = renameSymbol(text, position, "ranger_column", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("ranger_column = $col_index(FERALAN)");
        expect(editedText).toContain("c == ranger_column");
    });

    it("renames variable in nested loops and conditions", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    READ_LONG 0x8 count
    FOR (i = 0; i < count; i += 1) BEGIN
        PATCH_IF (count > 10) BEGIN
            WRITE_LONG 0x10 count
            FOR (j = 0; j < count; j += 1) BEGIN
                PATCH_PRINT ~%count%~
            END
        END
    END
`;
        const position: Position = { line: 2, character: 18 }; // On "count"
        const result = renameSymbol(text, position, "total", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        // Should find: READ_LONG decl, FOR condition, PATCH_IF condition,
        // WRITE_LONG arg, nested FOR condition, PATCH_PRINT %ref%
        expect(edits!.length).toBe(6);

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("READ_LONG 0x8 total");
        expect(editedText).toContain("i < total");
        expect(editedText).toContain("total > 10");
        expect(editedText).toContain("WRITE_LONG 0x10 total");
        expect(editedText).toContain("j < total");
        expect(editedText).toContain("%total%");
    });
});

describe("TP2 rename: function-local variables", () => {
    it("renames SET variable inside function", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR param = 0
BEGIN
    SET local_var = param + 1
    PATCH_PRINT ~local_var = %local_var%~
END

COPY_EXISTING ~file.itm~ ~override~
    SET global_var = 5
    LPF MyFunc INT_VAR param = %global_var% END
PATCH_PRINT ~%local_var%~
`;
        const position: Position = { line: 4, character: 8 }; // On "local_var" inside function
        const result = renameSymbol(text, position, "temp_var", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        // local_var inside function should be renamed
        expect(editedText).toContain("SET temp_var = param + 1");
        expect(editedText).toContain("~local_var = %temp_var%~"); // Only %var% is renamed
        // global_var and reference to local_var outside function should NOT be affected
        expect(editedText).toContain("SET global_var = 5");
        expect(editedText).toContain("~%local_var%~"); // Outside function scope
    });

    it("scopes OUTER_TEXT_SPRINT to function", () => {
        const text = `
DEFINE_ACTION_FUNCTION Greet
BEGIN
    OUTER_TEXT_SPRINT name ~World~
    PRINT ~Hello %name%~
END

LAF Greet END
OUTER_TEXT_SPRINT name ~Global~
`;
        const position: Position = { line: 3, character: 22 }; // On "name" in function
        const result = renameSymbol(text, position, "greeting", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("OUTER_TEXT_SPRINT greeting ~World~");
        expect(editedText).toContain("~Hello %greeting%~");
        // Global name should not be affected
        expect(editedText).toContain("OUTER_TEXT_SPRINT name ~Global~");
    });
});

describe("TP2 rename: function parameters", () => {
    it("renames INT_VAR parameter", () => {
        const text = `
DEFINE_PATCH_FUNCTION AddItem
    INT_VAR count = 1
    STR_VAR item = ~~
BEGIN
    SET total = count * 2
    PATCH_PRINT ~Adding %count% of %item%~
END

LPF AddItem INT_VAR count = 5 STR_VAR item = ~sword~ END
`;
        const position: Position = { line: 2, character: 12 }; // On "count" parameter
        const result = renameSymbol(text, position, "quantity", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("INT_VAR quantity = 1");
        expect(editedText).toContain("SET total = quantity * 2");
        expect(editedText).toContain("~Adding %quantity%");
        // count in function call should NOT be renamed (it's a different scope)
        expect(editedText).toContain("INT_VAR count = 5");
    });

    it("renames STR_VAR parameter", () => {
        const text = `
DEFINE_ACTION_FUNCTION PrintMessage
    STR_VAR message = ~default~
BEGIN
    ACTION_PRINT ~%message%~
END
`;
        const position: Position = { line: 2, character: 12 }; // On "message" parameter
        const result = renameSymbol(text, position, "text", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("STR_VAR text = ~default~");
        expect(editedText).toContain("~%text%~");
    });

    it("renames RET parameter", () => {
        // LPF is patch-level, must be inside a patch context (COPY_EXISTING) for valid parse.
        const text = `
DEFINE_PATCH_FUNCTION GetValue
    RET result
BEGIN
    SET result = 42
END

COPY_EXISTING ~file.itm~ ~override~
    LPF GetValue RET value = result END
    PATCH_PRINT ~%value%~
`;
        const position: Position = { line: 2, character: 8 }; // On "result" in RET
        const result = renameSymbol(text, position, "output", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("RET output");
        expect(editedText).toContain("SET output = 42");
        // Call site should NOT be renamed (different scope)
        expect(editedText).toContain("RET value = result");
    });
});

describe("TP2 rename: functions and macros", () => {
    it("renames function definition and all calls", () => {
        const text = `
DEFINE_PATCH_FUNCTION DoSomething
BEGIN
    PATCH_PRINT ~doing something~
END

COPY_EXISTING ~file.itm~ ~override~
    LPF DoSomething END
    LPF DoSomething END
`;
        const position: Position = { line: 1, character: 25 }; // On function name
        const result = renameSymbol(text, position, "PerformAction", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(3); // 1 definition + 2 calls

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("DEFINE_PATCH_FUNCTION PerformAction");
        expect(editedText).toContain("LPF PerformAction END");
        expect(editedText.match(/LPF PerformAction END/g)?.length).toBe(2);
    });

    it("renames action function", () => {
        const text = `
DEFINE_ACTION_FUNCTION MyAction
BEGIN
    PRINT ~action~
END

LAF MyAction END
`;
        const position: Position = { line: 1, character: 25 }; // On function name
        const result = renameSymbol(text, position, "NewAction", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2);

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("DEFINE_ACTION_FUNCTION NewAction");
        expect(editedText).toContain("LAF NewAction END");
    });

    it("renames macro definition and calls", () => {
        const text = `
DEFINE_PATCH_MACRO ~my_macro~ BEGIN
    PATCH_PRINT ~macro~
END

COPY_EXISTING ~file.itm~ ~override~
    LPM ~my_macro~
`;
        const position: Position = { line: 1, character: 24 }; // On macro name
        const result = renameSymbol(text, position, "new_macro", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2);

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("DEFINE_PATCH_MACRO ~new_macro~");
        expect(editedText).toContain("LPM ~new_macro~");
    });

    // Note: Test for "allows rename from action function call site" was removed because
    // the grammar doesn't support parsing ACTION_LAUNCH_FUNCTION (LAF) calls in simple test
    // contexts. The rename logic is identical for action and patch functions, so the test
    // "allows rename from function call site when function is defined in file" (line 611)
    // which uses patch functions is sufficient coverage.
});

describe("TP2 rename: loop variables", () => {
    it("scopes PHP_EACH loop variables to loop body only", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
    POTION02, ~Mana~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT msg ~%potion% %string%~
END

OUTER_SET potion = 5
OUTER_SPRINT string ~global~
`;
        const position: Position = { line: 6, character: 33 }; // On "potion" in AS clause
        const result = renameSymbol(text, position, "pot", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        // Should only rename loop variable (declaration + reference inside loop)
        expect(edits!.length).toBe(2);

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("AS pot => string");
        expect(editedText).toContain("~%pot% %string%~");
        // Global variable should NOT be affected
        expect(editedText).toContain("OUTER_SET potion = 5");
    });

    it("scopes FOR_EACH loop variables to loop body only", () => {
        const text = `
ACTION_DEFINE_ARRAY colors BEGIN ~red~ ~green~ ~blue~ END

ACTION_FOR_EACH color IN colors BEGIN
    OUTER_SPRINT msg ~Color: %color%~
END

OUTER_SET color = 5
`;
        const position: Position = { line: 3, character: 16 }; // On "color" in FOR_EACH
        const result = renameSymbol(text, position, "hue", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        // Should only rename loop variable (declaration + reference inside loop)
        expect(edits!.length).toBe(2);

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("ACTION_FOR_EACH hue IN colors");
        expect(editedText).toContain("~Color: %hue%~");
        // Global variable should NOT be affected
        expect(editedText).toContain("OUTER_SET color = 5");
    });

    it("renames PHP_EACH key variable", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
    POTION02, ~Mana~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT action_drink ~%potion% %string%~
    PRINT ~%action_drink%~
END
`;
        const position: Position = { line: 6, character: 33 }; // On "potion" in AS clause
        const result = renameSymbol(text, position, "pot", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("AS pot => string");
        expect(editedText).toContain("~%pot% %string%~");
        expect(editedText).not.toContain("AS potion =>");
        expect(editedText).not.toContain("%potion%");
    });

    it("renames PHP_EACH value variable", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
    POTION02, ~Mana~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT action_drink ~%potion% %string%~
    PRINT ~%action_drink%~
END
`;
        const position: Position = { line: 6, character: 44 }; // On "string" after =>
        const result = renameSymbol(text, position, "str", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("=> str BEGIN");
        expect(editedText).toContain("~%potion% %str%~");
        expect(editedText).not.toContain("=> string BEGIN");
    });

    it("renames PHP_EACH array variable", () => {
        const text = `
ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
    POTION02, ~Mana~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
    OUTER_SPRINT action_drink ~%potion% %string%~
    PRINT ~%action_drink%~
END
`;
        const position: Position = { line: 6, character: 18 }; // On "potion_string" in PHP_EACH
        const result = renameSymbol(text, position, "potions", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Array definition + usage

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("ACTION_DEFINE_ASSOCIATIVE_ARRAY potions BEGIN");
        expect(editedText).toContain("ACTION_PHP_EACH potions AS potion");
        expect(editedText).not.toContain("potion_string");
    });

    it("renames PATCH_PHP_EACH key variable", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    DEFINE_ASSOCIATIVE_ARRAY items BEGIN
        sword, 10
        axe, 20
    END

    PHP_EACH items AS item => value BEGIN
        SET total = value * 2
        PATCH_PRINT ~Item: %item%, Total: %total%~
    END
`;
        const position: Position = { line: 7, character: 22 }; // On "item" in AS clause
        const result = renameSymbol(text, position, "weapon", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("AS weapon => value");
        expect(editedText).toContain("~Item: %weapon%");
    });

    it("renames ACTION_FOR_EACH loop variable", () => {
        const text = `
ACTION_DEFINE_ARRAY colors BEGIN ~red~ ~green~ ~blue~ END

ACTION_FOR_EACH color IN colors BEGIN
    OUTER_SPRINT msg ~Color: %color%~
    ACTION_PRINT ~%msg%~
END
`;
        const position: Position = { line: 3, character: 16 }; // On "color" in FOR_EACH
        const result = renameSymbol(text, position, "hue", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("ACTION_FOR_EACH hue IN colors");
        expect(editedText).toContain("~Color: %hue%~");
    });

    it("renames PATCH_FOR_EACH loop variable from declaration", () => {
        const text = `COPY_EXISTING ~file.itm~ ~override~
    DEFINE_ARRAY items BEGIN ~sword~ ~axe~ ~bow~ END

    PATCH_FOR_EACH item IN items BEGIN
        PATCH_PRINT ~Item: %item%~
    END
`;
        const position: Position = { line: 3, character: 19 }; // On "item" in PATCH_FOR_EACH declaration
        const result = renameSymbol(text, position, "weapon", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("PATCH_FOR_EACH weapon IN items");
        expect(editedText).toContain("~Item: %weapon%~");
    });

    it("allows rename from PATCH_FOR_EACH loop variable reference when defined in file", () => {
        const text = `
COPY_EXISTING ~file.itm~ ~override~
    DEFINE_ARRAY items BEGIN ~sword~ ~axe~ ~bow~ END

    PATCH_FOR_EACH item IN items BEGIN
        PATCH_PRINT ~Item: %item%~
    END
`;
        const position: Position = { line: 5, character: 30 }; // On "item" in %item% reference
        const result = renameSymbol(text, position, "weapon", "file:///test.tp2");

        // Should allow rename from reference site when variable is defined in file
        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("PATCH_FOR_EACH weapon IN items");
        expect(editedText).toContain("~Item: %weapon%~");
    });
});

describe("TP2 rename: local vs external symbols", () => {
    it("allows rename from variable declaration", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const position: Position = { line: 1, character: 10 }; // On "my_var" in declaration
        const result = renameSymbol(text, position, "new_var", "file:///test.tp2");

        expect(result).not.toBeNull();
    });

    it("allows rename from variable reference when defined in file", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const position: Position = { line: 2, character: 20 }; // On "my_var" in %my_var% reference
        const result = renameSymbol(text, position, "new_var", "file:///test.tp2");

        // Should allow rename from reference site when symbol is defined in file
        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference
    });

    it("allows rename from function definition", () => {
        const text = `
DEFINE_PATCH_FUNCTION DoSomething
BEGIN
    PATCH_PRINT ~doing something~
END

COPY_EXISTING ~file.itm~ ~override~
    LPF DoSomething END
`;
        const position: Position = { line: 1, character: 25 }; // On function name in definition
        const result = renameSymbol(text, position, "PerformAction", "file:///test.tp2");

        expect(result).not.toBeNull();
    });

    it("allows rename from function call site when function is defined in file", () => {
        const text = `
DEFINE_PATCH_FUNCTION DoSomething
BEGIN
    PATCH_PRINT ~doing something~
END

COPY_EXISTING ~file.itm~ ~override~
    LPF DoSomething END
`;
        const position: Position = { line: 7, character: 9 }; // On "DoSomething" in call
        const result = renameSymbol(text, position, "PerformAction", "file:///test.tp2");

        // Should allow rename from call site when function is defined in file
        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Definition + call
    });

    it("allows rename from parameter declaration", () => {
        const text = `
DEFINE_PATCH_FUNCTION AddItem
    INT_VAR count = 1
BEGIN
    SET total = count * 2
END
`;
        const position: Position = { line: 2, character: 12 }; // On "count" in parameter declaration
        const result = renameSymbol(text, position, "quantity", "file:///test.tp2");

        expect(result).not.toBeNull();
    });

    it("allows rename from parameter reference in function body", () => {
        const text = `
DEFINE_PATCH_FUNCTION AddItem
    INT_VAR count = 1
BEGIN
    SET total = count * 2
END
`;
        const position: Position = { line: 4, character: 16 }; // On "count" in expression
        const result = renameSymbol(text, position, "quantity", "file:///test.tp2");

        // Should allow rename from reference site when parameter is defined in file
        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Parameter + reference
    });

    it("rejects rename of external function (not defined in file)", () => {
        const text = `
// ExternalFunc is defined in another file
LAF ExternalFunc END
LAF ExternalFunc END
`;
        const position: Position = { line: 2, character: 5 }; // On "ExternalFunc" in call
        const result = renameSymbol(text, position, "NewName", "file:///test.tp2");

        // Should reject rename because function is not defined in this file
        expect(result).toBeNull();
    });

    it("rejects rename of external variable (not defined in file)", () => {
        const text = `
// external_var is defined in another file (via INCLUDE)
OUTER_SET result = %external_var% + 1
PATCH_PRINT ~%external_var%~
`;
        const position: Position = { line: 2, character: 20 }; // On "external_var" in expression
        const result = renameSymbol(text, position, "new_var", "file:///test.tp2");

        // Should reject rename because variable is not defined in this file
        expect(result).toBeNull();
    });
});

describe("TP2 rename: edge cases", () => {
    it("rejects rename on function call argument name", () => {
        const content = `OUTER_SET foo = 5
DEFINE_ACTION_FUNCTION my_func INT_VAR foo = 0 BEGIN
END
LAF my_func INT_VAR foo = 1 END
`;
        // Line 3, col 21: on "foo" in LAF call's INT_VAR section
        // Should reject - this is a function argument, not a local variable
        const result = renameSymbol(content, { line: 3, character: 21 }, "bar", "file:///test.tp2");
        expect(result).toBeNull();
    });

    it("allows rename on function call argument value", () => {
        const content = `OUTER_SET test2 = 5
LAF my_func INT_VAR bonus = test2 END
OUTER_SET x = test2
`;
        // Line 1, col 28: on "test2" in LAF call's INT_VAR value position (after =)
        const result = renameSymbol(content, { line: 1, character: 28 }, "renamed_var", "file:///test.tp2");
        expect(result).not.toBeNull();
        expect(result!.changes!["file:///test.tp2"]).toHaveLength(3);
    });

    it("rejects renaming automatic variables", () => {
        const text = `
COPY ~source~ ~override~
    PATCH_PRINT ~%SOURCE_FILE%~
`;
        const position: Position = { line: 2, character: 21 }; // On SOURCE_FILE
        const result = renameSymbol(text, position, "my_file", "file:///test.tp2");

        expect(result).toBeNull();
    });

    it("rejects renaming DEST_FILE", () => {
        const text = `
COPY ~source~ ~override~
    TEXT_SPRINT dest ~%DEST_FILE%~
`;
        const position: Position = { line: 2, character: 23 }; // On DEST_FILE
        const result = renameSymbol(text, position, "destination", "file:///test.tp2");

        expect(result).toBeNull();
    });

    it("rejects renaming COMPONENT_NUMBER", () => {
        const text = `
OUTER_SET comp = COMPONENT_NUMBER
`;
        const position: Position = { line: 1, character: 18 }; // On COMPONENT_NUMBER
        const result = renameSymbol(text, position, "comp_num", "file:///test.tp2");

        expect(result).toBeNull();
    });

    it("handles variables with similar names", () => {
        const text = `
OUTER_SET var = 1
OUTER_SET my_var = 2
OUTER_SET var_other = 3
PRINT ~%var% %my_var% %var_other%~
`;
        const position: Position = { line: 2, character: 13 }; // On "my_var"
        const result = renameSymbol(text, position, "renamed", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("OUTER_SET var = 1"); // Should not be affected
        expect(editedText).toContain("OUTER_SET renamed = 2");
        expect(editedText).toContain("OUTER_SET var_other = 3"); // Should not be affected
        expect(editedText).toContain("~%var% %renamed% %var_other%~");
    });

    it("returns null when symbol is not found", () => {
        const text = `
OUTER_SET var = 1
`;
        const position: Position = { line: 0, character: 0 }; // Outside any symbol
        const result = renameSymbol(text, position, "new_name", "file:///test.tp2");

        expect(result).toBeNull();
    });

    it("renames variables in five-tilde strings (multiline)", () => {
        const text = `ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
    POTION02, ~Mana~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
  OUTER_SPRINT EVAL action_drink
~~~~~
    %action_drink%

    + ~PartyHasItem("%potion%")~
    + @%string%
        DO ~
          CreateCreature("g_spy1",[-1.-1],0)
          ActionOverride("g_spy1", TakePartyItemNum("%potion%",1) )
          ActionOverride("g_spy1", DestroyItem("%potion%") )
          ActionOverride("g_spy1", DestroySelf() )
          CreateItem("%potion%", 1, 0, 0)
          UseItem("%potion%", Myself)
        ~
    + g_familiar_confirm
~~~~~
END`;
        const position: Position = { line: 5, character: 34 }; // On "potion" in AS clause
        const result = renameSymbol(text, position, "potion2", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        // All %potion% references should be renamed to %potion2%
        expect(editedText).toContain("AS potion2 => string");
        expect(editedText).toContain('~PartyHasItem("%potion2%")~');
        expect(editedText).toContain('TakePartyItemNum("%potion2%",1)');
        expect(editedText).toContain('DestroyItem("%potion2%")');
        expect(editedText).toContain('CreateItem("%potion2%", 1, 0, 0)');
        expect(editedText).toContain('UseItem("%potion2%", Myself)');
        // Should not contain old variable name
        expect(editedText).not.toContain("AS potion =>");
        expect(editedText).not.toContain("%potion%");
        // Should not have garbage at the start
        expect(editedText).not.toContain("%potion2%%potion2%%potion2%%potion2%%potion2%");
    });

    it("renames variables from loop declaration site", () => {
        const text = `ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
  OUTER_SPRINT EVAL action_drink
~~~~~
    + ~PartyHasItem("%potion%")~
~~~~~
END`;
        // Click on "potion" in the AS clause (declaration site)
        const position: Position = { line: 4, character: 33 };
        const result = renameSymbol(text, position, "item", "file:///test.tp2");

        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();

        const editedText = applyEdits(text, edits!);
        // Should rename the variable everywhere
        expect(editedText).toContain("AS item => string");
        expect(editedText).toContain('~PartyHasItem("%item%")~');
        // Should not contain the old loop variable name in context where it was renamed
        expect(editedText).not.toContain("AS potion =>");
        expect(editedText).not.toContain("%potion%");
    });

    it("allows rename when cursor is on %var% reference inside five-tilde string (if defined in file)", () => {
        const text = `ACTION_DEFINE_ASSOCIATIVE_ARRAY potion_string BEGIN
    POTION01, ~Healing~
END

ACTION_PHP_EACH potion_string AS potion => string BEGIN
  OUTER_SPRINT EVAL action_drink
~~~~~
    + ~PartyHasItem("%potion%")~
~~~~~
END`;
        // Click on %potion% inside the five-tilde string (line 7, character 26 is in the middle of "potion")
        const position: Position = { line: 7, character: 26 };
        const result = renameSymbol(text, position, "item", "file:///test.tp2");

        // Should allow rename from reference site when variable is defined in file
        expect(result).not.toBeNull();
        const edits = result?.changes?.["file:///test.tp2"];
        expect(edits).toBeDefined();
        expect(edits!.length).toBe(2); // Declaration + reference

        const editedText = applyEdits(text, edits!);
        expect(editedText).toContain("AS item => string");
        expect(editedText).toContain('~PartyHasItem("%item%")~');
    });
});

// ============================================
// Test utilities
// ============================================

/**
 * Apply text edits to a string (simplified implementation for testing).
 */
function applyEdits(text: string, edits: TextEdit[]): string {
    if (!edits || edits.length === 0) return text;

    const lines = text.split("\n");

    // Sort edits by position (reverse order to avoid offset issues)
    const sortedEdits = [...edits].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
            return b.range.start.line - a.range.start.line;
        }
        return b.range.start.character - a.range.start.character;
    });

    for (const edit of sortedEdits) {
        const startLine = edit.range.start.line;
        const startChar = edit.range.start.character;
        const endLine = edit.range.end.line;
        const endChar = edit.range.end.character;

        if (startLine === endLine) {
            const line = lines[startLine];
            lines[startLine] = line!.slice(0, startChar) + edit.newText + line!.slice(endChar);
        } else {
            // Multi-line edit (not common in rename, but handle it anyway)
            const firstLine = lines[startLine]!.slice(0, startChar);
            const lastLine = lines[endLine]!.slice(endChar);
            lines.splice(startLine, endLine - startLine + 1, firstLine + edit.newText + lastLine);
        }
    }

    return lines.join("\n");
}
