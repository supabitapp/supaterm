import type { ThreadId, TurnItemId } from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export const MCP_APP_MODEL_CONTEXT_MAX_BYTES = 16 * 1024;
export const MCP_APP_MODEL_CONTEXT_TURN_MAX_BYTES = 64 * 1024;
const MCP_APP_MODEL_CONTEXT_TURN_MAX_ENTRIES = 16;

export class McpAppModelContextError extends Schema.TaggedError<McpAppModelContextError>()(
  "McpAppModelContextError",
  { cause: Schema.optional(Schema.Defect()) },
) {}

export interface McpAppModelContextEntry {
  readonly itemId: string;
  readonly server: string;
  readonly tool: string;
  readonly text: string;
}

export class McpAppModelContext extends Context.Service<
  McpAppModelContext,
  {
    readonly set: (input: {
      readonly threadId: ThreadId;
      readonly itemId: TurnItemId;
      readonly server: string;
      readonly tool: string;
      readonly text: string;
    }) => Effect.Effect<void, McpAppModelContextError>;
    readonly forThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<McpAppModelContextEntry>, McpAppModelContextError>;
  }
>()("supaterm/mcpApps/McpAppModelContext") {}

export const layer = Layer.effect(
  McpAppModelContext,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fail = (cause: unknown) => new McpAppModelContextError({ cause });

    const set = Effect.fn("McpAppModelContext.set")(function* (input: {
      readonly threadId: ThreadId;
      readonly itemId: TurnItemId;
      readonly server: string;
      readonly tool: string;
      readonly text: string;
    }) {
      if (input.text.trim() === "") {
        yield* sql`
          DELETE FROM mcp_app_model_context
          WHERE thread_id = ${input.threadId} AND item_id = ${input.itemId}
        `.pipe(Effect.mapError(fail));
        return;
      }
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO mcp_app_model_context (thread_id, item_id, server, tool, text, updated_at)
        VALUES (${input.threadId}, ${input.itemId}, ${input.server}, ${input.tool}, ${input.text}, ${updatedAt})
        ON CONFLICT(thread_id, item_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
      `.pipe(Effect.mapError(fail));
    });

    const forThread = Effect.fn("McpAppModelContext.forThread")(function* (threadId: ThreadId) {
      const entries = yield* sql<McpAppModelContextEntry>`
        SELECT context.item_id AS "itemId", context.server, context.tool, context.text
        FROM mcp_app_model_context AS context
        JOIN orchestration_v2_projection_turn_items AS item
          ON item.turn_item_id = context.item_id
        LEFT JOIN orchestration_v2_projection_runs AS run
          ON run.run_id = item.run_id
        WHERE context.thread_id = ${threadId}
          AND (
            run.status IS NULL
            OR run.status <> 'rolled_back'
            OR run.thread_id <> context.thread_id
          )
        ORDER BY context.updated_at DESC, context.item_id DESC
        LIMIT ${MCP_APP_MODEL_CONTEXT_TURN_MAX_ENTRIES}
      `.pipe(Effect.mapError(fail));
      const retained: Array<McpAppModelContextEntry> = [];
      let bytes = 0;
      for (const entry of entries) {
        const entryBytes = Buffer.byteLength(entry.text, "utf8");
        if (bytes + entryBytes > MCP_APP_MODEL_CONTEXT_TURN_MAX_BYTES) continue;
        retained.push(entry);
        bytes += entryBytes;
      }
      return retained.toReversed();
    });

    return McpAppModelContext.of({ set, forThread });
  }),
);

export const layerEmpty = Layer.succeed(
  McpAppModelContext,
  McpAppModelContext.of({ set: () => Effect.void, forThread: () => Effect.succeed([]) }),
);
