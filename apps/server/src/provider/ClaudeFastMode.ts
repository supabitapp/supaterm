import { ProviderDriverKind, type ServerProviderModel } from "@supaterm/contracts";
import { filterCustomModelCapabilities } from "@supaterm/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import type { ClaudeCapabilitiesProbe } from "./ClaudeProvider.ts";

const AccountConfig = Schema.Struct({
  penguinModeOrgEnabled: Schema.optional(Schema.Boolean),
  oauthAccount: Schema.optional(
    Schema.Struct({ organizationUuid: Schema.optional(Schema.String) }),
  ),
});

const enabled = (value: string | undefined) =>
  value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
const configured = (value: string | undefined) => !!value?.trim();

export const makeClaudeFastModeAvailability = Effect.fn("makeClaudeFastModeAvailability")(
  function* (accountConfigPath: string, environment: NodeJS.ProcessEnv) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const latestProbe = yield* Ref.make<ClaudeCapabilitiesProbe | undefined>(undefined);
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
      const probe = yield* Ref.get(latestProbe);
      switch (probe?.fastModeDisabledReason) {
        case "free":
        case "preference":
        case "extra_usage_disabled":
        case "not_first_party":
        case "disabled_by_env":
          return true;
      }
      if (
        enabled(environment.CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK) ||
        configured(environment.ANTHROPIC_API_KEY) ||
        configured(environment.ANTHROPIC_AUTH_TOKEN) ||
        configured(environment.CLAUDE_CODE_OAUTH_TOKEN) ||
        configured(environment.ANTHROPIC_BASE_URL) ||
        (probe?.apiProvider !== undefined && probe.apiProvider !== "firstParty") ||
        (probe?.apiKeySource !== undefined && probe.apiKeySource !== "none") ||
        probe?.tokenSource !== undefined
      ) {
        return false;
      }
      const account = yield* fs.readFileString(accountConfigPath).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(AccountConfig))),
        Effect.orElseSucceed(() => undefined),
      );
      const organizationId = account?.oauthAccount?.organizationUuid;
      return (
        account?.penguinModeOrgEnabled === false &&
        !!organizationId &&
        (probe?.workspaceId === undefined || probe.workspaceId === organizationId)
      );
    });
    const blocked = yield* Ref.make(yield* readBlocked);
    return {
      isBlocked: Ref.get(blocked),
      refresh: readBlocked.pipe(Effect.tap((value) => Ref.set(blocked, value))),
      update: (probe: ClaudeCapabilitiesProbe) => Ref.set(latestProbe, probe),
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
