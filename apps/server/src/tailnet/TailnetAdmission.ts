import {
  isTailnetCallerAdmitted,
  TAILNET_REFUSED_ERROR,
  type TailnetOwner,
  type TailnetSettings,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerSettingsService from "../serverSettings.ts";
import { type TailnetPeer, tailnetPeerOfRequest } from "./tailnetPeer.ts";
import * as TailnetNode from "./TailnetNode.ts";

const DESCRIPTOR_PATH = "/.well-known/supaterm/environment";
const DIRECT_TUNNEL_PATH = "/v1/connect";
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
];

export type TailnetRequestDecision =
  | { readonly _tag: "Pass" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Refused"; readonly login: string | null };

export function tailnetRequestDecision(input: {
  readonly peer: TailnetPeer;
  readonly pathname: string;
  readonly settings: Pick<TailnetSettings, "admission" | "allowedLogins">;
  readonly owner: TailnetOwner | null;
}): TailnetRequestDecision {
  if (!input.peer.tls && input.pathname !== DIRECT_TUNNEL_PATH) return { _tag: "NotFound" };
  if (input.pathname === DESCRIPTOR_PATH) return { _tag: "Pass" };
  const login = input.peer.identity?.login ?? null;
  return isTailnetCallerAdmitted({
    settings: input.settings,
    owner: input.owner,
    callerLogin: login,
  })
    ? { _tag: "Pass" }
    : { _tag: "Refused", login };
}

export const layerGuard = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const peer = tailnetPeerOfRequest(request);
      if (peer === undefined) return yield* app;
      const node = yield* TailnetNode.TailnetNode;
      const settings = yield* ServerSettingsService.ServerSettingsService;
      const current = yield* settings.getSettings.pipe(Effect.option);
      const decision =
        current._tag === "None"
          ? ({ _tag: "Refused", login: peer.identity?.login ?? null } as const)
          : tailnetRequestDecision({
              peer,
              pathname: new URL(request.url, "http://tailnet").pathname,
              settings: current.value.tailnet,
              owner: yield* node.owner,
            });
      switch (decision._tag) {
        case "NotFound":
          return HttpServerResponse.empty({ status: 404 });
        case "Refused":
          return HttpServerResponse.jsonUnsafe(
            { error: TAILNET_REFUSED_ERROR, login: decision.login },
            { status: 403 },
          );
        case "Pass":
          return yield* app.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              request.modify({
                protocol: peer.tls ? "https" : "http",
                headers: FORWARDING_HEADERS.reduce(
                  (headers, name) => Headers.remove(headers, name),
                  request.headers,
                ),
              }),
            ),
          );
      }
    }),
  { global: true },
);
