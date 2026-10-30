import {
  type ChatAttachment,
  ChatAttachmentId,
  CommandId,
  GUEST_SHARE_TTL_MS,
  GuestMessageId,
  GuestShareCreateError,
  type GuestShareCreateInput,
  type GuestShareCreateResult,
  GuestShareId,
  GuestLinkPayload,
  type GuestRedeemRequest,
  type GuestStreamEvent,
  type GuestSubmitRequest,
  type OrchestrationV2AppThread,
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2GetTurnItemResult,
  type OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import { chatMarkdownImageSources } from "@supaterm/shared/markdownPipeline";
import { htmlRenderFromToolItem } from "@supaterm/shared/toolOutput";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  attachmentFileExtension,
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
  threadHtmlRenderAttachmentIds,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as RelayAccess from "../relay/RelayAccess.ts";
import * as CommandOutputHub from "../orchestration-v2/CommandOutputHub.ts";
import { GUEST_FAILURE } from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { coalesceThreadLiveStream } from "../orchestration-v2/ThreadLiveEventCoalescer.ts";
import { buildBoundedThreadStreamSnapshot } from "../orchestration-v2/ThreadStream.ts";
import {
  projectDomainEventForWire,
  projectTurnItemForDetail,
  projectTurnItemForWire,
} from "../orchestration-v2/WireProjection.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import { guestShareView, guestThreadModel } from "./guestView.ts";
import {
  classifyGuestUploads,
  GUEST_UPLOAD_HEADER_BYTES,
  guestHostImageType,
  type GuestUpload,
  matchesImageSignature,
  repliesShowImage,
} from "./guestAttachments.ts";

const SIGNING_SECRET_NAME = "guest-share-signing-key";
const SHARE_ID_BYTES = 16;
const INVITE_SIGNATURE_BYTES = 16;
const MAX_FILE_READ_BYTES = 32 * 1024 * 1024;
const SNAPSHOT_ROW_LIMIT = 600;
const SNAPSHOT_USER_TURN_LIMIT = 20;
const SHARED_THREAD_REPLIES_LIMIT = 64;

const GUEST_ACCESS_MESSAGES = {
  ...GUEST_FAILURE,
  invalid: "This guest link is not valid.",
  stale_page: "This page is for an older guest link. Reload it to continue.",
  unavailable: "This item is not available.",
  rejected: "The owner's server rejected this request.",
  empty: "Write a message or attach a file.",
  too_many_files: "Attach up to 4 files to a message.",
  too_large: "Attached files can total up to 10 MB per message.",
  unsupported_file: "This file cannot be attached. Images must be PNG, JPEG, GIF, or WebP.",
  files_busy: GUEST_FAILURE.filesBusy,
} as const;

export class GuestShareAccessError extends Schema.TaggedError<GuestShareAccessError>()(
  "GuestShareAccessError",
  {
    reason: Schema.Literals([
      "invalid",
      "inactive",
      "used",
      "busy",
      "stale_page",
      "unavailable",
      "rejected",
      "empty",
      "too_many_files",
      "too_large",
      "unsupported_file",
      "files_busy",
    ]),
  },
) {
  override get message(): string {
    return GUEST_ACCESS_MESSAGES[this.reason];
  }
}

const guestFailureReason = (cause: unknown): GuestShareAccessError["reason"] =>
  cause === GUEST_FAILURE.inactive
    ? "inactive"
    : cause === GUEST_FAILURE.used
      ? "used"
      : cause === GUEST_FAILURE.busy
        ? "busy"
        : cause === GUEST_FAILURE.filesBusy
          ? "files_busy"
          : "rejected";

const SessionClaims = Schema.Struct({
  kind: Schema.Literal("session"),
  threadId: ThreadId,
  shareId: GuestShareId,
});
type SessionClaims = typeof SessionClaims.Type;
const encodeSessionClaims = Schema.encodeSync(Schema.fromJsonString(SessionClaims));
const encodeGuestLink = Schema.encodeSync(Schema.fromJsonString(GuestLinkPayload));
const decodeSessionClaims = Schema.decodeUnknownOption(Schema.fromJsonString(SessionClaims));

const inviteSignature = (shareId: string, key: Uint8Array) =>
  base64UrlEncode(
    Buffer.from(signPayload(`guest-invite:${shareId}`, key), "base64url").subarray(
      0,
      INVITE_SIGNATURE_BYTES,
    ),
  );

const inactive = new GuestShareAccessError({ reason: "inactive" });

export class GuestShareService extends Context.Service<
  GuestShareService,
  {
    readonly create: (
      input: GuestShareCreateInput,
    ) => Effect.Effect<GuestShareCreateResult, GuestShareCreateError>;
    readonly redeem: (
      request: GuestRedeemRequest,
    ) => Effect.Effect<
      { readonly token: string; readonly shareId: GuestShareId },
      GuestShareAccessError
    >;
    readonly check: (session: string) => Effect.Effect<void, GuestShareAccessError>;
    readonly submit: (
      session: string,
      request: GuestSubmitRequest,
      uploads: ReadonlyArray<GuestUpload>,
    ) => Effect.Effect<void, GuestShareAccessError>;
    readonly stream: (
      session: string,
    ) => Effect.Effect<Stream.Stream<GuestStreamEvent>, GuestShareAccessError>;
    readonly render: (
      session: string,
      itemId: string,
    ) => Effect.Effect<{ readonly path: string; readonly title: string }, GuestShareAccessError>;
    readonly item: (
      session: string,
      itemId: string,
    ) => Effect.Effect<OrchestrationV2GetTurnItemResult, GuestShareAccessError>;
    readonly commandOutput: (
      session: string,
      itemId: string,
    ) => Effect.Effect<Stream.Stream<OrchestrationV2CommandOutputFrame>, GuestShareAccessError>;
    readonly attachment: (
      session: string,
      attachmentId: string,
    ) => Effect.Effect<
      { readonly path: string; readonly attachment: ChatAttachment },
      GuestShareAccessError
    >;
    readonly media: (
      session: string,
      path: string,
    ) => Effect.Effect<{ readonly path: string; readonly mimeType: string }, GuestShareAccessError>;
  }
>()("supaterm/guest/GuestShareService") {}

interface SentReply {
  readonly text: string;
  sources?: ReadonlyArray<string>;
}

const threadOf = (event: OrchestrationV2DomainEvent): OrchestrationV2AppThread | null => {
  switch (event.type) {
    case "thread.guest-share-updated":
    case "thread.metadata-updated":
    case "thread.model-selection-updated":
    case "thread.provider-switched":
      return event.payload;
    default:
      return null;
  }
};

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const commandOutputs = yield* CommandOutputHub.CommandOutputHub;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const relay = yield* RelayAccess.RelayAccess;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const analytics = yield* AnalyticsService.AnalyticsService;
  const signingKey = yield* Effect.cached(
    secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32).pipe(Effect.orDie),
  );
  const signInvite = (shareId: GuestShareId) =>
    Effect.map(signingKey, (key) => `${shareId}.${inviteSignature(shareId, key)}`);
  const signSession = (claims: SessionClaims) =>
    Effect.map(signingKey, (key) => {
      const payload = base64UrlEncode(encodeSessionClaims(claims));
      return `${payload}.${signPayload(payload, key)}`;
    });
  const splitToken = (token: string) => {
    const [payload, signature, extra] = token.split(".");
    return payload && signature && extra === undefined ? { payload, signature } : null;
  };
  const verifyInvite = Effect.fn("GuestShareService.verifyInvite")(function* (token: string) {
    const parts = splitToken(token);
    if (token.length > 2048 || parts === null) return Option.none<SessionClaims>();
    const key = yield* signingKey;
    if (!timingSafeEqualBase64Url(parts.signature, inviteSignature(parts.payload, key))) {
      return Option.none<SessionClaims>();
    }
    const shareId = GuestShareId.make(parts.payload);
    const threadId = yield* orchestrator
      .findGuestShareThreadId(shareId)
      .pipe(Effect.mapError(() => inactive));
    return threadId === null
      ? Option.none<SessionClaims>()
      : Option.some<SessionClaims>({ kind: "session", threadId, shareId });
  });
  const verifySession = (token: string) =>
    Effect.map(signingKey, (key) => {
      const parts = splitToken(token);
      if (token.length > 2048 || parts === null) return Option.none<SessionClaims>();
      if (!timingSafeEqualBase64Url(parts.signature, signPayload(parts.payload, key))) {
        return Option.none<SessionClaims>();
      }
      return decodeSessionClaims(base64UrlDecodeUtf8(parts.payload));
    });

  const relayAddress = relay.advertisement.pipe(Effect.map((value) => value.relayEndpoint ?? null));
  const sharingEnabled = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.guestSharingEnabled),
    Effect.orElseSucceed(() => false),
  );

  const dispatchGuestCommand = (
    command: Parameters<Orchestrator.OrchestratorV2["Service"]["dispatch"]>[0],
  ) =>
    orchestrator.dispatch(command).pipe(
      Effect.mapError(
        (error) =>
          new GuestShareAccessError({
            reason: guestFailureReason("cause" in error ? error.cause : undefined),
          }),
      ),
    );

  const commandId = (label: string) =>
    crypto.randomUUIDv4().pipe(
      Effect.map((uuid) => CommandId.make(`server:guest-share:${label}:${uuid}`)),
      Effect.orDie,
    );

  const authorize = Effect.fn("GuestShareService.authorize")(function* (
    token: string,
    kind: "invite" | "session",
  ) {
    const claims = yield* kind === "invite" ? verifyInvite(token) : verifySession(token);
    if (Option.isNone(claims)) {
      return yield* new GuestShareAccessError({ reason: "invalid" });
    }
    const { thread } = yield* orchestrator
      .getThreadRecords(claims.value.threadId, [])
      .pipe(Effect.mapError(() => inactive));
    const share = thread.guestShare;
    const now = yield* DateTime.now;
    if (
      !(yield* sharingEnabled) ||
      !share ||
      share.id !== claims.value.shareId ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      DateTime.toEpochMillis(now) >= Date.parse(share.expiresAt) ||
      (kind === "session" && share.guestName === null) ||
      (yield* relayAddress) !== share.host
    ) {
      return yield* inactive;
    }
    return { thread, share };
  });

  const create = Effect.fn("GuestShareService.create")(function* (input: GuestShareCreateInput) {
    if (!(yield* sharingEnabled)) {
      return yield* new GuestShareCreateError({ reason: "disabled" });
    }
    const connection = yield* relay.prepare.pipe(
      Effect.mapError(() => new GuestShareCreateError({ reason: "relay_unavailable" })),
    );
    const host = connection.relayEndpoint;
    const shareId = GuestShareId.make(
      base64UrlEncode(yield* crypto.randomBytes(SHARE_ID_BYTES).pipe(Effect.orDie)),
    );
    const now = yield* DateTime.now;
    const expiresAt = DateTime.formatIso(DateTime.add(now, { milliseconds: GUEST_SHARE_TTL_MS }));
    yield* orchestrator
      .dispatch({
        type: "thread.guest-share.open",
        commandId: yield* commandId("open"),
        threadId: input.threadId,
        shareId,
        host,
        expiresAt,
      })
      .pipe(Effect.mapError(() => new GuestShareCreateError({ reason: "thread_unavailable" })));
    const { thread } = yield* orchestrator
      .getThreadRecords(input.threadId, [])
      .pipe(Effect.mapError(() => new GuestShareCreateError({ reason: "read_failed" })));
    if (!thread.guestShare || thread.guestShare.id !== shareId) {
      return yield* new GuestShareCreateError({ reason: "changed" });
    }
    const credential = yield* signInvite(shareId);
    const payload = base64UrlEncode(
      encodeGuestLink({
        version: 1,
        address: host,
        relayUrl: connection.relayUrl,
        credential,
      }),
    );
    return { url: `${input.guestPageUrl}#${payload}`, share: thread.guestShare };
  });

  const redeem = Effect.fn("GuestShareService.redeem")(function* (request: GuestRedeemRequest) {
    const { thread, share } = yield* authorize(request.credential, "invite");
    yield* dispatchGuestCommand({
      type: "thread.guest-share.redeem",
      commandId: yield* commandId("redeem"),
      threadId: thread.id,
      shareId: share.id,
      guestName: request.name,
    });
    yield* analytics.record("feature.used", { feature: "guest_share.join" });
    const token = yield* signSession({ kind: "session", threadId: thread.id, shareId: share.id });
    return { token, shareId: share.id };
  });

  const check = Effect.fn("GuestShareService.check")(function* (session: string) {
    yield* authorize(session, "session");
  });

  const uploadFailed = new GuestShareAccessError({ reason: "rejected" });
  const removeStored = (attachments: ReadonlyArray<ChatAttachment>) =>
    Effect.forEach(
      attachments,
      (attachment) => {
        const path = resolveAttachmentPath({ attachmentsDir, attachment });
        return path === null
          ? Effect.void
          : fileSystem.remove(path, { force: true }).pipe(Effect.ignore);
      },
      { discard: true },
    );

  const storeUploads = Effect.fn("GuestShareService.storeUploads")(function* (
    threadId: ThreadId,
    uploads: ReadonlyArray<GuestUpload>,
  ) {
    const inspected = yield* Effect.forEach(uploads, (upload) =>
      Effect.gen(function* () {
        const info = yield* fileSystem.stat(upload.path);
        const file = yield* fileSystem.open(upload.path, { flag: "r" });
        const header = Option.getOrElse(
          yield* file.readAlloc(GUEST_UPLOAD_HEADER_BYTES),
          () => new Uint8Array(),
        );
        return { ...upload, sizeBytes: Number(info.size), header };
      }).pipe(
        Effect.scoped,
        Effect.mapError(() => uploadFailed),
      ),
    );
    const classified = classifyGuestUploads(inspected);
    if (!classified.ok) return yield* new GuestShareAccessError({ reason: classified.reason });
    const stored: Array<ChatAttachment> = [];
    yield* Effect.forEach(
      classified.attachments,
      (draft, index) =>
        Effect.gen(function* () {
          const id = createAttachmentId(
            threadId,
            draft.type === "file" ? attachmentFileExtension(draft.name) : undefined,
          );
          if (id === null) return yield* uploadFailed;
          const attachment: ChatAttachment = { ...draft, id: ChatAttachmentId.make(id) };
          const path = resolveAttachmentPath({ attachmentsDir, attachment });
          if (path === null) return yield* uploadFailed;
          yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
          yield* fileSystem.copyFile(uploads[index]!.path, path);
          stored.push(attachment);
        }).pipe(Effect.mapError(() => uploadFailed)),
      { discard: true },
    ).pipe(Effect.onError(() => removeStored(stored)));
    return stored;
  });

  const submit = Effect.fn("GuestShareService.submit")(function* (
    session: string,
    request: GuestSubmitRequest,
    uploads: ReadonlyArray<GuestUpload>,
  ) {
    const { thread, share } = yield* authorize(session, "session");
    if (request.shareId !== share.id) {
      return yield* new GuestShareAccessError({ reason: "stale_page" });
    }
    if (request.text === "" && uploads.length === 0) {
      return yield* new GuestShareAccessError({ reason: "empty" });
    }
    const attachments = yield* storeUploads(thread.id, uploads);
    yield* dispatchGuestCommand({
      type: "thread.guest-message.submit",
      commandId: yield* commandId("submit"),
      threadId: thread.id,
      shareId: share.id,
      guestMessageId: GuestMessageId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
      text: request.text,
      ...(attachments.length === 0 ? {} : { attachments }),
    }).pipe(Effect.onError(() => removeStored(attachments)));
    yield* analytics.record("feature.used", {
      feature: "guest_message.submit",
      variant: attachments.length === 0 ? "text_only" : "with_files",
    });
  });

  const untilRevoked = Effect.fn("GuestShareService.untilRevoked")(
    function* (session: string) {
      const changes = yield* serverSettings.subscribeChanges;
      const { thread } = yield* authorize(session, "session");
      yield* Stream.merge(
        changes.pipe(Stream.map(() => undefined)),
        relay.advertisements.pipe(Stream.map(() => undefined)),
      ).pipe(
        Stream.merge(
          orchestrator.streamDomainEvents.pipe(
            Stream.filter((event) => event.threadId === thread.id),
            Stream.map(() => undefined),
          ),
        ),
        Stream.mapEffect(() => authorize(session, "session")),
        Stream.runDrain,
      );
    },
    Effect.scoped,
    Effect.ignore(),
  );
  const untilSharingPaused = Effect.fn("GuestShareService.untilSharingPaused")(function* (
    host: string,
  ) {
    const changes = yield* serverSettings.subscribeChanges;
    yield* Stream.fromEffect(sharingEnabled).pipe(
      Stream.concat(changes.pipe(Stream.map((settings) => settings.guestSharingEnabled))),
      Stream.merge(relay.advertisements.pipe(Stream.map((value) => value?.relayEndpoint === host))),
      Stream.filter((available) => !available),
      Stream.runHead,
    );
  }, Effect.scoped);
  const sentImageReplies = new Map<
    GuestShareId,
    { openStreams: number; readonly replies: Map<string, SentReply> }
  >();
  const sentRecord = (shareId: GuestShareId) => {
    let record = sentImageReplies.get(shareId);
    if (record === undefined) {
      record = { openStreams: 0, replies: new Map() };
      sentImageReplies.set(shareId, record);
      for (const [id, other] of sentImageReplies) {
        if (sentImageReplies.size <= SHARED_THREAD_REPLIES_LIMIT) break;
        if (other.openStreams === 0 && id !== shareId) sentImageReplies.delete(id);
      }
    }
    return record;
  };
  const rememberSent = (shareId: GuestShareId, items: Iterable<OrchestrationV2TurnItem>) => {
    for (const item of items) {
      if (item.type !== "assistant_message") continue;
      const key = `${item.threadId}\u0000${item.id}`;
      if (item.text.includes("![") || /<img/i.test(item.text)) {
        sentRecord(shareId).replies.set(key, { text: item.text });
      } else {
        sentImageReplies.get(shareId)?.replies.delete(key);
      }
    }
  };

  const stream = Effect.fn("GuestShareService.stream")(function* (session: string) {
    const { thread, share } = yield* authorize(session, "session");
    const snapshot = yield* orchestrator
      .getThreadSnapshotWindow(thread.id, {
        rowLimit: SNAPSHOT_ROW_LIMIT,
        userTurnLimit: SNAPSHOT_USER_TURN_LIMIT,
      })
      .pipe(Effect.mapError(() => inactive));
    if (
      snapshot.projection.thread.guestShare?.id !== share.id ||
      snapshot.projection.thread.archivedAt !== null ||
      snapshot.projection.thread.deletedAt !== null
    ) {
      return yield* inactive;
    }
    const providers = yield* providerRegistry.getProviders;
    const viewOf = (current: OrchestrationV2AppThread) =>
      guestShareView(current, guestThreadModel(current.modelSelection, providers));
    const initialView = viewOf(snapshot.projection.thread);
    if (initialView === null) return yield* inactive;

    const ended: GuestStreamEvent = { type: "ended" };
    const endsShare = (event: OrchestrationV2DomainEvent) => {
      if (event.type === "thread.archived" || event.type === "thread.deleted") return true;
      const updated = threadOf(event);
      return updated !== null && updated.guestShare?.id !== share.id;
    };
    const live = orchestrator
      .streamStoredEventsFrom({ threadId: thread.id, afterSequence: snapshot.snapshotSequence })
      .pipe(
        Stream.map((stored) => ({
          kind: "event" as const,
          sequence: stored.sequence,
          event: projectDomainEventForWire(stored.event),
        })),
        Stream.takeUntil((item) => endsShare(item.event)),
        coalesceThreadLiveStream,
        Stream.map((item): ReadonlyArray<GuestStreamEvent> => {
          if (item.kind !== "event") return [];
          if (endsShare(item.event)) return [ended];
          if (item.event.type === "turn-item.updated") rememberSent(share.id, [item.event.payload]);
          const updated = threadOf(item.event);
          const view = updated === null ? null : viewOf(updated);
          return view === null
            ? [{ type: "thread", item }]
            : [
                { type: "thread", item },
                { type: "view", view },
              ];
        }),
        Stream.flattenIterable,
        Stream.catchCause(() => Stream.empty),
      );
    const untilExpiry = DateTime.now.pipe(
      Effect.flatMap((now) =>
        Effect.sleep(Math.max(0, Date.parse(share.expiresAt) - DateTime.toEpochMillis(now))),
      ),
    );
    const openingSnapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: snapshot.snapshotSequence,
      projection: snapshot.projection,
    });
    const opening: ReadonlyArray<GuestStreamEvent> = [
      { type: "view", view: initialView },
      { type: "thread", item: openingSnapshot },
    ];
    const events = Stream.fromIterable(opening).pipe(
      Stream.concat(
        Stream.merge(live, Stream.fromEffect(Effect.as(untilExpiry, ended)), {
          haltStrategy: "either",
        }),
      ),
      Stream.takeUntil((event) => event.type === "ended"),
      Stream.interruptWhen(untilSharingPaused(share.host)),
    );
    return Stream.unwrap(
      Effect.acquireRelease(
        Effect.sync(() => {
          const record = sentRecord(share.id);
          record.openStreams += 1;
          rememberSent(
            share.id,
            openingSnapshot.projection.visibleTurnItems.map((row) => row.item),
          );
          return record;
        }),
        (record) =>
          Effect.sync(() => {
            record.openStreams -= 1;
          }),
      ).pipe(Effect.as(events)),
    );
  });

  const unavailable = new GuestShareAccessError({ reason: "unavailable" });

  const threadItem = Effect.fn("GuestShareService.threadItem")(function* (
    session: string,
    itemId: string,
  ) {
    const { thread } = yield* authorize(session, "session");
    const item = yield* orchestrator
      .getTurnItem({ threadId: thread.id, itemId: TurnItemId.make(itemId) })
      .pipe(Effect.mapError(() => unavailable));
    return item === null ? yield* unavailable : { thread, item };
  });

  const render = Effect.fn("GuestShareService.render")(function* (session: string, itemId: string) {
    const { thread, item } = yield* threadItem(session, itemId);
    if (item.type !== "dynamic_tool") return yield* unavailable;
    const reference = htmlRenderFromToolItem(item);
    const [attachmentId] = threadHtmlRenderAttachmentIds(thread.id, [item]);
    const path =
      attachmentId === undefined
        ? null
        : resolveAttachmentPathById({ attachmentsDir, attachmentId });
    if (reference === undefined || path === null) return yield* unavailable;
    const info = yield* fileSystem.stat(path).pipe(Effect.mapError(() => unavailable));
    if (info.size > BigInt(MAX_FILE_READ_BYTES)) return yield* unavailable;
    return { path, title: reference.title };
  });

  const item = Effect.fn("GuestShareService.item")(function* (session: string, itemId: string) {
    const { item } = yield* threadItem(session, itemId);
    return {
      item:
        item.type === "file_change" ? projectTurnItemForWire(item) : projectTurnItemForDetail(item),
    };
  });

  const commandOutput = Effect.fn("GuestShareService.commandOutput")(function* (
    session: string,
    itemId: string,
  ) {
    const { thread, item } = yield* threadItem(session, itemId);
    if (item.type !== "command_execution") return yield* unavailable;
    return commandOutputs.subscribe({ threadId: thread.id, itemId: item.id }).pipe(
      Stream.catchCause(() => Stream.empty),
      Stream.interruptWhen(
        untilRevoked(session).pipe(
          Effect.timeoutOrElse({
            duration: Math.max(
              0,
              Date.parse(thread.guestShare!.expiresAt) -
                DateTime.toEpochMillis(yield* DateTime.now),
            ),
            orElse: () => Effect.void,
          }),
        ),
      ),
    );
  });

  const attachment = Effect.fn("GuestShareService.attachment")(function* (
    session: string,
    attachmentId: string,
  ) {
    const { thread, share } = yield* authorize(session, "session");
    const fromShare = share.messages
      .flatMap((message) => (message.status === "dismissed" ? [] : (message.attachments ?? [])))
      .find((candidate) => candidate.id === attachmentId);
    const found =
      fromShare ??
      (yield* orchestrator.getThreadRecords(thread.id, ["messages"]).pipe(
        Effect.map(({ messages }) =>
          messages
            .flatMap((message) => message.attachments ?? [])
            .find((candidate) => candidate.id === attachmentId),
        ),
        Effect.mapError(() => unavailable),
      ));
    const path =
      found === undefined ? null : resolveAttachmentPath({ attachmentsDir, attachment: found });
    if (found === undefined || path === null) return yield* unavailable;
    const info = yield* fileSystem.stat(path).pipe(Effect.mapError(() => unavailable));
    return info.size <= BigInt(MAX_FILE_READ_BYTES)
      ? { path, attachment: found }
      : yield* unavailable;
  });

  const media = Effect.fn("GuestShareService.media")(function* (session: string, path: string) {
    const { share } = yield* authorize(session, "session");
    const mimeType = guestHostImageType(path);
    if (mimeType === null) return yield* unavailable;
    const sent = sentImageReplies.get(share.id)?.replies.values() ?? [];
    if (
      !repliesShowImage(
        path,
        [...sent],
        (reply) => (reply.sources ??= chatMarkdownImageSources(reply.text)),
      )
    ) {
      return yield* unavailable;
    }
    const info = yield* fileSystem.stat(path).pipe(Effect.mapError(() => unavailable));
    if (info.size > BigInt(10 * 1024 * 1024)) return yield* unavailable;
    const header = yield* fileSystem.open(path, { flag: "r" }).pipe(
      Effect.flatMap((file) => file.readAlloc(GUEST_UPLOAD_HEADER_BYTES)),
      Effect.scoped,
      Effect.mapError(() => unavailable),
    );
    if (Option.isNone(header) || !matchesImageSignature(mimeType, header.value)) {
      return yield* unavailable;
    }
    return { path, mimeType };
  });

  return GuestShareService.of({
    create,
    redeem,
    check,
    submit,
    stream,
    render,
    item,
    commandOutput,
    attachment,
    media,
  });
});

export const layer = Layer.effect(GuestShareService, make);
