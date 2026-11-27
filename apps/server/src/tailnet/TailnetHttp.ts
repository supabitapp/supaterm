import { AuthAccessReadScope, AuthAccessWriteScope, EnvironmentHttpApi } from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as TailnetNode from "./TailnetNode.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "tailnet",
  Effect.fnUntraced(function* (handlers) {
    const node = yield* TailnetNode.TailnetNode;
    return handlers
      .handle("status", () =>
        requireEnvironmentScope(AuthAccessReadScope).pipe(Effect.andThen(node.current)),
      )
      .handle("login", () =>
        requireEnvironmentScope(AuthAccessWriteScope).pipe(Effect.andThen(node.login)),
      )
      .handle("logout", () =>
        requireEnvironmentScope(AuthAccessWriteScope).pipe(Effect.andThen(node.logout)),
      );
  }),
);
