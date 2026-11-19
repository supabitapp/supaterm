import { assert, it } from "@effect/vitest";
import { EnvironmentId, MessageId, ThreadId } from "@supaterm/contracts";
import { serializeAssistantCitation } from "@supaterm/shared/assistantCitations";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import Migration0001 from "./001_Baseline.ts";
import Migration0002 from "./002_ThreadMessageSearch.ts";
import Migration0003 from "./003_ActiveTurnItemIndexes.ts";
import Migration0004 from "./004_ExcludeAttachmentPlaceholdersFromSearch.ts";
import Migration0005 from "./005_SubagentDeliveryState.ts";
import Migration0006 from "./006_ProjectionProjectsPinArchive.ts";
import Migration0007 from "./007_DropOrchestrationEventCorrelationIndex.ts";
import Migration0008 from "./008_DelegatedRecoveryIndexes.ts";
import Migration0009 from "./009_ScheduledTaskThreadMode.ts";

const createdAt = "2026-10-01T00:00:00.000Z";
const quote = serializeAssistantCitation({
  version: 1,
  environmentId: EnvironmentId.make("environment:local"),
  threadId: ThreadId.make("thread:quoted"),
  messageId: MessageId.make("quoted-answer"),
  text: "A lighthouse guides ships safely through the darkness.",
  comment: "what are you talking about",
  start: 0,
  end: 54,
  prefix: "beacon01",
  suffix: "harbor",
});
const readable =
  "A lighthouse guides ships safely through the darkness.\nComment: what are you talking about";
const indexed = (sql: SqlClient.SqlClient, phrase: string) =>
  sql<{ readonly message_id: string }>`
    SELECT messages.message_id
    FROM orchestration_v2_message_search AS search
    INNER JOIN orchestration_v2_projection_messages AS messages
      ON messages.rowid = search.rowid
    WHERE orchestration_v2_message_search MATCH ${phrase}
  `.pipe(Effect.map((rows) => rows.map((row) => row.message_id)));

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "010_ProjectionMessageSearchText",
  (it) => {
    it.effect("backfills readable text only for messages whose citations read differently", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({
          loader: Migrator.fromRecord({
            "1_Baseline": Migration0001,
            "2_ThreadMessageSearch": Migration0002,
            "3_ActiveTurnItemIndexes": Migration0003,
            "4_ExcludeAttachmentPlaceholdersFromSearch": Migration0004,
            "5_SubagentDeliveryState": Migration0005,
            "6_ProjectionProjectsPinArchive": Migration0006,
            "7_DropOrchestrationEventCorrelationIndex": Migration0007,
            "8_DelegatedRecoveryIndexes": Migration0008,
            "9_ScheduledTaskThreadMode": Migration0009,
          }),
        });
        const insertMessage = (messageId: string, text: unknown) => sql`
          INSERT INTO orchestration_v2_projection_messages (
            message_id, thread_id, role, streaming, created_at, updated_at, payload_json
          ) VALUES (
            ${messageId}, 'thread:quote', 'user', 0, ${createdAt}, ${createdAt},
            ${JSON.stringify({ text })}
          )
        `;
        yield* insertMessage("quoted", `${quote} quiet silver lantern`);
        yield* insertMessage("plain", "quiet silver lantern");
        yield* insertMessage("invalid", "[Assistant quote](supaterm-citation://v1/not-a-citation)");
        yield* insertMessage("unreadable", 20261001);
        yield* insertMessage(
          "accented",
          serializeAssistantCitation({
            version: 1,
            environmentId: EnvironmentId.make("environment:local"),
            threadId: ThreadId.make("thread:quoted"),
            messageId: MessageId.make("quoted-answer"),
            text: "The kittiwake's résumé",
            start: 0,
            end: 22,
            prefix: "",
            suffix: "",
          }),
        );
        yield* Effect.forEach(
          Array.from({ length: 501 }, (_, index) => `page-${String(index).padStart(3, "0")}`),
          (messageId) => insertMessage(messageId, quote),
          { discard: true },
        );

        assert.deepEqual((yield* runMigrations())[0], [10, "ProjectionMessageSearchText"]);
        const rows = yield* sql<{
          readonly message_id: string;
          readonly search_text: string | null;
        }>`SELECT message_id, search_text FROM orchestration_v2_projection_messages`;
        const searchText = new Map(rows.map((row) => [row.message_id, row.search_text]));
        assert.equal(searchText.get("quoted"), `${readable} quiet silver lantern`);
        assert.isNull(searchText.get("plain"));
        assert.isNull(searchText.get("invalid"));
        assert.isNull(searchText.get("unreadable"));
        assert.equal(searchText.get("page-000"), readable);
        assert.equal(searchText.get("page-500"), readable);

        assert.deepEqual(yield* indexed(sql, '"résumé"'), ["accented"]);
        assert.deepEqual(yield* indexed(sql, `"kittiwake's"`), ["accented"]);
        assert.deepEqual(yield* indexed(sql, '"beacon01"'), []);
        assert.lengthOf(yield* indexed(sql, '"what are you talking about"'), 502);
      }),
    );
  },
);
