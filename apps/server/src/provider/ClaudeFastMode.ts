import { ProviderDriverKind, type ServerProviderModel } from "@supaterm/contracts";
import { filterCustomModelCapabilities } from "@supaterm/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

const AccountConfig = Schema.fromJsonString(
  Schema.Struct({ penguinModeOrgEnabled: Schema.optional(Schema.Boolean) }),
);
const UserSettings = Schema.fromJsonString(
  Schema.Struct({
    env: Schema.optional(
      Schema.Struct({ CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK: Schema.optional(Schema.String) }),
    ),
  }),
);

const enabled = (value: string | undefined) =>
  value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());

export const makeClaudeFastModeAvailability = Effect.fn("makeClaudeFastModeAvailability")(
  function* (input: {
    readonly accountConfigPath: string;
    readonly settingsPath: string;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    const { accountConfigPath, settingsPath, environment } = input;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const readJson = <A>(file: string, codec: Schema.Codec<A, string>) =>
      fs.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(codec)),
        Effect.orElseSucceed(() => undefined),
      );
    const latestReason = yield* Ref.make<string | undefined>(undefined);
    const readBlocked = Effect.gen(function* () {
      if (
        enabled(environment.CLAUDE_CODE_DISABLE_FAST_MODE) ||
        enabled(environment.CLAUDE_CODE_USE_BEDROCK) ||
        enabled(environment.CLAUDE_CODE_USE_VERTEX) ||
        enabled(environment.CLAUDE_CODE_USE_FOUNDRY)
      )
        return true;
      const configDir = environment.CLAUDE_CONFIG_DIR?.trim();
      if (configDir && !path.isAbsolute(configDir)) return false;
      switch (yield* Ref.get(latestReason)) {
        case "free":
        case "preference":
        case "extra_usage_disabled":
        case "not_first_party":
        case "disabled_by_env":
          return true;
      }
      const settings = yield* readJson(settingsPath, UserSettings);
      if (
        enabled(environment.CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK) ||
        enabled(settings?.env?.CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK)
      )
        return false;
      // The probe never opts in, so its reason stops at sdk_opt_in_required. Claude Code caches
      // its org check here and enforces it even when a gateway or token serves inference.
      const account = yield* readJson(accountConfigPath, AccountConfig);
      return account?.penguinModeOrgEnabled === false;
    });
    const blocked = yield* Ref.make(yield* readBlocked);
    return {
      isBlocked: Ref.get(blocked),
      refresh: readBlocked.pipe(Effect.tap((value) => Ref.set(blocked, value))),
      update: (disabledReason: string | undefined) => Ref.set(latestReason, disabledReason),
    };
  },
);

export function filterClaudeFastModeModels(
  models: ReadonlyArray<ServerProviderModel>,
  blocked: boolean,
): ReadonlyArray<ServerProviderModel> {
  return models.map((model) => {
    if (model.isCustom) {
      const capabilities = filterCustomModelCapabilities(
        ProviderDriverKind.make("claudeAgent"),
        model.capabilities,
      );
      return capabilities === model.capabilities ? model : { ...model, capabilities };
    }
    const descriptors = model.capabilities?.optionDescriptors;
    if (!blocked || !descriptors?.some((descriptor) => descriptor.id === "fastMode")) {
      return model;
    }
    return {
      ...model,
      capabilities: {
        ...model.capabilities,
        optionDescriptors: descriptors.filter((descriptor) => descriptor.id !== "fastMode"),
      },
    };
  });
}
