import { normalizePushGatewayOrigin, PushEnvelope } from "@supaterm/contracts/push";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { publicAddresses } from "../htmlRender/publicProxy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PushIdentity from "./PushIdentity.ts";

const LOCAL_GATEWAY_HOSTS = new Set(["localhost", "127.0.0.1"]);

export class PushGatewayOriginError extends Schema.TaggedError<PushGatewayOriginError>()(
  "PushGatewayOriginError",
  {
    reason: Schema.Literals(["insecure", "not_allowed", "private_address"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "insecure":
        return "Push gateways must use https, or http on localhost.";
      case "not_allowed":
        return "This push gateway is not in the host's allowed gateway origins.";
      case "private_address":
        return "This push gateway resolves to a private or unreachable address.";
    }
  }
}

export class PushGatewayUnavailableError extends Schema.TaggedError<PushGatewayUnavailableError>()(
  "PushGatewayUnavailableError",
  {
    operation: Schema.Literals(["send", "delete-handle"]),
    status: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.status === undefined
      ? "Could not reach the push gateway."
      : `The push gateway answered ${this.status}.`;
  }
}

export type PushGatewaySendOutcome =
  | { readonly type: "accepted" }
  | { readonly type: "gone" }
  | { readonly type: "retry"; readonly retryAfterMs: number | null }
  | { readonly type: "rejected"; readonly status: number };

export interface PushGatewaySendInput {
  readonly origin: string;
  readonly handle: string;
  readonly payload: PushEnvelope;
  /** Unix seconds. */
  readonly expiration: number;
  readonly priority: 5 | 10;
  readonly collapseId: string;
}

type PushGatewayError = PushGatewayOriginError | PushGatewayUnavailableError;

const encodeSendBody = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      handle: Schema.String,
      payload: PushEnvelope,
      expiration: Schema.Number,
      priority: Schema.Literals([5, 10]),
      collapseId: Schema.String,
    }),
  ),
);

export class PushGatewayClient extends Context.Service<
  PushGatewayClient,
  {
    readonly send: (
      input: PushGatewaySendInput,
    ) => Effect.Effect<PushGatewaySendOutcome, PushGatewayError>;
    /** Drops a handle this host minted for itself. Unknown handles count as dropped. */
    readonly deleteHandle: (input: {
      readonly origin: string;
      readonly handle: string;
    }) => Effect.Effect<void, PushGatewayError>;
  }
>()("supaterm/notifications/PushGatewayClient") {}

function retryAfterMs(header: string | undefined): number | null {
  const seconds = Number(header);
  return header === undefined || !Number.isFinite(seconds) || seconds < 0 ? null : seconds * 1000;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const identity = yield* PushIdentity.PushIdentity;
  const settings = yield* ServerSettings.ServerSettingsService;

  const checkOrigin = Effect.fn("PushGatewayClient.checkOrigin")(function* (
    origin: string,
    operation: PushGatewayUnavailableError["operation"],
  ) {
    const normalized = normalizePushGatewayOrigin(origin);
    if (normalized === null) return yield* new PushGatewayOriginError({ reason: "insecure" });
    const allowed = yield* settings.getSettings.pipe(
      Effect.map((current) =>
        current.pushGatewayOrigins.some(
          (entry) => normalizePushGatewayOrigin(entry) === normalized,
        ),
      ),
      Effect.mapError((cause) => new PushGatewayUnavailableError({ operation, cause })),
    );
    if (!allowed) return yield* new PushGatewayOriginError({ reason: "not_allowed" });
    const url = new URL(normalized);
    if (LOCAL_GATEWAY_HOSTS.has(url.hostname)) return url;
    // The allowlist is owner-configured, so the resolve-then-fetch gap is not worth a pinned agent.
    const addresses = yield* Effect.promise(() =>
      publicAddresses(url.hostname.replace(/^\[|\]$/g, "")),
    );
    if (addresses === undefined) {
      return yield* new PushGatewayOriginError({ reason: "private_address" });
    }
    return url;
  });

  const execute = Effect.fn("PushGatewayClient.execute")(function* (input: {
    readonly origin: string;
    readonly operation: PushGatewayUnavailableError["operation"];
    readonly method: "POST" | "DELETE";
    readonly path: string;
    readonly body: string;
  }) {
    const base = yield* checkOrigin(input.origin, input.operation);
    const timestamp = yield* Clock.currentTimeMillis;
    const headers = yield* identity
      .signRequest({ method: input.method, path: input.path, body: input.body, timestamp })
      .pipe(
        Effect.mapError(
          (cause) => new PushGatewayUnavailableError({ operation: input.operation, cause }),
        ),
      );
    const url = new URL(input.path, base);
    const request =
      input.method === "POST"
        ? HttpClientRequest.post(url).pipe(
            HttpClientRequest.bodyText(input.body, "application/json"),
          )
        : HttpClientRequest.delete(url);
    return yield* client.execute(HttpClientRequest.setHeaders(request, headers)).pipe(
      Effect.tap((response) => response.arrayBuffer.pipe(Effect.ignore)),
      Effect.timeout("10 seconds"),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.mapError(
        (cause) => new PushGatewayUnavailableError({ operation: input.operation, cause }),
      ),
    );
  });

  const send: PushGatewayClient["Service"]["send"] = Effect.fn("PushGatewayClient.send")(
    function* ({ origin, ...fields }) {
      const body = yield* encodeSendBody(fields).pipe(
        Effect.mapError((cause) => new PushGatewayUnavailableError({ operation: "send", cause })),
      );
      const response = yield* execute({
        origin,
        operation: "send",
        method: "POST",
        path: "/v1/send",
        body,
      });
      const status = response.status;
      if (status >= 200 && status < 300) return { type: "accepted" } as const;
      if (status === 410) return { type: "gone" } as const;
      if (status === 429 || status >= 500) {
        return {
          type: "retry",
          retryAfterMs: retryAfterMs(response.headers["retry-after"]),
        } as const;
      }
      return { type: "rejected", status } as const;
    },
  );

  const deleteHandle: PushGatewayClient["Service"]["deleteHandle"] = Effect.fn(
    "PushGatewayClient.deleteHandle",
  )(function* (input) {
    const response = yield* execute({
      origin: input.origin,
      operation: "delete-handle",
      method: "DELETE",
      path: `/v1/handles/${encodeURIComponent(input.handle)}`,
      body: "",
    });
    const status = response.status;
    if ((status >= 200 && status < 300) || status === 404 || status === 410) return;
    return yield* new PushGatewayUnavailableError({ operation: "delete-handle", status });
  });

  return PushGatewayClient.of({ send, deleteHandle });
});

export const layer = Layer.effect(PushGatewayClient, make);
