import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

export type NativePlatform = "ios" | "android";

type Tar<E, R> = (args: string[]) => Effect.Effect<unknown, E, R>;

export class NativeClientError extends Schema.TaggedError<NativeClientError>()(
  "NativeClientError",
  { message: Schema.String },
) {}

const isNotLink = Schema.is(Schema.Struct({ code: Schema.Literal("EINVAL") }));

export const digest = Effect.fn("nativeClient.digest")(function* (value: string | Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  const bytes = yield* crypto.digest(
    "SHA-256",
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
});

export const hashBundle = Effect.fn("hashBundle")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries: string[] = [];
  const visit = Effect.fn("mobile-native-client.visit")(function* (
    relative: string,
  ): Effect.fn.Return<void, FileSystemError, FileSystem.FileSystem | Crypto.Crypto> {
    const names = (yield* fs.readDirectory(path.join(root, relative))).sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    for (const name of names) {
      const key = path.join(relative, name);
      const absolute = path.join(root, key);

      const link = yield* fs.readLink(absolute).pipe(
        Effect.catchIf(
          (error) => isNotLink(error.reason.cause),
          () => Effect.succeed(null),
        ),
      );
      if (link !== null) {
        entries.push(`link:${key}:${link}`);
        continue;
      }
      const info = yield* fs.stat(absolute);
      if (info.type === "Directory") {
        entries.push(`directory:${key}`);
        yield* visit(key);
      } else {
        const chunks = yield* fs.stream(absolute, { chunkSize: 65536 }).pipe(
          Stream.mapEffect((chunk) => digest(chunk)),
          Stream.runCollect,
        );
        entries.push(`file:${key}:${yield* digest(chunks.join("\n"))}`);
      }
    }
  });
  yield* visit("");
  return yield* digest(entries.map((entry) => `${entry.length}:${entry}`).join(""));
});
type FileSystemError = import("effect/PlatformError").PlatformError;

export const artifactNames = { ios: "SupatermDev.app", android: "app-debug.apk" } as const;

const partSize = 64 * 1024 * 1024;
const RemoteCredentials = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Struct({ name: Schema.String, token: Schema.String })),
);
const decodeCredentials = Schema.decodeUnknownEffect(RemoteCredentials);
const decodeEndpoint = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ endpoint: Schema.String })),
);
const decodeUpload = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({ exists: Schema.Literal(true) }),
    Schema.Struct({ uploadId: Schema.String }),
  ]),
);
const decodePart = Schema.decodeUnknownEffect(Schema.Struct({ etag: Schema.String }));
interface RemoteCache {
  readonly url: string;
  readonly telemetry: string;
  readonly name: string;
  readonly token: string;
}

const remoteCache = Effect.fn("nativeClient.remoteCache")(
  function* (home: string) {
    const environment = yield* HostProcess.Environment;
    if (environment.SUPATERM_NATIVE_CLIENT_CACHE === "off") return null;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { endpoint } = yield* decodeEndpoint(
      yield* fs.readFileString(
        path.join(yield* path.fromFileUrl(new URL("../", import.meta.url)), ".task-cache.json"),
      ),
    );
    const credentials = yield* decodeCredentials(
      yield* fs.readFileString(path.join(home, ".config/supaterm-task-cache/credentials.json")),
    );
    const login = credentials[endpoint];
    if (!login) return null;
    const base = endpoint.replace(/\/$/, "");
    return {
      url: `${base}/native-clients`,
      telemetry: `${base}/telemetry`,
      ...login,
    } satisfies RemoteCache;
  },
  Effect.orElseSucceed(() => null),
);

const ReaderLogin = Schema.fromJsonString(
  Schema.Struct({ name: Schema.String, token: Schema.String }),
);

