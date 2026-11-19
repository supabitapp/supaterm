import type {
  AuthClientMetadata,
  AuthEnvironmentScope,
  ServerAuthSessionMethod,
  AuthSessionId,
  AuthSessionState,
} from "@supaterm/contracts";
import { EnvironmentHttpCommonError, PRIMARY_LOCAL_ENVIRONMENT_ID } from "@supaterm/contracts";
import type { EnvironmentHttpCommonError as EnvironmentHttpCommonErrorType } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { readPairingEnvironmentId } from "@supaterm/shared/remote";

import {
  getPairingTokenFromUrl,
  stripPairingTokenFromUrl as stripPairingTokenUrl,
} from "@supaterm/shared/remote";

import { PrimaryEnvironmentHttpClient } from "./httpClient";
import { runPrimaryHttp } from "../../lib/runtime";

const PrimaryEnvironmentRequestOperation = Schema.Literals([
  "fetch-session-state",
  "exchange-bootstrap-credential",
  "fetch-environment-descriptor",
  "create-pairing-credential",
  "list-pairing-links",
  "revoke-pairing-link",
  "list-client-sessions",
  "revoke-client-session",
  "revoke-other-client-sessions",
]);
type PrimaryEnvironmentRequestOperation = typeof PrimaryEnvironmentRequestOperation.Type;

export class PrimaryEnvironmentRequestError extends Schema.TaggedError<PrimaryEnvironmentRequestError>()(
  "PrimaryEnvironmentRequestError",
  {
    operation: PrimaryEnvironmentRequestOperation,
    status: Schema.Number,
    pairingLinkId: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(input: {
    readonly operation: PrimaryEnvironmentRequestOperation;
    readonly cause: unknown;
    readonly pairingLinkId?: string;
    readonly sessionId?: string;
  }) {
    const status = readHttpApiStatus(input.cause) ?? 500;
    return new PrimaryEnvironmentRequestError({
      operation: input.operation,
      status,
      ...(input.pairingLinkId !== undefined ? { pairingLinkId: input.pairingLinkId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      cause: input.cause,
    });
  }

  override get message() {
    return `Primary environment request failed during ${this.operation} (HTTP ${this.status}).`;
  }
}

const isPrimaryEnvironmentRequestError = Schema.is(PrimaryEnvironmentRequestError);

export class PrimaryEnvironmentPairingCredentialRejectedError extends Schema.TaggedError<PrimaryEnvironmentPairingCredentialRejectedError>()(
  "PrimaryEnvironmentPairingCredentialRejectedError",
  {
    providedLength: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return "Invalid pairing token. Check the token and try again.";
  }
}

export class PrimaryEnvironmentAuthSessionTimeoutError extends Schema.TaggedError<PrimaryEnvironmentAuthSessionTimeoutError>()(
  "PrimaryEnvironmentAuthSessionTimeoutError",
  {
    timeoutMs: Schema.Number,
    elapsedMs: Schema.Number,
  },
) {
  override get message() {
    return "Timed out waiting for authenticated session after bootstrap.";
  }
}

export class PrimaryEnvironmentPairingCredentialRequiredError extends Schema.TaggedError<PrimaryEnvironmentPairingCredentialRequiredError>()(
  "PrimaryEnvironmentPairingCredentialRequiredError",
  {
    providedLength: Schema.Number,
  },
) {
  override get message() {
    return "Enter a pairing token to continue.";
  }
}

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
let resolvedAuthenticatedGateState: ServerAuthGateState | null = null;
let explicitPairingRequested = false;
const AUTH_SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const AUTH_SESSION_ESTABLISH_STEP_MS = 100;

export function peekPairingTokenFromUrl(): string | null;
export function peekPairingTokenFromUrl() {
  return getPairingTokenFromUrl(new URL(window.location.href)) satisfies string | null;
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  const next = stripPairingTokenUrl(url);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState(window.history.state, document.title, next.toString());
}

export function takePairingTokenFromUrl(): string | null;
export function takePairingTokenFromUrl() {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null satisfies string | null;
  }
  stripPairingTokenFromUrl();
  return token satisfies string | null;
}

function getDesktopBootstrapCredential() {
  const bootstraps = window.desktopBridge?.getLocalEnvironmentBootstraps() ?? [];
  const primary = bootstraps.find((entry) => entry.id === PRIMARY_LOCAL_ENVIRONMENT_ID);
  return typeof primary?.bootstrapToken === "string" && primary.bootstrapToken.length > 0
    ? primary.bootstrapToken
    : null;
}

export async function fetchSessionState() {
  return retryTransientBootstrap(async () => {
    try {
      return await runPrimaryHttp(
        PrimaryEnvironmentHttpClient.pipe(
          Effect.flatMap((client) => client.auth.session({ headers: {} })),
        ),
      );
    } catch (error) {
      throw PrimaryEnvironmentRequestError.fromCause({
        operation: "fetch-session-state",
        cause: error,
      });
    }
  });
}

function readHttpApiStatus(error: unknown) {
  if (isEnvironmentHttpCommonError(error)) {
    return readEnvironmentHttpErrorStatus(error);
  }
  return HttpClientError.isHttpClientError(error) && error.response !== undefined
    ? error.response.status
    : null;
}

function readEnvironmentHttpErrorStatus(error: EnvironmentHttpCommonErrorType) {
  switch (error._tag) {
    case "EnvironmentRequestInvalidError":
      return 400;
    case "EnvironmentAuthInvalidError":
      return 401;
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      return 403;
    case "EnvironmentResourceNotFoundError":
      return 404;
    case "EnvironmentInternalError":
      return 500;
  }
}

async function exchangeBootstrapCredential(credential: string) {
  return retryTransientBootstrap(async () => {
    try {
      return await runPrimaryHttp(
        PrimaryEnvironmentHttpClient.pipe(
          Effect.flatMap((client) => client.auth.browserSession({ payload: { credential } })),
          Effect.provideService(FetchHttpClient.RequestInit, {
            credentials: "include",
            redirect: "error",
          }),
        ),
      );
    } catch (error) {
      if (
        isEnvironmentHttpCommonError(error) &&
        error._tag === "EnvironmentAuthInvalidError" &&
        error.reason === "invalid_credential"
      ) {
        throw new PrimaryEnvironmentPairingCredentialRejectedError({
          providedLength: credential.length,
          cause: error,
        });
      }
      throw PrimaryEnvironmentRequestError.fromCause({
        operation: "exchange-bootstrap-credential",
        cause: error,
      });
    }
  });
}

async function waitForAuthenticatedSessionAfterBootstrap() {
  const startedAt = Date.now();

  while (true) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= AUTH_SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new PrimaryEnvironmentAuthSessionTimeoutError({
        timeoutMs: AUTH_SESSION_ESTABLISH_TIMEOUT_MS,
        elapsedMs,
      });
    }

    await waitForBootstrapRetry(AUTH_SESSION_ESTABLISH_STEP_MS);
  }
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
const BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;
const BOOTSTRAP_RETRY_STEP_MS = 500;

async function retryTransientBootstrap<T>(operation: () => Promise<T>) {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  }) satisfies Promise<void>;
}

