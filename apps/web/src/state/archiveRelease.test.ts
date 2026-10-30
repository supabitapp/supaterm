import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";

import { loadArchiveRelease } from "./archiveRelease";

function release(version: string, draft = false) {
  return {
    tag_name: `v${version}`,
    draft,
    assets: [{ name: "SHA256SUMS" }, { name: `supaterm-${version}-linux-x64.tar.gz` }],
  };
}

it.effect(
  "finds a published archive on the requested track beyond the first page without inventing migration metadata",
  () =>
    Effect.gen(function* () {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json([release("26.10.29-nightly.20261029.1")]))
        .mockResolvedValueOnce(Response.json([release("26.10.29", true), release("26.10.28")]));
      const result = yield* loadArchiveRelease("latest").pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
      expect(result).toEqual({ version: "26.10.28", databaseMigration: undefined });
      expect(fetch).toHaveBeenCalledTimes(2);
    }),
);

it.effect("ignores releases whose archive or checksum manifest has not been published", () =>
  Effect.gen(function* () {
    const incomplete = { ...release("26.10.29"), assets: [] };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json([incomplete]))
      .mockResolvedValueOnce(Response.json([]));
    const result = yield* loadArchiveRelease("latest").pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
    expect(result).toBeNull();
  }),
);
