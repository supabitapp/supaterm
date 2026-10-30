import type {
  BackgroundScope,
  ChatAttachment,
  ServerSettings,
  ServerSettingsError,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { ProviderCredentialError } from "./errors.ts";

export interface ProviderHostPaths {
  readonly cwd: string;

  readonly baseDir: string;

  readonly stateDir: string;

  readonly providerStatusCacheDir: string;

  readonly attachmentsDir: string;
}

export interface ProviderCredentials {
  readonly binding: { readonly owner: "supaterm"; readonly key: string };
  readonly get: Effect.Effect<Option.Option<Uint8Array>, ProviderCredentialError>;
  readonly set: (credentials: Uint8Array) => Effect.Effect<void, ProviderCredentialError>;
  readonly remove: Effect.Effect<void, ProviderCredentialError>;
}

export class ProviderHost extends Context.Service<
  ProviderHost,
  {
    readonly paths: ProviderHostPaths;
    readonly settings: {
      readonly get: Effect.Effect<ServerSettings, ServerSettingsError>;

      readonly withSnapshot: <A, E, R>(
        use: (settings: ServerSettings) => Effect.Effect<A, E, R>,
      ) => Effect.Effect<A, E | ServerSettingsError, R>;

      readonly changes: Stream.Stream<ServerSettings>;

      readonly subscribe: Effect.Effect<Stream.Stream<ServerSettings>, never, Scope.Scope>;
    };

    readonly shouldRunBackgroundWork: (scope: BackgroundScope) => Effect.Effect<boolean>;

    readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;

    readonly credentials: (
      namespace: string,
      bindingId: string,
    ) => Effect.Effect<ProviderCredentials>;
  }
>()("@supaterm/provider-core/server/ProviderHost") {}
