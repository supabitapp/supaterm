import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@supaterm/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import peerLinks from "./004_PeerLinks.ts";
import peerLinkFence from "./005_PeerLinkFence.ts";
import peerRelayLinks from "./007_PeerRelayLinks.ts";

it.effect("adds relay identities without trusting previously unfenced links", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* peerLinks;
    yield* peerLinkFence;
    yield* sql`INSERT INTO peer_environment_links (
      environment_id, secret_name, label, urls_json, access, linked_at, expires_at
    ) VALUES ('existing', 'credential-key', 'Existing', '[]', 'read-only', '2026-10-01', '2026-11-01')`;
    yield* peerRelayLinks;
    const existing = yield* sql<{ readonly fenced: number; readonly relay_json: string | null }>`
      SELECT fenced, relay_json FROM peer_environment_links WHERE environment_id = 'existing'
    `;
    assert.deepEqual(existing, [{ fenced: 0, relay_json: null }]);
    yield* sql`UPDATE peer_environment_links SET fenced = 1, relay_json = ${JSON.stringify({ address: "pinned-identity" })}
      WHERE environment_id = 'existing'`;
    const upgraded = yield* sql<{ readonly fenced: number; readonly relay_json: string }>`
      SELECT fenced, relay_json FROM peer_environment_links WHERE environment_id = 'existing'
    `;
    assert.deepEqual(upgraded, [{ fenced: 1, relay_json: '{"address":"pinned-identity"}' }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
