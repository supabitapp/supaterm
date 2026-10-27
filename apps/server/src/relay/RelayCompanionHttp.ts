import {
  RELAY_COMPANION_META_NAME,
  RELAY_COMPANION_REQUEST_LIMIT,
} from "@supaterm/shared/relay/protocol";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { RelayCompanion } from "./RelayCompanion.ts";
import { RelayCompanionRequest, RelayCompanionReply } from "@supaterm/contracts";

const decodeInput = Schema.decodeUnknownEffect(Schema.fromJsonString(RelayCompanionRequest));
const encodeReply = Schema.encodeEffect(Schema.fromJsonString(RelayCompanionReply));

class CompanionControlError extends Schema.TaggedError<CompanionControlError>()(
  "CompanionControlError",
  { reason: Schema.String },
) {}

export function layer(staticDir: string) {
  const controls = Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const companion = yield* RelayCompanion;
      const server = yield* HttpServer.HttpServer;
      if (!("port" in server.address)) return;
      const origin = `http://127.0.0.1:${server.address.port}`;
      yield* router.add(
        "GET",
        "/__relay/control",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin)
            return HttpServerResponse.empty({ status: 403 });
          const session = yield* companion.session;
          const socket = yield* request.upgrade;
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const commands = yield* Queue.dropping<string>(RELAY_COMPANION_REQUEST_LIMIT * 2);
          const read = Effect.forever(
            Effect.gen(function* () {
              for (const bytes of yield* reader.pull) {
                const raw =
                  typeof bytes === "string"
                    ? bytes
                    : yield* Effect.try({
                        try: () => decoder.decode(bytes),
                        catch: () => new CompanionControlError({ reason: "invalid-utf8" }),
                      });
                if (raw.length > 4096)
                  return yield* new CompanionControlError({ reason: "message-too-large" });
                if (!(yield* Queue.offer(commands, raw)))
                  return yield* new CompanionControlError({ reason: "too-many-commands" });
              }
            }),
          );
          const process = Effect.forever(
            Effect.gen(function* () {
              const input = yield* decodeInput(yield* Queue.take(commands));
              const response = yield* (
                input.action === "open"
                  ? session
                      .open(input.address, input.relayUrl, input.directUrls)
                      .pipe(Effect.map((origin) => ({ id: input.id, origin })))
                  : session.close(input.address).pipe(Effect.as({ id: input.id }))
              ).pipe(
                Effect.orElseSucceed(() => ({
                  id: input.id,
                  error: "The relay endpoint could not be prepared.",
                })),
              );
              yield* writer.write(yield* encodeReply(response));
            }),
          );
          yield* Effect.raceFirst(read, process).pipe(Effect.ignore);
          return HttpServerResponse.empty();
        }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 }))),
      );
    }),
  );
  const shell = HttpRouter.add(
    "GET",
    "/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const server = yield* HttpServer.HttpServer;
      if (
        !("port" in server.address) ||
        request.headers.host !== `127.0.0.1:${server.address.port}`
      )
        return HttpServerResponse.empty({ status: 421 });
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.realPath(staticDir);
      const pathname = new URL(request.url, "http://companion").pathname;
      const decoded = yield* Effect.try(() => decodeURIComponent(pathname));
      const candidate = path.resolve(root, `.${decoded}`);
      const real = yield* fs
        .realPath(candidate)
        .pipe(Effect.orElseSucceed(() => path.join(root, "index.html")));
      if (real !== root && !real.startsWith(root + path.sep))
        return HttpServerResponse.empty({ status: 404 });
      const entry = real === root ? path.join(root, "index.html") : real;
      if (entry === path.join(root, "index.html")) {
        const html = yield* fs.readFileString(entry);
        return HttpServerResponse.text(
          html.replace("<head>", `<head><meta name="${RELAY_COMPANION_META_NAME}" content="1">`),
          {
            contentType: "text/html",
            headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
          },
        );
      }
      return yield* HttpServerResponse.file(entry, {
        headers: { "x-content-type-options": "nosniff" },
      });
    }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 404 }))),
  );
  return Layer.merge(controls, shell);
}