function isTransientBootstrapError(error: unknown) {
  if (isPrimaryEnvironmentRequestError(error)) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status) || isTransportError(error.cause);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function isTransportError(error: unknown) {
  return HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError";
}

async function verifyPairingEnvironment(pairingUrl?: string) {
  const expected =
    pairingUrl === undefined ? undefined : readPairingEnvironmentId(new URL(pairingUrl));
  if (expected === undefined) return;
  const descriptor = await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.metadata.descriptor()),
      Effect.provideService(FetchHttpClient.RequestInit, {
        credentials: "include",
        redirect: "error",
      }),
    ),
  );
  if (descriptor.environmentId !== expected) {
    throw new Error("This pairing link belongs to a different environment.");
  }
}

function bootstrapServerAuth(
  urlCredential: string | null,
  pairingUrl?: string,
): Promise<ServerAuthGateState>;
async function bootstrapServerAuth(urlCredential: string | null, pairingUrl?: string) {
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated && !urlCredential) {
    return { status: "authenticated" } satisfies ServerAuthGateState;
  }

  const bootstrapCredential = urlCredential ?? getDesktopBootstrapCredential();
  if (!bootstrapCredential) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
    } satisfies ServerAuthGateState;
  }

  try {
    await verifyPairingEnvironment(pairingUrl);
    await exchangeBootstrapCredential(bootstrapCredential);
    await waitForAuthenticatedSessionAfterBootstrap();
    return { status: "authenticated" } satisfies ServerAuthGateState;
  } catch (error) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    } satisfies ServerAuthGateState;
  }
}

export async function submitServerAuthCredential(credential: string, pairingUrl?: string) {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new PrimaryEnvironmentPairingCredentialRequiredError({
      providedLength: credential.length,
    });
  }

  resolvedAuthenticatedGateState = null;
  await verifyPairingEnvironment(pairingUrl);
  await exchangeBootstrapCredential(trimmedCredential);
  await waitForAuthenticatedSessionAfterBootstrap();
  resolvedAuthenticatedGateState = { status: "authenticated" };
  bootstrapPromise = null;
  explicitPairingRequested = false;
  stripPairingTokenFromUrl();
}

export function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState>;
export async function resolveInitialServerAuthGateState() {
  const pairingUrl = peekPairingTokenFromUrl() ? window.location.href : undefined;
  if (window.location.pathname.replace(/\/+$/, "") !== "/pair") {
    explicitPairingRequested = false;
  } else if (peekPairingTokenFromUrl()) {
    explicitPairingRequested = true;
  }
  if (explicitPairingRequested) {
    const currentSession = await fetchSessionState();
    return { status: "requires-auth", auth: currentSession.auth } satisfies ServerAuthGateState;
  }

  const urlCredential = takePairingTokenFromUrl();
  const previousPromise = bootstrapPromise;
  if (urlCredential) {
    resolvedAuthenticatedGateState = null;
  } else {
    if (previousPromise) {
      return previousPromise;
    }

    if (resolvedAuthenticatedGateState?.status === "authenticated") {
      return resolvedAuthenticatedGateState satisfies ServerAuthGateState;
    }
  }

  const nextPromise = previousPromise
    ? previousPromise
        .catch(() => undefined)
        .then(() => {
          resolvedAuthenticatedGateState = null;
          return bootstrapServerAuth(urlCredential, pairingUrl);
        })
    : bootstrapServerAuth(urlCredential, pairingUrl);
  bootstrapPromise = nextPromise;
  return nextPromise
    .then((result) => {
      if (bootstrapPromise === nextPromise && result.status === "authenticated") {
        resolvedAuthenticatedGateState = result;
      }
      return result;
    })
    .finally(() => {
      if (bootstrapPromise === nextPromise) {
        bootstrapPromise = null;
      }
    });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  resolvedAuthenticatedGateState = null;
  explicitPairingRequested = false;
}
