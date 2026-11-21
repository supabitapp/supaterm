import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Links made while links had a switch end here; SessionStore refuses their generation-1
  // sessions on the other side. Their tokens stay in the secret store, named by nothing.
  yield* sql`DELETE FROM peer_environment_links`;
});
