import {
  BranchNamingMode,
  DEFAULT_SERVER_SETTINGS,
  PullRequestMergeMethod,
  ResponseStreamingMode,
  RuntimeMode,
  ServerSettingsPatch,
  ThreadEnvMode,
  WorktreeSubmodules,
} from "@supaterm/contracts";
import { resolveWorktreeSupatermHome } from "@supaterm/shared/devHome";
import { fromJsonStringPretty } from "@supaterm/shared/schemaJson";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import { baseDirFlag } from "./config.ts";
import { editSettingsObject, readSettingsObject, resolveSettingsPaths } from "./settingsFile.ts";

const BOOLEAN_SETTING = { kind: "boolean", expected: "true or false" } as const;
const STRING_SETTING = { kind: "string", expected: "a string" } as const;
const SETTABLE_SETTINGS = {
  publicRelayEnabled: BOOLEAN_SETTING,
  publicRelayUrl: { kind: "string", expected: "a ws:// or wss:// URL" },
  pushNotificationsEnabled: BOOLEAN_SETTING,
  responseStreamingMode: { kind: "string", expected: ResponseStreamingMode.literals.join(" | ") },
  enableProviderUpdateChecks: BOOLEAN_SETTING,
  continueThreadsAfterServerUpdate: BOOLEAN_SETTING,
  enableAgentBrowserAccess: BOOLEAN_SETTING,
  defaultAutoPull: BOOLEAN_SETTING,
  defaultRuntimeMode: { kind: "string", expected: RuntimeMode.literals.join(" | ") },
  enableAgentDeviceAccess: BOOLEAN_SETTING,
  enableDeviceSupport: BOOLEAN_SETTING,
  sidebarAutoMarkDoneAfterDays: {
    kind: "number-or-null",
    expected: "a number from 1 to 90 or null",
  },
  sidebarAutoMarkDoneOnMerge: BOOLEAN_SETTING,
  sidebarAutoMarkDoneKeepPullRequests: BOOLEAN_SETTING,
  autoResumeLimitedThreads: BOOLEAN_SETTING,
  snoozeLimitedThreads: BOOLEAN_SETTING,
  defaultThreadEnvMode: {
    kind: "string-or-null",
    expected: [...ThreadEnvMode.literals, "null"].join(" | "),
  },
  newWorktreesStartFromOrigin: BOOLEAN_SETTING,
  worktreeSubmodules: {
    kind: "string-or-null",
    expected: [...WorktreeSubmodules.literals, "null"].join(" | "),
  },
  addProjectBaseDirectory: STRING_SETTING,
  branchNamingMode: { kind: "string", expected: BranchNamingMode.literals.join(" | ") },
  branchNamePrefix: STRING_SETTING,
  branchNamePrefixFromRepository: BOOLEAN_SETTING,
  branchNameInstructions: STRING_SETTING,
  removeAgentCreditsOnMerge: BOOLEAN_SETTING,
  pullRequestMergeMethod: {
    kind: "string-or-null",
    expected: [...PullRequestMergeMethod.literals, "null"].join(" | "),
  },
  cursorKeychainUsageEnabled: BOOLEAN_SETTING,
} as const satisfies Partial<
  Record<
    keyof ServerSettingsPatch,
    {
      readonly kind: "boolean" | "number-or-null" | "string" | "string-or-null";
      readonly expected: string;
    }
  >
>;

type SettingName = keyof typeof SETTABLE_SETTINGS;

const encodeValueJson = Schema.encodeEffect(fromJsonStringPretty(Schema.Unknown));
const decodeServerSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsPatch);

export class SettingsKeyUnknownError extends Schema.TaggedError<SettingsKeyUnknownError>()(
  "SettingsKeyUnknownError",
  { setting: Schema.String },
) {
  override get message(): string {
    return `Unknown setting "${this.setting}". Run \`supaterm settings list\` to see the supported settings.`;
  }
}

export class SettingsValueSyntaxError extends Schema.TaggedError<SettingsValueSyntaxError>()(
  "SettingsValueSyntaxError",
  { setting: Schema.String, value: Schema.String, expected: Schema.String },
) {
  override get message(): string {
    return `Invalid value for ${this.setting}: ${this.value}. Expected ${this.expected}.`;
  }
}

