import { assert, describe, expect, it } from "vite-plus/test";
import type { ResolvedKeybindingsConfig } from "@supaterm/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingShortcut,
} from "@supaterm/shared/keybindings";

import { resolveShortcutCommand } from "../../keybindings";

import {
  buildKeybindingRows,
  buildKeybindingCommandOptions,
  commandLabel,
  filterKeybindingRows,
  groupKeybindingRows,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  unknownWhenVariables,
  whenAstToExpression,
} from "./KeybindingsSettings.logic";

describe("KeybindingsSettings.logic", () => {
  it("groups rows by command area in page order and drops empty groups", () => {
    const groups = groupKeybindingRows(buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS));
    expect(groups.map((group) => group.title)).toEqual([
      "Navigation",
      "Threads",
      "Chat panes",
      "Composer",
      "Terminal",
      "Preview & diff",
      "Appearance",
      "Other",
    ]);
    const composer = groups.find((group) => group.id === "composer");
    expect(composer?.rows.map((row) => row.command)).toEqual(
      expect.arrayContaining(["composer.host", "modelPicker.toggle"]),
    );
    expect(
      groupKeybindingRows(
        filterKeybindingRows(buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS), "split"),
      ),
    ).toEqual([expect.objectContaining({ id: "terminal" })]);
  });

  it("keeps sibling row identities when a saved binding moves to the end", () => {
    const bindings = compileResolvedKeybindingsConfig([
      { command: "chat.new", key: "mod+n" },
      { command: "terminal.toggle", key: "mod+j" },
      { command: "terminal.toggle", key: "mod+k", when: "terminalFocus" },
    ]);
    const before = buildKeybindingRows(bindings);
    const after = buildKeybindingRows([
      ...bindings.slice(1),
      ...compileResolvedKeybindingsConfig([{ command: "chat.new", key: "mod+shift+n" }]),
    ]);

    expect(after.filter((row) => row.command === "terminal.toggle").map((row) => row.id)).toEqual(
      before.filter((row) => row.command === "terminal.toggle").map((row) => row.id),
    );
    expect(after.find((row) => row.command === "chat.new")?.id).not.toBe(
      before.find((row) => row.command === "chat.new")?.id,
    );
  });

  it("shares a stable editor for resolved duplicates but separates commands, shortcuts, and conditions", () => {
    const bindings = compileResolvedKeybindingsConfig([
      { command: "terminal.toggle", key: "mod+esc", when: "terminalFocus" },
      { command: "terminal.toggle", key: "mod+escape", when: "(terminalFocus)" },
      { command: "terminal.toggle", key: "mod+esc", when: "!terminalFocus" },
      { command: "terminal.toggle", key: "mod+j", when: "terminalFocus" },
      { command: "chat.new", key: "mod+esc", when: "terminalFocus" },
    ]);
    const rows = buildKeybindingRows(bindings);
    expect(rows.map(({ command, key, when }) => ({ command, key, when }))).toEqual([
      { command: "chat.new", key: "mod+esc", when: "terminalFocus" },
      { command: "terminal.toggle", key: "mod+esc", when: "terminalFocus" },
      { command: "terminal.toggle", key: "mod+esc", when: "!terminalFocus" },
      { command: "terminal.toggle", key: "mod+j", when: "terminalFocus" },
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(4);
    expect(rows.find((row) => row.command === "chat.new")?.conflicts).toEqual(["Terminal: Toggle"]);
    expect(buildKeybindingRows(bindings.slice(1)).map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
  });

  it("captures platform-specific mod shortcuts", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("mod+shift+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        "Win32",
      ),
    ).toBe("mod+shift+k");
  });

  it("waits for a key when only a modifier is pressed", () => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key: "Meta",
          code: "MetaLeft",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBeNull();
  });

  it.each([
    ["@", "Digit2", "mod+shift+2"],
    ['"', "Digit2", "mod+shift+2"],
    ["@", "Quote", "mod+shift+'"],
  ])("captures %s at %s by physical key", (key, code, expected) => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key,
          code,
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toBe(expected);
  });

  it("records layout punctuation while preserving physical Alt shortcuts; saved bindings still trigger", () => {
    for (const { key, code, altKey = false, shiftKey, expected, defaultInput } of [
      { key: "#", code: "Backslash", shiftKey: false, expected: "#", defaultInput: "\\" },
      {
        key: "'",
        code: "Backslash",
        shiftKey: true,
        expected: "shift+'",
        defaultInput: "shift+\\",
      },
      {
        key: "¡",
        code: "Digit1",
        altKey: true,
        shiftKey: false,
        expected: "alt+1",
        defaultInput: "alt+1",
      },
    ]) {
      const pressed = {
        key,
        code,
        metaKey: false,
        ctrlKey: false,
        altKey,
        shiftKey,
      };
      expect(keybindingFromKeyboardEvent(pressed, "MacIntel")).toBe(defaultInput);
      const input = keybindingFromKeyboardEvent(pressed, "MacIntel", { layoutCharacter: true });
      expect(input).toBe(expected);
      assert(input);
      const shortcut = parseKeybindingShortcut(input);
      assert(shortcut);
      expect(
        resolveShortcutCommand(pressed, [{ command: "chat.new", shortcut }], {
          platform: "MacIntel",
        }),
      ).toBe("chat.new");
    }
  });

  it("captures Latin layout keys instead of their punctuation position", () => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key: "m",
          code: "Semicolon",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe("mod+m");
  });

  it("serializes shortcuts and when expressions for upserts", () => {
    expect(
      shortcutToKeybindingInput({
        key: " ",
        modKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("mod+alt+space");

    expect(
      whenAstToExpression({
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      }),
    ).toBe("editorFocus && !terminalFocus");

    expect(parseWhenExpressionDraft("editorFocus && (!terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "or",
          left: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
    expect(parseWhenExpressionDraft("editorFocus &&")).toEqual({
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    });

    expect(parseWhenExpressionDraft("!(terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "not",
        node: {
          type: "or",
          left: { type: "identifier", name: "terminalFocus" },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
  });

  it("formats static and project script command labels", () => {
    expect(commandLabel("commandPalette.toggle")).toBe("Command Palette: Toggle");
    expect(commandLabel("themeEditor.toggle")).toBe("Theme Editor: Toggle");
    expect(commandLabel("view.reopenClosed")).toBe("Reopen Closed Tab or Pane");
    expect(commandLabel("preview.focusUrl")).toBe("Preview: Focus URL");
    expect(commandLabel("script.setup-db.run")).toBe("Run Script: Setup Db");
  });

  it("builds command options from all static commands and resolved project bindings", () => {
    const options = buildKeybindingCommandOptions([
      {
        command: "script.setup-db.run",
        shortcut: {
          key: "r",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(options).toEqual(
      expect.arrayContaining([
        "chat.new",
        "threadPanel.toggle",
        "rightPanel.toggleMaximized",
        "composer.cycleHost",
        "thread.stop",
        "usage.open",
        "script.setup-db.run",
      ]),
    );
    expect(
      DEFAULT_RESOLVED_KEYBINDINGS.some((binding) => binding.command === "composer.cycleHost"),
    ).toBe(false);
  });

  it("reports unknown when variables without rejecting parseable expressions", () => {
    const parsed = parseWhenExpressionDraft("!terminalFocus && terminalFoc");

    expect(parsed.ok).toBe(true);
    expect(unknownWhenVariables(parsed.ok ? parsed.value : undefined)).toEqual(["terminalFoc"]);
  });

  it("marks the new-thread shortcuts as default", () => {
    const rows = buildKeybindingRows([
      {
        command: "chat.newLocal",
        shortcut: {
          key: "n",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
      {
        command: "chat.new",
        shortcut: {
          key: "o",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(rows.map((row) => row.source)).toEqual(["Default", "Default"]);
  });

  it("reports conflicting shortcuts that share an active when context", () => {
    const rows = buildKeybindingRows([
      {
        command: "chat.new",
        shortcut: {
          key: "n",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
      {
        command: "chat.newLocal",
        shortcut: {
          key: "n",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(rows[0]?.conflicts).toEqual(["Chat: New Local"]);
    expect(
      keybindingConflictLabels(rows, {
        rowId: rows[0]?.id ?? "",
        key: "mod+n",
        when: "",
      }),
    ).toEqual(["Chat: New Local"]);
  });
});
