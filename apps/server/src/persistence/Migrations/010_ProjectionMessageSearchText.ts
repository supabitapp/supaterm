import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import {
  readableSearchText,
  recreateMessageSearchTriggers,
} from "../../orchestration-v2/messageSearchIndex.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE orchestration_v2_projection_messages ADD COLUMN search_text TEXT`;

  yield* recreateMessageSearchTriggers(sql);

  const pageSize = 500;
  let afterMessageId = "";
  while (true) {
    const rows = yield* sql<{ readonly message_id: string; readonly text: string }>`
      SELECT message_id, json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages
      WHERE message_id > ${afterMessageId}
        AND payload_json LIKE '%supaterm-citation://%'
        AND json_type(payload_json, '$.text') = 'text'
      ORDER BY message_id
      LIMIT ${pageSize}
    `;
    for (const row of rows) {
      const searchText = readableSearchText(row.text);
      if (searchText === null) continue;
      yield* sql`
        UPDATE orchestration_v2_projection_messages
        SET search_text = ${searchText}
        WHERE message_id = ${row.message_id}
      `;
    }
    if (rows.length < pageSize) break;
    afterMessageId = rows.at(-1)!.message_id;
  }
});
