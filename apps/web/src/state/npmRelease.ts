import { type ServerConfig, ServerNpmReleaseError } from "@supaterm/contracts";
import { npmReleaseDatabaseMigration } from "@supaterm/shared/cliRelease";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

export interface NpmRelease {
  readonly version: string;
  /** Absent on releases published before npm manifests carried it. */
  readonly databaseMigration: number | undefined;
}

const isServerNpmReleaseError = Schema.is(ServerNpmReleaseError);

const supportsLookup = (config: ServerConfig | null) =>
  config?.environment.capabilities.npmReleaseLookup === true;

export function npmReleaseFailureMessage(cause: Cause.Cause<unknown>): string {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return isServerNpmReleaseError(error)
    ? error.message
    : "Could not check this environment's npm registry. Check the connection and registry settings.";
}

/** Servers released before `npmReleaseLookup` cannot read their own registry, so ask public npm. */
const publicNpmReleaseAtom = Atom.family((spec: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        `https://registry.npmjs.org/supaterm/${encodeURIComponent(spec)}`,
      );
      if (response.status === 404) return null;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      if (
        typeof body !== "object" ||
        body === null ||
        !("version" in body) ||
        typeof body.version !== "string"
      ) {
        return null;
      }
      return {
        version: body.version,
        databaseMigration: npmReleaseDatabaseMigration(body),
      } satisfies NpmRelease;
    }).pipe(
      // Tracing headers would make the browser send a CORS preflight, which npm rejects.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`npm-release:public:${spec}`)),
);

/** `spec` is an exact version or a dist-tag such as `nightly`. Null when npm has no such release. */
export const npmReleaseAtom = Atom.family((spec: string) =>
  Atom.make((get) => {
    const primary = get(primaryEnvironmentIdAtom);
    // With the desktop's local server turned off there is no primary, so a connected server answers.
    const candidates =
      primary === null ? get(environmentSummaries.connectedEnvironmentIdsAtom) : [primary];
    const environmentId =
      candidates.find((id) => supportsLookup(get(serverEnvironment.configValueAtom(id)))) ??
      candidates[0];
    if (environmentId === undefined) {
      return Effect.fail(
        new ServerNpmReleaseError({ reason: "Connect to a server to check releases." }),
      );
    }
    const config = get(serverEnvironment.configValueAtom(environmentId));
    if (config === null) {
      return Effect.fail(
        new ServerNpmReleaseError({ reason: "Connect to this server to check releases." }),
      );
    }
    if (!supportsLookup(config)) return get.result(publicNpmReleaseAtom(spec));
    return get
      .result(serverEnvironment.npmRelease({ environmentId, input: { spec } }))
      .pipe(
        Effect.map((release) =>
          release === null
            ? null
            : { version: release.version, databaseMigration: release.databaseMigration },
        ),
      );
  }).pipe(Atom.withLabel(`npm-release:${spec}`)),
);
