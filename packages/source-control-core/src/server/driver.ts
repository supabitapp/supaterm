import type {
  SourceControlAppAccess,
  SourceControlProviderKind,
  SourceControlSignInError,
  SourceControlSignInPrompt,
  SourceControlSignInResult,
} from "@supaterm/contracts";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import type { SourceControlDefinition } from "../shared/definition.ts";

import type { SourceControlProviderDiscoverySpec } from "./discovery.ts";
import type { PullRequestProviderApi } from "./PullRequestProvider.ts";
import type * as SourceControlHost from "./SourceControlHost.ts";
import type * as SourceControlProvider from "./SourceControlProvider.ts";
import type * as SourceControlRateLimit from "./SourceControlRateLimit.ts";

export interface SourceControlMediaRequest {
  readonly url: string;

  readonly headers: Readonly<Record<string, string>>;
}

export interface SourceControlSignIn {
  readonly start: (
    host: string,
  ) => Effect.Effect<SourceControlSignInPrompt, SourceControlSignInError>;

  readonly wait: (
    host: string,
  ) => Effect.Effect<SourceControlSignInResult, SourceControlSignInError>;

  readonly cancel: (host: string) => Effect.Effect<void>;

  readonly access: (
    host: string,
    repository: string,
  ) => Effect.Effect<SourceControlAppAccess["status"]>;
}

export interface SourceControlDriverInstance {
  readonly sourceControl: SourceControlProvider.SourceControlProvider["Service"];
  readonly discovery: SourceControlProviderDiscoverySpec;
  /** Null for a host whose pull requests this build cannot read. */
  readonly pullRequests: PullRequestProviderApi | null;

  readonly fetchMedia?: (
    request: SourceControlMediaRequest,
  ) => Effect.Effect<
    HttpClientResponse.HttpClientResponse | null,
    HttpClientError.HttpClientError,
    Scope.Scope
  >;
  readonly signIn?: SourceControlSignIn;
}

export type SourceControlDriverServices =
  | SourceControlHost.SourceControlHost
  | SourceControlRateLimit.SourceControlRateLimit
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Crypto.Crypto;

export interface SourceControlDriver {
  readonly kind: SourceControlProviderKind;
  readonly definition: SourceControlDefinition;

  readonly make: Effect.Effect<
    SourceControlDriverInstance,
    never,
    SourceControlDriverServices | Scope.Scope
  >;
}

export const defineSourceControlDriver = (driver: SourceControlDriver): SourceControlDriver =>
  driver;

export const withOwnServices = <A, R, ROut, RIn>(
  make: Effect.Effect<A, never, R>,
  services: Layer.Layer<ROut, never, RIn>,
): Effect.Effect<A, never, Exclude<R, ROut> | RIn | Scope.Scope> =>
  Layer.build(services).pipe(Effect.flatMap((context) => make.pipe(Effect.provide(context))));