export const sharedSource = Effect.fn("nativeClient.sharedSource")(
  function* (home: string, key: string) {
    const remote = yield* remoteCache(home);
    if (!remote) return null;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const reader =
      remote.name === "ci-reader"
        ? remote
        : yield* fs
            .readFileString(path.join(home, ".config/supaterm-task-cache/ci-reader.json"))
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(ReaderLogin)));
    const basic = Buffer.from(`${reader.name}:${reader.token}`).toString("base64");
    return { url: `${remote.url}/${key}`, header: `authorization:Basic ${basic}` };
  },
  Effect.orElseSucceed(() => null),
);

const authorized = (remote: RemoteCache, request: HttpClientRequest.HttpClientRequest) =>
  request.pipe(HttpClientRequest.basicAuth(remote.name, remote.token));

const sidecar = (directory: string) => `${directory}.json`;
const ArtifactMetadata = Schema.Struct({
  buildMs: Schema.Number,
  digest: Schema.optional(Schema.String),
});
const decodeSidecar = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactMetadata));
const encodeSidecar = Schema.encodeEffect(Schema.fromJsonString(ArtifactMetadata));
const readBuildMs = (directory: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(sidecar(directory))),
    Effect.flatMap(decodeSidecar),
    Effect.map(({ buildMs }) => buildMs),
    Effect.orElseSucceed(() => 0),
  );
const writeBuildMs = Effect.fn("nativeClient.writeBuildMetadata")(function* (
  directory: string,
  buildMs: number,
) {
  const fs = yield* FileSystem.FileSystem;
  const contentDigest = yield* hashBundle(directory);
  yield* fs.writeFileString(
    sidecar(directory),
    yield* encodeSidecar({ buildMs, digest: contentDigest }),
  );
});

const validArtifact = Effect.fn("nativeClient.validArtifact")(
  function* (directory: string) {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* fs
      .readFileString(sidecar(directory))
      .pipe(Effect.flatMap(decodeSidecar));
    return metadata.digest !== undefined && metadata.digest === (yield* hashBundle(directory));
  },
  Effect.orElseSucceed(() => false),
);