const resolveSettingsPath = Effect.fnUntraced(function* (explicitBaseDir: Option.Option<string>) {
  const envHome = Option.filter(
    yield* Config.String("SUPATERM_HOME").pipe(Config.option),
    (value) => value.trim().length > 0,
  );
  const configuredBaseDir = Option.orElse(explicitBaseDir, () => envHome);
  const worktreeHome = Option.isNone(configuredBaseDir)
    ? yield* resolveWorktreeSupatermHome(process.cwd())
    : undefined;
  const selectedBaseDir = Option.orElse(configuredBaseDir, () =>
    Option.fromUndefinedOr(worktreeHome),
  );
  const paths = yield* resolveSettingsPaths(selectedBaseDir);
  if (Option.isSome(selectedBaseDir)) return paths.settingsPath;

  const developmentPaths = yield* resolveSettingsPaths(Option.none(), true);
  const runtime = yield* readPersistedServerRuntimeState(developmentPaths.serverRuntimeStatePath);
  return Option.isSome(runtime) &&
    runtime.value.devUrl !== undefined &&
    isProcessAlive(runtime.value.pid)
    ? developmentPaths.settingsPath
    : paths.settingsPath;
});

const settingNames = (): ReadonlyArray<SettingName> =>
  Object.keys(SETTABLE_SETTINGS) as Array<SettingName>;

const settingName = (value: string): SettingName | undefined =>
  Object.hasOwn(SETTABLE_SETTINGS, value) ? (value as SettingName) : undefined;

const parseValue = (setting: SettingName, raw: string): unknown => {
  const { kind } = SETTABLE_SETTINGS[setting];
  if (kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  } else if (kind === "number-or-null") {
    if (raw === "null") return null;
    if (raw.trim().length === 0) return undefined;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  } else if (kind === "string-or-null") {
    if (raw === "null") return null;
    return raw;
  } else {
    return raw;
  }

  return undefined;
};

const requireSettingName = (raw: string): Effect.Effect<SettingName, SettingsKeyUnknownError> => {
  const setting = settingName(raw);
  return setting === undefined
    ? Effect.fail(new SettingsKeyUnknownError({ setting: raw }))
    : Effect.succeed(setting);
};

const decodeSettingPatch = Effect.fn(function* (setting: SettingName, rawValue: string) {
  const value = parseValue(setting, rawValue);
  if (value === undefined) {
    return yield* new SettingsValueSyntaxError({
      setting,
      value: rawValue,
      expected: SETTABLE_SETTINGS[setting].expected,
    });
  }

  const patch = yield* decodeServerSettingsPatch({ [setting]: value }).pipe(
    Effect.mapError(
      (_cause) =>
        new SettingsValueSyntaxError({
          setting,
          value: rawValue,
          expected: SETTABLE_SETTINGS[setting].expected,
        }),
    ),
  );
  return patch;
});

const settingsListCommand = Command.make("list", {}).pipe(
  Command.withDescription("List server settings that can be changed from the CLI."),
  Command.withHandler(() =>
    Console.log(
      settingNames()
        .map((setting) => `${setting}\t${SETTABLE_SETTINGS[setting].expected}`)
        .join("\n"),
    ),
  ),
);

const settingsGetCommand = Command.make("get", {
  baseDir: baseDirFlag,
  setting: Argument.String("setting"),
}).pipe(
  Command.withDescription("Read a server setting."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const setting = yield* requireSettingName(flags.setting);
      const settingsPath = yield* resolveSettingsPath(flags.baseDir);
      const { settings: sparseSettings } = yield* readSettingsObject(settingsPath);
      const value = Object.hasOwn(sparseSettings, setting)
        ? sparseSettings[setting]
        : DEFAULT_SERVER_SETTINGS[setting];
      yield* Console.log(yield* encodeValueJson(value));
    }),
  ),
);

const settingsSetCommand = Command.make("set", {
  baseDir: baseDirFlag,
  setting: Argument.String("setting"),
  value: Argument.String("value"),
}).pipe(
  Command.withDescription("Change a server setting."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const setting = yield* requireSettingName(flags.setting);
      const settingsPath = yield* resolveSettingsPath(flags.baseDir);
      const patch = yield* decodeSettingPatch(setting, flags.value);
      const value = patch[setting];
      if (value === undefined) {
        return yield* new SettingsValueSyntaxError({
          setting,
          value: flags.value,
          expected: SETTABLE_SETTINGS[setting].expected,
        });
      }
      yield* editSettingsObject(settingsPath, (settings) => ({ ...settings, [setting]: value }));
      yield* Console.log(`Set ${setting} in ${settingsPath}.`);
    }),
  ),
);

export const settingsCommand = Command.make("settings").pipe(
  Command.withDescription("Inspect and change server settings."),
  Command.withSubcommands([settingsListCommand, settingsGetCommand, settingsSetCommand]),
);
