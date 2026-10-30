import { ATTACHMENT_UPLOAD_URL_TTL_MS, OrchestratorMcpFailure } from "@supaterm/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpInvocationContext from "./McpInvocationContext.ts";

const OWNER_TTL_MS = 24 * 60 * 60 * 1000 + ATTACHMENT_UPLOAD_URL_TTL_MS;

const currentOwner = McpInvocationContext.McpInvocationContext.pipe(
  Effect.map((scope) => scope.thread?.threadId ?? scope.requestNamespace),
);

/**
 * A pending upload belongs to the MCP caller that prepared it, so another
 * caller that learns its id can neither read it nor delete it.
 */
export class McpPendingUploads extends Context.Service<
  McpPendingUploads,
  {
    readonly record: (
      attachmentId: string,
    ) => Effect.Effect<void, never, McpInvocationContext.McpInvocationContext>;
    readonly requireOwner: (
      attachmentId: string,
    ) => Effect.Effect<void, OrchestratorMcpFailure, McpInvocationContext.McpInvocationContext>;
    readonly forget: (attachmentId: string) => Effect.Effect<void>;
  }
>()("supaterm/mcp/McpPendingUploads") {}

const make = Effect.sync(() => {
  const owners = new Map<string, { readonly owner: string; readonly issuedAt: number }>();
  return McpPendingUploads.of({
    record: Effect.fn("McpPendingUploads.record")(function* (attachmentId) {
      const now = yield* Clock.currentTimeMillis;
      for (const [id, entry] of owners) {
        if (now - entry.issuedAt > OWNER_TTL_MS) owners.delete(id);
      }
      owners.set(attachmentId, { owner: yield* currentOwner, issuedAt: now });
    }),
    requireOwner: Effect.fn("McpPendingUploads.requireOwner")(function* (attachmentId) {
      if (owners.get(attachmentId)?.owner !== (yield* currentOwner)) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Only the caller that prepared a pending upload can use it.",
        });
      }
    }),
    forget: (attachmentId) =>
      Effect.sync(() => {
        owners.delete(attachmentId);
      }),
  });
});

export const layer = Layer.effect(McpPendingUploads, make);