const download = Effect.fn("nativeClient.download")(function* <E, R>(
  remote: RemoteCache,
  platform: NativePlatform,
  key: string,
  target: string,
  tar: Tar<E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    authorized(remote, HttpClientRequest.get(`${remote.url}/${key}`)),
  );
  if (response.status === 404) return false;
  yield* HttpClientResponse.filterStatusOk(response);
  const expected = response.headers["x-supaterm-digest"] ?? "";
  if (!/^[a-f0-9]{64}$/.test(expected))
    return yield* new NativeClientError({ message: "Cached native client has no digest." });
  yield* Console.error(`Downloading native client ${key} from the shared cache...`);
  const staging = yield* fs.makeTempDirectory({
    directory: path.dirname(target),
    prefix: ".download-",
  });
  return yield* Effect.gen(function* () {
    if (platform === "ios") {
      const archive = `${staging}.tgz`;
      yield* response.stream.pipe(
        Stream.run(fs.sink(archive)),
        Effect.andThen(tar(["-xzf", archive, "-C", staging])),
        Effect.ensuring(fs.remove(archive, { force: true }).pipe(Effect.ignore)),
      );
    } else {
      yield* response.stream.pipe(Stream.run(fs.sink(path.join(staging, artifactNames.android))));
    }
    if ((yield* hashBundle(staging)) !== expected)
      return yield* new NativeClientError({ message: "Cached native client failed verification." });
    yield* publish(staging, target);
    const buildMs = Number(response.headers["x-supaterm-build-ms"] ?? 0);
    yield* writeBuildMs(target, Number.isSafeInteger(buildMs) ? buildMs : 0);
    return true;
  }).pipe(
    Effect.ensuring(fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

const upload = Effect.fn("nativeClient.upload")(function* <E, R>(
  remote: RemoteCache,
  platform: NativePlatform,
  key: string,
  artifact: string,
  tar: Tar<E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const created = yield* client
    .execute(
      authorized(remote, HttpClientRequest.post(`${remote.url}/${key}/uploads`)).pipe(
        HttpClientRequest.setHeader("x-supaterm-digest", yield* hashBundle(artifact)),
        HttpClientRequest.setHeader("x-supaterm-build-ms", String(yield* readBuildMs(artifact))),
      ),
    )
    .pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(decodeUpload),
    );
  if ("exists" in created) return;
  const uploadUrl = `${remote.url}/${key}/uploads/${encodeURIComponent(created.uploadId)}`;
  yield* Console.error(`Uploading native client ${key} to the shared cache...`);
  yield* Effect.gen(function* () {
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-native-upload-" });
    const file =
      platform === "ios"
        ? path.join(directory, "client.tgz")
        : path.join(artifact, artifactNames.android);
    if (platform === "ios") yield* tar(["-czf", file, "-C", artifact, artifactNames.ios]);
    const handle = yield* fs.open(file);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let partNumber = 1; ; partNumber++) {
      const buffer = new Uint8Array(partSize);
      let filled = 0;
      while (filled < partSize) {
        const read = Number(yield* handle.read(buffer.subarray(filled)));
        if (read === 0) break;
        filled += read;
      }
      if (filled === 0) break;
      const { etag } = yield* client
        .execute(
          authorized(remote, HttpClientRequest.put(`${uploadUrl}/${partNumber}`)).pipe(
            HttpClientRequest.bodyUint8Array(buffer.subarray(0, filled)),
          ),
        )
        .pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(decodePart),
        );
      parts.push({ partNumber, etag });
      if (filled < partSize) break;
    }
    yield* client.execute(
      authorized(remote, HttpClientRequest.post(`${uploadUrl}/complete`)).pipe(
        HttpClientRequest.bodyJsonUnsafe({ parts }),
      ),
    );
  }).pipe(
    Effect.scoped,
    Effect.onError(() =>
      client.execute(authorized(remote, HttpClientRequest.delete(uploadUrl))).pipe(Effect.ignore),
    ),
  );
});

export const publish = Effect.fn("nativeClient.publish")(function* (
  staging: string,
  target: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (yield* fs.exists(target)) return;
  yield* fs.rename(staging, target);
});

export const prune = Effect.fn("nativeClient.prune")(
  function* (parent: string, keep: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* Effect.forEach(
      (yield* fs.readDirectory(parent)).filter(
        (name) => !name.startsWith(".") && !name.endsWith(".json"),
      ),
      (name) =>
        fs.stat(path.join(parent, name)).pipe(
          Effect.map((info) => ({
            name,
            modified: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
          })),
        ),
    );
    const stale = entries
      .filter(({ name }) => name !== keep)
      .sort((a, b) => b.modified - a.modified)
      .slice(2);
    yield* Effect.forEach(
      stale,
      ({ name }) =>
        fs
          .remove(path.join(parent, name), { recursive: true, force: true })
          .pipe(Effect.andThen(fs.remove(sidecar(path.join(parent, name)), { force: true }))),
      { discard: true },
    );
  },
  (effect) => Effect.ignore(effect),
);

