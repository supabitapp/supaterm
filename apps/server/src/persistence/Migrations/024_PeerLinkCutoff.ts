import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Links made before this ran end here: SessionStore refuses older peer-link sessions, whose
  // `iat` comes from the same Effect clock as this cutoff.
  yield* sql`
    CREATE TABLE peer_link_cutoff (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cutoff_ms INTEGER NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO peer_link_cutoff (id, cutoff_ms)
    VALUES (1, ${(yield* DateTime.now).epochMilliseconds})
  `;
  // The forgotten links' tokens stay in the secret store; nothing names them any more.
  yield* sql`DELETE FROM peer_environment_links`;
});
