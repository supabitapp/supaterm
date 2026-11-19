import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "./Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("021_TurnItemInlineWorkOutput", (it) => {
  it.effect("flags existing dynamic tools whose output renders inline", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 20 });
      const rows: ReadonlyArray<readonly [string, string, object, number]> = [
        [
          "delegate",
          "dynamic_tool",
          {
            toolName: "mcp__supaterm__delegate_task",
            input: { prompt: "Port the batch" },
            output: { content: '{"taskId":"node:delegated-task:1","childThreadId":"thread:1"}' },
          },
          1,
        ],
        ["html", "dynamic_tool", { toolName: "x", output: { htmlRender: {} } }, 1],
        ["mcp-app", "dynamic_tool", { toolName: "x", output: { supatermMcpApp: {} } }, 1],
        ["image", "dynamic_tool", { toolName: "view_image", viewedImagePath: "/a.png" }, 1],
        [
          "send",
          "dynamic_tool",
          {
            toolName: "mcp__supaterm__send_to_user",
            input: { message: "Done" },
            output: { content: '{"sentMessage":"Done"}' },
          },
          1,
        ],
        ["sent", "dynamic_tool", { toolName: "execute", output: '{"sentMessage":"Hi"}' }, 1],
        ["plain", "dynamic_tool", { toolName: "mcp__docs__search", output: "ok" }, 0],
        [
          "read-mentioning-delegate",
          "dynamic_tool",
          {
            toolName: "Read",
            input: { file_path: "/tmp/notes.md" },
            output: {
              type: "text",
              file: { content: 'Call "mcp__supaterm__delegate_task" later' },
            },
          },
          0,
        ],
        ["command", "command_execution", { output: "htmlRender" }, 0],
      ];
      for (const [id, type, payload] of rows) {
        yield* sql`
          INSERT INTO orchestration_v2_projection_turn_items (
            turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
          ) VALUES (
            ${id}, 'thread-1', 0, ${type}, 'completed', '2026-11-01T00:00:00.000Z',
            ${JSON.stringify({ type, ...payload })}
          )
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 21 });
      const flagged = yield* sql<{ readonly turn_item_id: string; readonly inline: number }>`
        SELECT turn_item_id, inline_work_output AS inline
        FROM orchestration_v2_projection_turn_items
      `;
      assert.deepStrictEqual(
        new Map(flagged.map((row) => [row.turn_item_id, row.inline])),
        new Map(rows.map(([id, , , inline]) => [id, inline])),
      );
    }),
  );
});
