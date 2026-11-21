import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as AuthSessions from "../AuthSessions.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("024_PeerLinkCutoff", (it) => {
  it.effect("forgets every saved link and records when it ran", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 23 });
      const sessions = yield* AuthSessions.make;
      assert.isTrue(Option.isNone(yield* sessions.peerLinkCutoff));
      yield* sql`
        INSERT INTO peer_environment_links (
          environment_id, secret_name, label, urls_json, access, linked_at, expires_at
        ) VALUES (
          'box', 'peer-link:box', 'Box', '["https://box.example"]', 'auto',
          '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z'
        )
      `;

      yield* TestClock.adjust(Duration.hours(1));
      yield* runMigrations();
      assert.deepStrictEqual(yield* sql`SELECT environment_id FROM peer_environment_links`, []);
      assert.strictEqual(
        Option.getOrUndefined(yield* sessions.peerLinkCutoff),
        (yield* DateTime.now).epochMilliseconds,
      );
    }),
  );
});
