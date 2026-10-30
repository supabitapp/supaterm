import {
  GUEST_ATTACHMENT_ROUTE,
  GUEST_COMMAND_OUTPUT_ROUTE,
  GUEST_ITEM_ROUTE,
  GUEST_MEDIA_ROUTE,
  GUEST_RENDER_ROUTE,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  GUEST_MESSAGE_MAX_ATTACHMENTS,
  GuestRedeemRequest,
  GuestStreamEvent,
  GuestSubmitRequest,
  isProviderSendTurnSupportedImageMimeType,
  OrchestrationV2CommandOutputFrame,
  OrchestrationV2GetTurnItemResult,
} from "@supaterm/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse, Multipart } from "effect/http";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

import { htmlRenderFileName } from "@supaterm/shared/htmlRender";

import { assetFileResponse, downloadContentDisposition } from "../http.ts";
import { tunnelConnectionMethod } from "../relay/RelayIngress.ts";
import type { GuestUpload } from "./guestAttachments.ts";
import { GuestShareAccessError, GuestShareService } from "./GuestShareService.ts";
const HEARTBEAT_INTERVAL = Duration.seconds(20);
const NO_STORE = { "cache-control": "no-store" };
const FILE_HEADERS = {
  ...NO_STORE,
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
};

const decodeRedeem = Schema.decodeUnknownEffect(GuestRedeemRequest);
const decodeSubmit = Schema.decodeUnknownEffect(GuestSubmitRequest);
const encodeStreamEvent = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)),
);
const encodeOutputFrame = Schema.encodeEffect(
  Schema.fromJsonString(OrchestrationV2CommandOutputFrame),
);
const encodeItem = Schema.encodeEffect(Schema.toCodecJson(OrchestrationV2GetTurnItemResult));

const errorResponse = (error: GuestShareAccessError) =>
  HttpServerResponse.json(
    { reason: error.reason, message: error.message },
    {
      status:
        error.reason === "invalid" || error.reason === "inactive" || error.reason === "unavailable"
          ? 403
          : error.reason === "empty" ||
              error.reason === "too_many_files" ||
              error.reason === "too_large" ||
              error.reason === "unsupported_file"
            ? 400
            : 409,
      headers: NO_STORE,
    },
  );

const badRequest = HttpServerResponse.json(
  { reason: "invalid", message: "The request was not valid." },
  { status: 400, headers: NO_STORE },
);

const sessionFor = (request: HttpServerRequest.HttpServerRequest, shareId: string | null) =>
  shareId === null
    ? ""
    : (/^Bearer ([A-Za-z0-9_.-]{1,2048})$/.exec(request.headers.authorization ?? "")?.[1] ?? "");

const requestedShareId = (request: HttpServerRequest.HttpServerRequest) =>
  new URLSearchParams(request.url.split("?", 2)[1] ?? "").get(GUEST_SHARE_PARAM);

const sessionToken = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  sessionFor(request, requestedShareId(request)),
);

const itemParam = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("item"),
);

const eventStreamResponse = <A>(
  events: Stream.Stream<A>,
  encode: (event: A) => Effect.Effect<string, Schema.SchemaError>,
) => {
  const data = events.pipe(
    Stream.mapEffect((event) =>
      encode(event).pipe(
        Effect.map((json) => [`data: ${json}\n\n`]),
        Effect.catch(() =>
          Effect.logWarning("Dropped a guest stream event that failed to encode.").pipe(
            Effect.as([]),
          ),
        ),
      ),
    ),
    Stream.flattenIterable,
  );
  const heartbeat = Stream.tick(HEARTBEAT_INTERVAL).pipe(Stream.map(() => ": ping\n\n"));
  return HttpServerResponse.stream(
    data.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
    {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
    },
  );
};
const JSON_MAX_BODY_BYTES = 64 * 1024;
const readJson = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? "0") > JSON_MAX_BODY_BYTES) {
    return yield* new GuestShareAccessError({ reason: "too_large" });
  }
  return yield* request.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(JSON_MAX_BODY_BYTES)),
  );
});