export const acquireArtifact = Effect.fn("nativeArtifact.acquire")(function* <E, R, E2, R2>(
  home: string,
  platform: NativePlatform,
  abi: string | null,
  fingerprint: string,
  operations: {
    build: (directory: string) => Effect.Effect<number, E, R>;
    tar: Tar<E2, R2>;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const key = `${platform}/${abi ? `development-${abi}` : "development"}/${fingerprint}`;
  const directory = path.join(home, ".cache/supaterm/native-clients/artifacts", key);
  const artifact = { directory, file: path.join(directory, artifactNames[platform]) };
  if ((yield* fs.exists(artifact.file)) && (yield* validArtifact(directory))) {
    yield* Console.error(`Using cached client ${key}.`);

    const now = yield* Clock.currentTimeMillis;
    yield* fs.utimes(directory, now / 1000, now / 1000).pipe(Effect.ignore);
    return { ...artifact, source: "local" as const, buildMs: yield* readBuildMs(directory) };
  }
  yield* fs.makeDirectory(path.dirname(directory), { recursive: true });
  return yield* Effect.acquireUseRelease(
    fs.makeDirectory(`${directory}.lock`).pipe(
      Effect.mapError(
        () =>
          new NativeClientError({
            message: `Another process is preparing ${key}. If none is running, remove ${directory}.lock and retry.`,
          }),
      ),
    ),
    () =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(directory), { recursive: true });
        if ((yield* fs.exists(artifact.file)) && (yield* validArtifact(directory))) {
          return { ...artifact, source: "local" as const, buildMs: yield* readBuildMs(directory) };
        }
        if (yield* fs.exists(directory)) yield* fs.remove(directory, { recursive: true });
        const remote = yield* remoteCache(home);
        if (remote) {
          const downloaded = yield* download(remote, platform, key, directory, operations.tar).pipe(
            Effect.catch((error) =>
              Console.error(`Shared native client cache unavailable (${describe(error)}).`).pipe(
                Effect.as(false),
              ),
            ),
          );
          if (downloaded) {
            yield* prune(path.dirname(directory), fingerprint);
            return {
              ...artifact,
              source: "remote" as const,
              buildMs: yield* readBuildMs(directory),
            };
          }
        }
        const buildMs = yield* operations.build(directory);
        yield* writeBuildMs(directory, buildMs);
        yield* prune(path.dirname(directory), fingerprint);
        if (remote && (yield* HostProcess.Environment).SUPATERM_NATIVE_CLIENT_CACHE !== "read") {
          yield* upload(remote, platform, key, directory, operations.tar).pipe(
            Effect.catch((error) =>
              Console.error(`Native client was not shared (${describe(error)}).`),
            ),
          );
        }
        return { ...artifact, source: "build" as const, buildMs: 0 };
      }),
    () => fs.remove(`${directory}.lock`, { recursive: true, force: true }),
  );
});

export const describe = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : String(error);

export const reportTelemetry = Effect.fn("nativeClient.reportTelemetry")(
  function* (
    home: string,
    task: string,
    source: "local" | "remote" | "executed" | "failed",
    savedMs: number,
  ) {
    const environment = yield* HostProcess.Environment;
    if (environment.SUPATERM_TASK_CACHE_TELEMETRY !== "on") return;
    const remote = yield* remoteCache(home);
    if (!remote) return;
    const recordedAt = yield* Clock.currentTimeMillis;

    const fs = yield* FileSystem.FileSystem;
    const machine = yield* fs.readFileString(`${home}/.agents/MACHINE`).pipe(
      Effect.map((value) => value.trim()),
      Effect.orElseSucceed(() => ""),
    );
    const host =
      environment.SUPATERM_TASK_CACHE_HOST ||
      machine ||
      (environment.GITHUB_ACTIONS === "true"
        ? `${environment.RUNNER_ENVIRONMENT || "github"}/${environment.RUNNER_OS}/${environment.RUNNER_ARCH}`
        : yield* HostProcess.Hostname);
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    yield* client.execute(
      authorized(remote, HttpClientRequest.post(remote.telemetry)).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          id: yield* digest(`${host}:${task}:${recordedAt}:${yield* Random.nextInt}`),
          recordedAt,
          host,
          platform: yield* HostProcess.Platform,
          arch: yield* HostProcess.Architecture,
          ci: environment.CI === "true" || environment.CI === "1",
          runId: environment.GITHUB_RUN_ID ?? "",
          tasks: [{ package: "@supaterm/mobile", task, source, savedMs: Math.round(savedMs) }],
        }),
      ),
    );
  },
  (effect) => effect.pipe(Effect.timeout("5 seconds"), Effect.ignore),
);
