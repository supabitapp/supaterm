import type { DesktopUpdateChannel } from "@supaterm/contracts";
import {
  CLI_RELEASE_CHECKSUMS_FILE,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@supaterm/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optionalKey(Schema.Boolean),
    assets: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
);

export interface ArchiveRelease {
  readonly version: string;
  readonly databaseMigration: number | undefined;
}

export const loadArchiveRelease = Effect.fn("web.loadArchiveRelease")(function* (
  channel: DesktopUpdateChannel,
) {
  for (let page = 1; page <= 10; page += 1) {
    const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((ok) => ok.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ReleaseIndex)),
    );
    const published = body.filter((release) => {
      const version = release.tag_name.replace(/^v/, "");
      return (
        release.assets.some((asset) => asset.name === CLI_RELEASE_CHECKSUMS_FILE) &&
        release.assets.some(
          (asset) =>
            asset.name.startsWith(`supaterm-${version}-`) && /\.(?:zip|tar\.gz)$/.test(asset.name),
        )
      );
    });
    const version = newestCliReleaseVersion(
      published,
      channel === "nightly" ? "nightly" : "stable",
    );
    if (version !== undefined)
      return { version, databaseMigration: undefined } satisfies ArchiveRelease;
    if (body.length === 0) break;
  }
  return null;
});

export const archiveReleaseAtom = Atom.family((channel: DesktopUpdateChannel) =>
  Atom.make(
    loadArchiveRelease(channel).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`archive-release:${channel}`)),
);