const redeemRoute = HttpRouter.add(
  "POST",
  `${GUEST_ROUTE_PREFIX}/redeem`,
  Effect.gen(function* () {
    const body = yield* readJson.pipe(Effect.flatMap(decodeRedeem), Effect.option);
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.redeem(body.value).pipe(
      Effect.flatMap(({ token, shareId }) =>
        HttpServerResponse.json({ token, shareId }, { headers: NO_STORE }),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);
const UPLOAD_LIMITS = Multipart.limitsServices({
  maxParts: GUEST_MESSAGE_MAX_ATTACHMENTS + 4,
  maxFileSize: GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  maxTotalSize: GUEST_MESSAGE_MAX_ATTACHMENT_BYTES + 64 * 1024,
  fieldMimeTypes: [],
});

export const readSubmission = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (!request.headers["content-type"]?.startsWith("multipart/form-data")) {
    const body = yield* readJson.pipe(Effect.flatMap(decodeSubmit), Effect.option);
    return body._tag === "None" ? null : { fields: body.value, uploads: [] };
  }
  const parts = yield* request.multipart.pipe(
    Effect.provideContext(UPLOAD_LIMITS),
    Effect.mapError(
      (error) =>
        new GuestShareAccessError({
          reason:
            error.reason._tag === "TooManyParts"
              ? "too_many_files"
              : error.reason._tag === "Parse"
                ? "rejected"
                : "too_large",
        }),
    ),
  );
  const fields = yield* decodeSubmit({ shareId: parts.shareId, text: parts.text ?? "" }).pipe(
    Effect.option,
  );
  if (fields._tag === "None") return null;
  const files = parts.file;
  const uploads: ReadonlyArray<GuestUpload> = Array.isArray(files)
    ? files.filter(Multipart.isPersistedFile).map(({ name, contentType, path }) => ({
        name,
        contentType,
        path,
      }))
    : [];
  return { fields: fields.value, uploads };
});

const submitRoute = HttpRouter.add(
  "POST",
  `${GUEST_ROUTE_PREFIX}/messages`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const guestShares = yield* GuestShareService;
    const shareId = requestedShareId(request);
    const session = sessionFor(request, shareId);
    yield* guestShares.check(session);
    const submission = yield* readSubmission;
    if (submission === null || submission.fields.shareId !== shareId) return yield* badRequest;
    yield* guestShares.submit(session, submission.fields, submission.uploads);
    return HttpServerResponse.empty({ status: 204, headers: NO_STORE });
  }).pipe(Effect.catchTags({ GuestShareAccessError: errorResponse }), Effect.scoped),
);

const streamRoute = HttpRouter.add(
  "GET",
  `${GUEST_ROUTE_PREFIX}/stream`,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares.stream(yield* sessionToken).pipe(
      Effect.map((events) => eventStreamResponse(events, encodeStreamEvent)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);
const sessionRoute = HttpRouter.add(
  "GET",
  `${GUEST_ROUTE_PREFIX}/session`,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .check(yield* sessionToken)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);
const renderRoute = HttpRouter.add(
  "GET",
  GUEST_RENDER_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.render(yield* sessionToken, itemId).pipe(
      Effect.flatMap(({ path, title }) =>
        assetFileResponse({ path, mimeType: "text/html", fileName: htmlRenderFileName(title) }),
      ),
      Effect.map((response) => HttpServerResponse.setHeaders(response, NO_STORE)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const itemRoute = HttpRouter.add(
  "GET",
  GUEST_ITEM_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.item(yield* sessionToken, itemId).pipe(
      Effect.flatMap((result) =>
        encodeItem(result).pipe(
          Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
        ),
      ),
      Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);
const commandOutputRoute = HttpRouter.add(
  "GET",
  GUEST_COMMAND_OUTPUT_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.commandOutput(yield* sessionToken, itemId).pipe(
      Effect.map((frames) => eventStreamResponse(frames, encodeOutputFrame)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);
const attachmentRoute = HttpRouter.add(
  "GET",
  GUEST_ATTACHMENT_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const attachmentId = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("id");
    if (!attachmentId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.attachment(yield* sessionToken, attachmentId).pipe(
      Effect.flatMap(({ path, attachment }) =>
        HttpServerResponse.file(path, {
          headers: {
            ...FILE_HEADERS,
            ...(attachment.type === "image" &&
            isProviderSendTurnSupportedImageMimeType(attachment.mimeType)
              ? { "content-type": attachment.mimeType }
              : {
                  "content-type": "application/octet-stream",
                  "content-disposition": downloadContentDisposition(attachment.name),
                }),
          },
        }),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 500, headers: NO_STORE })),
    );
  }),
);
const mediaRoute = HttpRouter.add(
  "GET",
  GUEST_MEDIA_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("path");
    if (!path) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.media(yield* sessionToken, path).pipe(
      Effect.flatMap(({ path, mimeType }) =>
        HttpServerResponse.file(path, { headers: { ...FILE_HEADERS, "content-type": mimeType } }),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 500, headers: NO_STORE })),
    );
  }),
);

const encryptedOnly = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        new URL(request.url, "http://guest").pathname.startsWith(`${GUEST_ROUTE_PREFIX}/`) &&
        tunnelConnectionMethod(request) === undefined
      ) {
        return yield* errorResponse(new GuestShareAccessError({ reason: "invalid" }));
      }
      return yield* app;
    }),
  { global: true },
);

export const layer = Layer.mergeAll(
  redeemRoute,
  sessionRoute,
  submitRoute,
  streamRoute,
  renderRoute,
  itemRoute,
  commandOutputRoute,
  attachmentRoute,
  mediaRoute,
  encryptedOnly,
);
