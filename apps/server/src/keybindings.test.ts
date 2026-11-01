import { KeybindingCommand, KeybindingRule, KeybindingsConfig } from "@supaterm/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as SharedKeybindings from "@supaterm/shared/keybindings";
import { KeybindingsConfigError } from "@supaterm/contracts";

const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);
const encodeKeybindingsConfigJson = Schema.encodeEffect(KeybindingsConfigJson);
const decodeKeybindingsConfigJson = Schema.decodeUnknownEffect(KeybindingsConfigJson);
const layerKeybindings = () => {
  return Keybindings.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "supaterm-keybindings-test-",
        }),
      ),
    ),
  );
};

const toDetailResult = <A, R>(effect: Effect.Effect<A, KeybindingsConfigError, R>) =>
  effect.pipe(
    Effect.mapError((error) => error.detail),
    Effect.result,
  );

const writeKeybindingsConfig = (configPath: string, rules: readonly KeybindingRule[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const encoded = yield* encodeKeybindingsConfigJson(rules);
    yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fileSystem.writeFileString(configPath, encoded);
  });

const readKeybindingsConfig = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const rawConfig = yield* fileSystem.readFileString(configPath);
    return yield* decodeKeybindingsConfigJson(rawConfig);
  });

it.layer(NodeServices.layer)("keybindings", (it) => {
  it.effect("parses shortcuts including plus key", () =>
    Effect.sync(() => {
      assert.deepEqual(SharedKeybindings.parseKeybindingShortcut("mod+j"), {
        key: "j",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
      assert.deepEqual(SharedKeybindings.parseKeybindingShortcut("mod++"), {
        key: "+",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
    }),
  );

  it.effect("compiles valid rule with parsed when AST", () =>
    Effect.sync(() => {
      const compiled = SharedKeybindings.compileResolvedKeybindingRule({
        key: "mod+d",
        command: "terminal.split",
        when: "terminalOpen && !terminalFocus",
      });

      assert.deepEqual(compiled, {
        command: "terminal.split",
        shortcut: {
          key: "d",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
        whenAst: {
          type: "and",
          left: { type: "identifier", name: "terminalOpen" },
          right: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      });
    }),
  );

  it.effect("rejects invalid rules", () =>
    Effect.sync(() => {
      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+shift+d+o",
          command: "terminal.new",
        }),
      );

      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+d",
          command: "terminal.split",
          when: "terminalFocus && (",
        }),
      );

      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+d",
          command: "terminal.split",
          when: `${"!".repeat(300)}terminalFocus`,
        }),
      );
    }),
  );

  it.effect("bootstraps default keybindings when config file is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      assert.isFalse(yield* fs.exists(keybindingsConfigPath));

      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.syncDefaultKeybindingsOnStartup;
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(persisted, SharedKeybindings.DEFAULT_KEYBINDINGS);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("uses defaults in runtime when config is malformed without overriding file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(keybindingsConfigPath, "{ not-json");

      const configState = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.loadConfigState;
      });

      assert.deepEqual(
        configState.keybindings,
        SharedKeybindings.compileResolvedKeybindingsConfig(SharedKeybindings.DEFAULT_KEYBINDINGS),
      );
      assert.deepEqual(configState.issues, [
        {
          kind: "keybindings.malformed-config",
          message: configState.issues[0]?.message ?? "",
        },
      ]);
      assert.equal(yield* fs.readFileString(keybindingsConfigPath), "{ not-json");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("ignores invalid entries in runtime and reports them as issues", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify([
          { key: "mod+j", command: "terminal.toggle" },
          { key: "mod+shift+d+o", command: "terminal.new" },
          { key: "mod+x", command: "invalid.command" },
        ]),
      );

      const configState = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.loadConfigState;
      });

      assert.isTrue(configState.keybindings.some((entry) => entry.command === "terminal.toggle"));
      assert.isFalse(
        configState.keybindings.some((entry) => String(entry.command) === "invalid.command"),
      );
      assert.deepEqual(configState.issues, [
        {
          kind: "keybindings.invalid-entry",
          index: 1,
          message: configState.issues[0]?.message ?? "",
        },
        {
          kind: "keybindings.invalid-entry",
          index: 2,
          message: configState.issues[1]?.message ?? "",
        },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect(
    "upserts missing default keybindings on startup without overriding existing command rules",
    () =>
      Effect.gen(function* () {
        const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
        yield* writeKeybindingsConfig(keybindingsConfigPath, [
          { key: "mod+shift+y", command: "terminal.toggle" },
          { key: "mod+shift+r", command: "script.run-tests.run" },
          { key: "mod+shift+b", command: "script.custom-panel.run" },
          {
            key: "mod+shift+b",
            command: "script.custom-composer.run",
            when: "composerFocus",
          },
        ]);

        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.syncDefaultKeybindingsOnStartup;

        const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
        const byCommand = new Map(persisted.map((entry) => [entry.command, entry]));

        const persistedToggle = byCommand.get("terminal.toggle");
        assert.isNotNull(persistedToggle);
        assert.equal(persistedToggle?.key, "mod+shift+y");
        assert.isFalse(
          persisted.some((entry) => entry.command === "terminal.toggle" && entry.key === "mod+j"),
        );

        for (const defaultRule of SharedKeybindings.DEFAULT_KEYBINDINGS) {
          assert.isTrue(byCommand.has(defaultRule.command), `expected ${defaultRule.command}`);
        }
        assert.isTrue(byCommand.has("script.run-tests.run"));

        const configState = yield* keybindings.loadConfigState;
        assert.deepEqual(
          configState.keybindings
            .filter((entry) => entry.shortcut.key === "b" && entry.shortcut.shiftKey)
            .map((entry) => entry.command),
          ["threadPanel.toggle", "script.custom-panel.run", "script.custom-composer.run"],
        );
      }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("upgrades saved mark Done and voice defaults once without touching others", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const previousDefaults: Partial<Record<KeybindingRule["command"], string>> = {
        "thread.mark-done": "mod+shift+s",
        "composer.voice": "mod+shift+space",
      };
      yield* writeKeybindingsConfig(
        keybindingsConfigPath,
        SharedKeybindings.DEFAULT_KEYBINDINGS.map((rule) => ({
          ...rule,
          key: previousDefaults[rule.command] ?? rule.key,
        })),
      );

      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.syncDefaultKeybindingsOnStartup;
      assert.deepEqual(
        yield* readKeybindingsConfig(keybindingsConfigPath),
        SharedKeybindings.DEFAULT_KEYBINDINGS,
      );

      const snapshot = yield* keybindings.getSnapshot;
      assert.equal(
        snapshot.keybindings.find((rule) => rule.command === "thread.mark-done")?.shortcut.key,
        "d",
      );
      assert.deepInclude(
        snapshot.keybindings.find((rule) => rule.command === "composer.voice")?.shortcut,
        { key: "m", ctrlKey: true, modKey: false, shiftKey: false },
      );

      yield* keybindings.syncDefaultKeybindingsOnStartup;
      assert.deepEqual(
        yield* readKeybindingsConfig(keybindingsConfigPath),
        SharedKeybindings.DEFAULT_KEYBINDINGS,
      );

      yield* keybindings.upsertKeybindingRule({
        key: "mod+shift+s",
        command: "thread.mark-done",
        when: "!terminalFocus",
        replace: {
          key: "mod+shift+d",
          command: "thread.mark-done",
          when: "!terminalFocus",
        },
      });
      const customized = yield* readKeybindingsConfig(keybindingsConfigPath);
      yield* Effect.gen(function* () {
        const restarted = yield* Keybindings.Keybindings;
        yield* restarted.syncDefaultKeybindingsOnStartup;
        assert.deepEqual(yield* readKeybindingsConfig(keybindingsConfigPath), customized);
        const restartedSnapshot = yield* restarted.getSnapshot;
        assert.equal(
          restartedSnapshot.keybindings.find((rule) => rule.command === "thread.mark-done")
            ?.shortcut.key,
          "s",
        );
      }).pipe(Effect.provide(Layer.fresh(Keybindings.layer)));
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect.each<readonly KeybindingRule[]>([
    [{ key: "mod+alt+d", command: "thread.mark-done", when: "!terminalFocus" }],
    [{ key: "mod+shift+s", command: "thread.mark-done", when: "composerFocus" }],
    [
      { key: "mod+shift+s", command: "thread.mark-done", when: "!terminalFocus" },
      { key: "mod+alt+d", command: "thread.mark-done" },
    ],
    ...["shift+mod+d", "cmd+shift+d", "ctrl+shift+d"].map((key): readonly KeybindingRule[] => [
      { key: "mod+shift+s", command: "thread.mark-done", when: "!terminalFocus" },
      { key, command: "script.custom-action.run" },
    ]),
    // Off macOS, mod+m is Ctrl+M.
    ...["ctrl+m", "mod+m"].map((key): readonly KeybindingRule[] => [
      { key: "mod+shift+space", command: "composer.voice", when: "!terminalFocus" },
      { key, command: "script.custom-action.run" },
    ]),
  ])("preserves customized or conflicting moved default shortcuts on startup %#", (rules) =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, rules);
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.syncDefaultKeybindingsOnStartup;
      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const commands = new Set(rules.map((rule) => rule.command));
      assert.deepEqual(
        persisted.filter((rule) => commands.has(rule.command)),
        rules,
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("skips conflicting default keybindings on startup and logs a detailed warning", () => {
    const messages: string[] = [];
    const logger = Logger.make(({ message }) => {
      messages.push(String(message));
    });

    return Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+j", command: "script.custom-action.run" },
      ]);

      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.syncDefaultKeybindingsOnStartup;
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.isFalse(persisted.some((entry) => entry.command === "terminal.toggle"));
      assert.isTrue(persisted.some((entry) => entry.command === "script.custom-action.run"));

      assert.isTrue(
        messages.some((message) =>
          message.includes("skipping default keybinding due to shortcut conflict"),
        ),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(layerKeybindings(), Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("appends additional custom keybindings for the same command", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replaces only the targeted custom keybinding", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "mod+r", command: "script.run-tests.run" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "mod+alt+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replacing with a rule that already exists elsewhere does not duplicate it", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+alt+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "mod+r", command: "script.run-tests.run" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+alt+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("removes only the targeted custom keybinding", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.removeKeybindingRule({
          key: "mod+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+shift+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("keeps entries it cannot decode when editing other keybindings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const futureCommand = { key: "mod+shift+k", command: "command.from-a-newer-build" };
      const badShortcut = { key: "mod+shift+d+o", command: "terminal.new" };
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify([
          { key: "mod+r", command: "script.run-tests.run" },
          futureCommand,
          badShortcut,
        ]),
      );
      const keybindings = yield* Keybindings.Keybindings;
      const persisted = Effect.map(fs.readFileString(keybindingsConfigPath), JSON.parse);

      const saved = yield* keybindings.upsertKeybindingRule({
        key: "mod+shift+r",
        command: "script.run-tests.run",
      });
      assert.equal(saved.issues.length, 2);
      assert.deepEqual(yield* persisted, [
        { key: "mod+r", command: "script.run-tests.run" },
        futureCommand,
        badShortcut,
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);

      const removed = yield* keybindings.removeKeybindingRule({
        key: "mod+r",
        command: "script.run-tests.run",
      });
      assert.deepEqual(yield* persisted, [
        futureCommand,
        badShortcut,
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      const { issues } = yield* keybindings.loadConfigState;
      assert.deepEqual(removed.issues, issues);
      assert.deepEqual(
        issues.map((issue) => issue.kind === "keybindings.invalid-entry" && issue.index),
        [0, 1],
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("removes a hand-written keybinding targeted by its settings spelling", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        {
          key: "Shift+Cmd+R",
          command: "script.run-tests.run",
          when: "terminalFocus&&!previewFocus",
        },
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "x\u0000true", command: "script.run-tests.run" },
        { key: "x", command: "script.run-tests.run", when: "true" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.removeKeybindingRule({
          key: "meta+shift+r",
          command: "script.run-tests.run",
          when: "terminalFocus && !previewFocus",
        });
        yield* keybindings.removeKeybindingRule({
          key: "x",
          command: "script.run-tests.run",
          when: "true",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(persisted, [
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "x\u0000true", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replaces a hand-written keybinding targeted by its settings spelling", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "escape", command: "script.run-tests.run", when: "a && b && c" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "esc", command: "script.run-tests.run", when: "(a && b) && c" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(persisted, [{ key: "mod+alt+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("refuses to overwrite malformed keybindings config", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(keybindingsConfigPath, "{ not-json");

      const result = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(result, "expected JSON array");

      const persistedRaw = yield* fs.readFileString(keybindingsConfigPath);
      assert.equal(persistedRaw, "{ not-json");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("retries a failed config read instead of keeping the failure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fileSystem.makeDirectory(keybindingsConfigPath, { recursive: true });

      const keybindings = yield* Keybindings.Keybindings;
      const failed = yield* toDetailResult(keybindings.loadConfigState);
      assertFailure(failed, "failed to read keybindings config");

      yield* fileSystem.remove(keybindingsConfigPath, { recursive: true });
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);

      const configState = yield* keybindings.loadConfigState;
      assert.deepEqual(configState.issues, []);
      assert.isTrue(configState.keybindings.some((entry) => entry.command === "terminal.toggle"));
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("serializes concurrent upserts to avoid lost updates", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, []);

      const commands = Array.from(
        { length: 20 },
        (_, index): KeybindingCommand => `script.concurrent-${index}.run`,
      );
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* Effect.forEach(
          commands,
          (command, index) =>
            keybindings.upsertKeybindingRule({
              key: `mod+${String.fromCharCode(97 + index)}`,
              command,
            }),
          { concurrency: "unbounded", discard: true },
        );
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedCommands = new Set(persisted.map((entry) => entry.command));
      for (const command of commands) {
        assert.isTrue(persistedCommands.has(command), `expected persisted command ${command}`);
      }
    }).pipe(Effect.provide(layerKeybindings())),
  );
});
