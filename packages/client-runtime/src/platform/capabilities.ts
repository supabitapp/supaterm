import {
  type AuthClientPresentationMetadata,
  type DesktopSshEnvironmentBootstrap,
  type DesktopSshEnvironmentTarget,
  EnvironmentId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ConnectionAttemptError } from "../connection/model.ts";

export interface PreparedSshEnvironment {
  readonly bootstrap: DesktopSshEnvironmentBootstrap;
  readonly bearerToken: string;
}

export interface ProvisionedSshEnvironment extends PreparedSshEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export class ClientPresentation extends Context.Service<
  ClientPresentation,
  {
    readonly metadata: AuthClientPresentationMetadata;
  }
>()("@supaterm/client-runtime/platform/capabilities/ClientPresentation") {}

export class PrimaryEnvironmentAuth extends Context.Service<
  PrimaryEnvironmentAuth,
  {
    readonly bearerToken: Effect.Effect<Option.Option<string>, ConnectionAttemptError>;
  }
>()("@supaterm/client-runtime/platform/capabilities/PrimaryEnvironmentAuth") {}

export class SshEnvironmentGateway extends Context.Service<
  SshEnvironmentGateway,
  {
    /**
     * With `expectedEnvironmentId`, a server that is a different machine fails
     * before its one-time pairing credential is spent.
     */
    readonly provision: (
      target: DesktopSshEnvironmentTarget,
      expectedEnvironmentId?: EnvironmentId,
    ) => Effect.Effect<ProvisionedSshEnvironment, ConnectionAttemptError>;
    /**
     * Starts or reuses the remote server for a saved connection. Returns
     * `bearerToken`, the token this client saved from an earlier pairing, while
     * the host still accepts it with the standard scopes, and pairs again only
     * when it does not, so a reconnect adds no session on the host.
     */
    readonly prepare: (input: {
      readonly connectionId: string;
      readonly expectedEnvironmentId: EnvironmentId;
      readonly target: DesktopSshEnvironmentTarget;
      readonly bearerToken?: string;
    }) => Effect.Effect<PreparedSshEnvironment, ConnectionAttemptError>;
    readonly disconnect: (
      target: DesktopSshEnvironmentTarget,
    ) => Effect.Effect<void, ConnectionAttemptError>;
  }
>()("@supaterm/client-runtime/platform/capabilities/SshEnvironmentGateway") {}
