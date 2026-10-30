// @effect-diagnostics nodeBuiltinImport:off - connects the real Node HTTP adapter to encrypted in-memory tunnel sessions without a listener.
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as HttpRouter from "effect/http/HttpRouter";
import {
  acceptClientHandshake,
  createClientHandshake,
  relayPublicKey,
  relayHttpBaseUrl,
} from "@supaterm/shared/relay/protocol";
import { createTunnelSession } from "@supaterm/shared/relay/tunnel";
import { TunnelSocket } from "@supaterm/shared/relay/tunnelNode";
import { createGuestTransport } from "../../../web/src/components/guest/guestTransport.ts";
import * as GuestHttp from "./http.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  EventId,
  GuestShareId,
  type GuestStreamEvent,
  MessageId,
  type OrchestrationV2TurnItem,
  OrchestrationV2TurnItemStatus,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
  sweepStalePendingAttachments,
} from "../attachmentStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as RelayAccess from "../relay/RelayAccess.ts";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { decodeBase64 } from "@supaterm/shared/relay/protocol";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandOutputHub from "../orchestration-v2/CommandOutputHub.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ResourceCleanupService from "../orchestration-v2/ResourceCleanupService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as PreviewAgentActivity from "../preview/PreviewAgentActivity.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import * as GuestShareService from "./GuestShareService.ts";
import { projectTurnItemForWire } from "../orchestration-v2/WireProjection.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for guest shares"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerOrchestration = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "guest-share-service" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
).pipe(
  Layer.provide(ProviderInstanceRegistry.layer<never>({ drivers: [], configMap: {} })),
  Layer.provide(PreviewAgentActivity.layer),
);
const RELAY_ADDRESS =
  "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.relay.supaterm.alt/";
const GUEST_PAGE_URL = "https://guest.example/guest";
class TestRelay extends Context.Service<
  TestRelay,
  SubscriptionRef.SubscriptionRef<string | null>
>()("supaterm/guest/GuestShareService.test/TestRelay") {}
const hostname = {
  set: (value: string | null) => TestRelay.use((ref) => SubscriptionRef.set(ref, value)),
};
const layerRelay = Layer.effectContext(
  Effect.gen(function* () {
    const address = yield* SubscriptionRef.make<string | null>(RELAY_ADDRESS);
    return Context.make(TestRelay, address).pipe(
      Context.add(
        RelayAccess.RelayAccess,
        RelayAccess.RelayAccess.of({
          start: Effect.void,
          prepare: SubscriptionRef.get(address).pipe(
            Effect.map((value) => ({
              relayEndpoint: value ?? RELAY_ADDRESS,
              relayUrl: "wss://relay.example",
            })),
          ),
          advertisement: SubscriptionRef.get(address).pipe(
            Effect.map((value) =>
              value ? { relayEndpoint: value, relayUrl: "wss://relay.example" } : {},
            ),
          ),
          advertisements: SubscriptionRef.changes(address).pipe(
            Stream.map((value) =>
              value ? { relayEndpoint: value, relayUrl: "wss://relay.example" } : null,
            ),
          ),
          status: Stream.empty,
        }),
      ),
    );
  }),
);
const credentialFromUrl = (url: string) => {
  const payload = JSON.parse(
    new TextDecoder().decode(decodeBase64(url.slice(url.indexOf("#") + 1))),
  ) as { credential: string };
  return payload.credential;
};
const layerProviders = Layer.mock(ProviderRegistry.ProviderRegistry)({
  getProviders: Effect.succeed([]),
});
const layerConfig = ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-guest-share-" });
const layerCleanup = Layer.effect(
  ResourceCleanupService.ResourceCleanupService,
  Effect.gen(function* () {
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    return {
      cleanupScheduledTasks: () => Effect.void,
      cleanupTerminals: () => Effect.void,
      cleanupPreviews: () => Effect.void,
      cleanupAttachments: (attachmentIds) =>
        Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const path = resolveAttachmentPathById({ attachmentsDir, attachmentId });
            return path === null ? Effect.void : fileSystem.remove(path).pipe(Effect.orDie);
          },
          { discard: true },
        ),
    };
  }),
).pipe(Layer.provide(layerConfig), Layer.provide(NodeServices.layer));
class RecordedAnalytics extends Context.Service<
  RecordedAnalytics,
  Ref.Ref<ReadonlyArray<Readonly<Record<string, unknown>>>>
>()("supaterm/guest/GuestShareService.test/RecordedAnalytics") {}
const layerAnalytics = Layer.effectContext(
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<Readonly<Record<string, unknown>>>>([]);
    return Context.make(RecordedAnalytics, recorded).pipe(
      Context.add(
        AnalyticsService.AnalyticsService,
        AnalyticsService.AnalyticsService.of({
          record: (event, properties) =>
            Ref.update(recorded, (events) => [...events, { event, ...properties }]),
          flush: Effect.void,
          recordOwners: () => Effect.void,
        }),
      ),
    );
  }),
);
const layerSettings = Layer.effectContext(
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const current = yield* SubscriptionRef.make(yield* settings.getSettings);
    return Context.make(ServerSettings.ServerSettingsService, {
      ...settings,
      getSettings: SubscriptionRef.get(current),
      updateSettings: (patch) =>
        settings
          .updateSettings(patch)
          .pipe(
            Effect.tap(() =>
              settings.getSettings.pipe(
                Effect.flatMap((value) => SubscriptionRef.set(current, value)),
              ),
            ),
          ),
      streamChanges: SubscriptionRef.changes(current),
      subscribeChanges: Effect.succeed(SubscriptionRef.changes(current)),
    });
  }),
).pipe(Layer.provide(ServerSettings.layerTest({ guestSharingEnabled: true })));

const layerTest = GuestShareService.layer.pipe(
  Layer.provideMerge(
    CommandOutputHub.layer.pipe(
      Layer.provideMerge(layerOrchestration.pipe(Layer.provide(layerCleanup))),
    ),
  ),
  Layer.provide(layerProviders),
  Layer.provideMerge(layerSettings),
  Layer.provideMerge(layerRelay),
  Layer.provideMerge(layerAnalytics),
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(layerConfig),
  Layer.provideMerge(NodeServices.layer),
);

const threadId = ThreadId.make("thread:guest-share-service");

const shareThreadFor = Effect.fn(function* (threadId: ThreadId) {
  yield* hostname.set(RELAY_ADDRESS);
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("project:guest-share-service"),
    title: "Review me",
    modelSelection: { instanceId, model: "gpt-5.1-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const guestShares = yield* GuestShareService.GuestShareService;
  const { url } = yield* guestShares.create({ threadId, guestPageUrl: GUEST_PAGE_URL });
  assert.isTrue(url.startsWith(`${GUEST_PAGE_URL}#`));
  const credential = credentialFromUrl(url);
  return { orchestrator, guestShares, credential };
});
const shareThread = shareThreadFor(threadId);

it.effect("spends an invite once and ends the guest stream when the owner stops sharing", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const again = yield* Effect.exit(guestShares.redeem({ credential, name: "Eve" }));
    assert.isTrue(Exit.isFailure(again));
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(session))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(credential))));

    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-guest-share"),
      threadId,
    });
    const received = Array.from(yield* Stream.runCollect(events));
    assert.deepEqual(
      received.map((event) => (event.type === "thread" ? event.item.kind : event.type)),
      ["view", "snapshot", "ended"],
    );
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(session))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(session))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["replace", "thread.archive", "thread.delete"] as const)(
  "ends a prepared guest stream on %s without exposing a replacement share",
  (termination) =>
    Effect.gen(function* () {
      const { orchestrator, guestShares, credential } = yield* shareThread;
      const { token: session, shareId } = yield* guestShares.redeem({ credential, name: "Sam" });
      const events = yield* guestShares.stream(session);
      if (termination === "replace") {
        yield* guestShares.create({ threadId, guestPageUrl: GUEST_PAGE_URL });
      } else {
        yield* orchestrator.dispatch({
          type: termination,
          commandId: CommandId.make(`end-stream:${termination}`),
          threadId,
        });
      }
      const received = Array.from(yield* Stream.runCollect(events));
      assert.equal(received.at(-1)?.type, "ended");
      assert.deepEqual(
        received.flatMap((event) => (event.type === "view" ? [event.view.shareId] : [])),
        [shareId],
      );
      assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(session))));
    }).pipe(Effect.provide(layerTest)),
);

it.effect("counts a guest joining and sending, without their name or text", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session, shareId } = yield* guestShares.redeem({ credential, name: "Sam" });
    yield* guestShares.submit(session, { shareId, text: "Hello" }, []);
    assert.deepEqual(yield* Ref.get(yield* RecordedAnalytics), [
      { event: "feature.used", feature: "guest_share.join" },
      { event: "feature.used", feature: "guest_message.submit", variant: "text_only" },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("streams the owner's thread events after the share and a snapshot", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message"),
      threadId,
      messageId: MessageId.make("message:owner"),
      text: "Fix the login bug",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-after-message"),
      threadId,
    });
    const received = Array.from(yield* Stream.runCollect(events));
    assert.equal(received.at(-1)?.type, "ended");
    const turnItems = received.flatMap((event) =>
      event.type === "thread" &&
      event.item.kind === "event" &&
      event.item.event.type === "turn-item.updated"
        ? [event.item.event.payload]
        : [],
    );
    assert.deepEqual(
      turnItems.flatMap((item) => (item.type === "user_message" ? [item.text] : [])),
      ["Fix the login bug"],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("starts a stream with the runs and items already in the thread", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message-before"),
      threadId,
      messageId: MessageId.make("message:before"),
      text: "Fix the login bug",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const [view, snapshot] = Array.from(
      yield* Stream.runCollect(Stream.take(yield* guestShares.stream(session), 2)),
    );
    assert.equal(view?.type, "view");
    if (snapshot?.type !== "thread" || snapshot.item.kind !== "snapshot") {
      return assert.fail("Expected the thread snapshot second.");
    }
    assert.equal(snapshot.item.projection.runs.length, 1);
    assert.include(
      snapshot.item.projection.visibleTurnItems.map((row) => row.item.type),
      "user_message",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("redeems only a short invite whose signature and share id are both current", () =>
  Effect.gen(function* () {
    const { guestShares, credential: replaced } = yield* shareThread;
    const { url } = yield* guestShares.create({ threadId, guestPageUrl: GUEST_PAGE_URL });
    const credential = credentialFromUrl(url);
    assert.match(credential, /^[\w-]{22}\.[\w-]{22}$/);

    const [shareId, signature] = credential.split(".");
    const tampered = `${shareId}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
    for (const rejected of [tampered, replaced]) {
      const error = yield* Effect.flip(guestShares.redeem({ credential: rejected, name: "Eve" }));
      assert.equal(error.reason, "invalid");
    }
    assert.isTrue(
      Exit.isSuccess(yield* Effect.exit(guestShares.redeem({ credential, name: "Sam" }))),
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses guest requests once the encrypted relay no longer serves the link's host", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const { id: shareId } = (yield* Orchestrator.OrchestratorV2.use((orchestrator) =>
      orchestrator.getThreadRecords(threadId, []),
    )).thread.guestShare!;
    yield* hostname.set(null);
    const submitted = yield* Effect.exit(
      guestShares.submit(session, { shareId, text: "Hello" }, []),
    );
    assert.isTrue(Exit.isFailure(submitted));
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "closes an open guest stream when the encrypted relay stops serving the link's host",
  () =>
    Effect.gen(function* () {
      const { guestShares, credential } = yield* shareThread;
      const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
      const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
        Effect.forkChild,
      );
      yield* hostname.set(null);
      const received = Array.from(yield* Fiber.join(collecting));
      assert.deepEqual(
        received.map((event) => (event.type === "thread" ? event.item.kind : event.type)),
        ["view", "snapshot"],
      );
      assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(session))));
      yield* hostname.set(RELAY_ADDRESS);
      assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.stream(session))));
    }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses new links and every guest request while the beta is off", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
      Effect.forkChild,
    );
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({ guestSharingEnabled: false });
    yield* Fiber.join(collecting);
    assert.equal(
      (yield* Effect.flip(guestShares.create({ threadId, guestPageUrl: GUEST_PAGE_URL }))).reason,
      "disabled",
    );
    assert.equal((yield* Effect.flip(guestShares.check(session))).reason, "inactive");
    yield* settings.updateSettings({ guestSharingEnabled: true });
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(session))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("ends an open guest stream when the link expires", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
      Effect.forkChild,
    );
    yield* TestClock.adjust("25 hours");
    const received = Array.from(yield* Fiber.join(collecting));
    assert.equal(received.at(-1)?.type, "ended");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows the guest the thread's new model", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("switch-model"),
      threadId,
      modelSelection: { instanceId, model: "gpt-5.2-codex" },
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-after-switch"),
      threadId,
    });
    const views = Array.from(yield* Stream.runCollect(events)).flatMap((event) =>
      event.type === "view" ? [event.view.model.name] : [],
    );
    assert.include(views, "gpt-5.2-codex");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses a message a page sends for a share the cookie no longer opens", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const submitted = yield* Effect.exit(
      guestShares.submit(session, { shareId: GuestShareId.make("share:older"), text: "Hello" }, []),
    );
    assert.isTrue(Exit.isFailure(submitted));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("serves no render for an item outside the shared thread", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.render(session, "item:missing"))));
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(guestShares.render(credential, "item:missing"))),
    );
  }).pipe(Effect.provide(layerTest)),
);

const ownerRun = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("owner-message-for-command"),
    threadId,
    messageId: MessageId.make("message:command"),
    text: "Build it",
    attachments: [],
    dispatchMode: { type: "defer_start" },
    createdBy: "user",
    creationSource: "web",
  });
  const { runs } = (yield* orchestrator.getThreadSnapshotWindow(threadId, { rowLimit: 10 }))
    .projection;
  return runs[0]!.id;
});

const writeItem = (
  id: string,
  fields:
    | Pick<
        Extract<OrchestrationV2TurnItem, { type: "command_execution" }>,
        "type" | "status" | "input" | "output"
      >
    | Pick<
        Extract<OrchestrationV2TurnItem, { type: "file_change" }>,
        "type" | "status" | "fileName" | "diffStr" | "oldStr" | "newStr"
      >,
  ordinal = 1,
) =>
  Effect.gen(function* () {
    const runId = yield* ownerRun;
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`event:${id}`),
          type: "turn-item.updated",
          threadId,
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make(id),
            threadId,
            runId,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal,
            title: null,
            startedAt: now,
            completedAt: fields.status === "running" ? null : now,
            updatedAt: now,
            ...fields,
          },
        },
      ],
    });
    return TurnItemId.make(id);
  });

it.effect("gives the guest a command's detail and output, but no file diffs", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const command = yield* writeItem("item:command", {
      type: "command_execution",
      status: "completed",
      input: "ls /work/src",
      output: "/work/src/auth.ts\n",
    });

    const detail = (yield* guestShares.item(session, command)).item;
    assert.deepInclude(detail, { input: "ls /work/src", output: "/work/src/auth.ts\n" });
    const edit = yield* writeItem("item:edit", {
      type: "file_change",
      status: "completed",
      fileName: "src/auth.ts",
      diffStr: "-const token = 1;\n+const token = 2;\n",
    });
    const write = yield* writeItem("item:write", {
      type: "file_change",
      status: "completed",
      fileName: "src/config.ts",
      oldStr: "",
      newStr: "export const key = 1;\n",
    });
    const failed = yield* writeItem("item:failed-edit", {
      type: "file_change",
      status: "failed",
      fileName: "src/failed.ts",
      diffStr: "-private old contents\n+private new contents\n",
      oldStr: "private old contents",
      newStr: "private new contents",
    });
    const ownerItem = yield* orchestrator.getTurnItem({ threadId, itemId: failed });
    assert.isNotNull(ownerItem);
    assert.deepInclude(projectTurnItemForWire(ownerItem!), {
      diffStr: "-private old contents\n+private new contents\n",
    });
    for (const [id, fileName] of [
      [edit, "src/auth.ts"],
      [write, "src/config.ts"],
      [failed, "src/failed.ts"],
    ] as const) {
      const change = (yield* guestShares.item(session, id)).item;
      assert.deepInclude(change, { type: "file_change", fileName });
      assert.doesNotHaveAnyKeys(change, ["diffStr", "oldStr", "newStr"]);
    }
    const frames = Array.from(
      yield* Stream.runCollect(yield* guestShares.commandOutput(session, command)),
    );
    assert.deepEqual(frames, [
      { kind: "replace", text: "/work/src/auth.ts\n", truncated: false, running: false },
    ]);
    const refused: ReadonlyArray<Effect.Effect<unknown, GuestShareService.GuestShareAccessError>> =
      [
        guestShares.item(credential, command),
        guestShares.commandOutput(credential, command),
        guestShares.item(session, "item:elsewhere"),
      ];
    for (const request of refused) {
      assert.isTrue(Exit.isFailure(yield* Effect.exit(request)));
    }
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["snapshot", "replay", "live"] as const)(
  "strips file diff fields from every status at the guest %s boundary",
  (boundary) =>
    Effect.gen(function* () {
      const { orchestrator, guestShares, credential } = yield* shareThread;
      const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
      const seedChanges = Effect.forEach(OrchestrationV2TurnItemStatus.literals, (status, index) =>
        writeItem(
          `item:diff-${status}`,
          {
            type: "file_change",
            status,
            fileName: `src/${status}.ts`,
            diffStr: `-private-${status}\n+replacement-${status}\n`,
            oldStr: `private-${status}`,
            newStr: `replacement-${status}`,
          },
          index + 1,
        ),
      );
      if (boundary === "snapshot") yield* seedChanges;
      const events = yield* guestShares.stream(session);
      const opened = yield* Deferred.make<void>();
      const collecting =
        boundary === "live"
          ? yield* events.pipe(
              Stream.tap((event) =>
                event.type === "thread" && event.item.kind === "snapshot"
                  ? Deferred.succeed(opened, undefined)
                  : Effect.void,
              ),
              Stream.runCollect,
              Effect.forkChild,
            )
          : null;
      if (collecting !== null) yield* Deferred.await(opened);
      if (boundary !== "snapshot") yield* seedChanges;
      yield* orchestrator.dispatch({
        type: "thread.guest-share.close",
        commandId: CommandId.make("close-diff-stream"),
        threadId,
      });
      const received =
        collecting === null ? yield* Stream.runCollect(events) : yield* Fiber.join(collecting);
      assert.equal(received.at(-1)?.type, "ended");
      const items = received
        .flatMap((event) => {
          if (event.type !== "thread") return [];
          if (event.item.kind === "snapshot")
            return [
              ...event.item.projection.turnItems,
              ...event.item.projection.visibleTurnItems.map((row) => row.item),
            ];
          return event.item.kind === "event" && event.item.event.type === "turn-item.updated"
            ? [event.item.event.payload]
            : [];
        })
        .filter((item) => item.type === "file_change");
      assert.sameMembers(
        [...new Set(items.map((item) => item.status))],
        [...OrchestrationV2TurnItemStatus.literals],
      );
      for (const item of items) assert.doesNotHaveAnyKeys(item, ["diffStr", "oldStr", "newStr"]);
    }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["owner", "expiry", "consumer"] as const)(
  "ends a running command's output on %s termination",
  (termination) =>
    Effect.gen(function* () {
      const { orchestrator, guestShares, credential } = yield* shareThread;
      const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
      const command = yield* writeItem("item:running", {
        type: "command_execution",
        status: "running",
        input: "ls /work/src",
      });
      const receivedFrame = yield* Deferred.make<void>();
      const collecting = yield* (yield* guestShares.commandOutput(session, command)).pipe(
        Stream.tap(() => Deferred.succeed(receivedFrame, undefined)),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(receivedFrame);
      if (termination === "consumer") {
        yield* Fiber.interrupt(collecting);
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(collecting)));
        assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(session))));
        return;
      }
      if (termination === "expiry") {
        yield* TestClock.adjust("25 hours");
      } else {
        yield* orchestrator.dispatch({
          type: "thread.guest-share.close",
          commandId: CommandId.make("close-during-command"),
          threadId,
        });
      }
      const frames = Array.from(yield* Fiber.join(collecting));
      assert.isNotEmpty(frames);
      assert.isTrue(frames.every((frame) => frame.running));
      assert.isTrue(
        Exit.isFailure(yield* Effect.exit(guestShares.commandOutput(session, command))),
      );
    }).pipe(Effect.provide(layerTest)),
);

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const MIB = 1024 * 1024;

const uploadsOf = Effect.fn(function* (
  files: ReadonlyArray<{
    readonly name: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped();
  return yield* Effect.forEach(files, (file, index) => {
    const path = `${directory}/${index}`;
    return fileSystem
      .writeFile(path, file.bytes)
      .pipe(Effect.as({ name: file.name, contentType: file.contentType, path }));
  });
});
const png = (name: string, sizeBytes = PNG.length) => {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set(PNG);
  return { name, contentType: "image/png", bytes };
};

const storedFiles = Effect.gen(function* () {
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readDirectory(attachmentsDir).pipe(Effect.orElseSucceed(() => []));
});

const joinedGuest = Effect.gen(function* () {
  const shared = yield* shareThread;
  const { token: session, shareId } = yield* shared.guestShares.redeem({
    credential: shared.credential,
    name: "Sam",
  });
  return { ...shared, session, shareId };
});

const waitingMessages = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
  return thread.guestShare?.messages ?? [];
});

it.effect("refuses too many files, too many bytes, and images that are not what they say", () =>
  Effect.gen(function* () {
    const { guestShares, session, shareId } = yield* joinedGuest;
    const before = yield* storedFiles;
    const refused = [
      ["too_many_files", [1, 2, 3, 4, 5].map((index) => png(`${index}.png`))],
      ["too_large", [png("big.png", 10 * MIB + 1)]],
      ["unsupported_file", [{ name: "logo.svg", contentType: "image/svg+xml", bytes: PNG }]],
      [
        "unsupported_file",
        [{ name: "page.png", contentType: "image/png", bytes: new TextEncoder().encode("<html>") }],
      ],
      [
        "unsupported_file",
        [{ name: "empty.txt", contentType: "text/plain", bytes: new Uint8Array() }],
      ],
    ] as const;
    for (const [reason, files] of refused) {
      const error = yield* Effect.flip(
        guestShares.submit(session, { shareId, text: "Look" }, yield* uploadsOf(files)),
      );
      assert.equal(error.reason, reason);
    }
    assert.deepEqual(yield* storedFiles, before);
    assert.deepEqual(yield* waitingMessages, []);

    yield* guestShares.submit(
      session,
      { shareId, text: "" },
      yield* uploadsOf([
        png("screen.png"),
        {
          name: "notes\u202Efdp.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<b>"),
        },
      ]),
    );
    const [message] = yield* waitingMessages;
    assert.deepEqual(
      message?.attachments?.map(({ type, name, mimeType, sizeBytes }) => ({
        type,
        name,
        mimeType,
        sizeBytes,
      })),
      [
        { type: "image", name: "screen.png", mimeType: "image/png", sizeBytes: PNG.length },
        { type: "file", name: "notes_fdp.html", mimeType: "text/html", sizeBytes: 3 },
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("caps the bytes of files waiting in one share", () =>
  Effect.gen(function* () {
    const { guestShares, session, shareId } = yield* joinedGuest;
    const submit = (sizeBytes: number) =>
      Effect.gen(function* () {
        return guestShares.submit(
          session,
          { shareId, text: "Look" },
          yield* uploadsOf([png("big.png", sizeBytes)]),
        );
      }).pipe(Effect.flatten);
    yield* submit(9 * MIB);
    yield* submit(9 * MIB);
    const error = yield* Effect.flip(submit(9 * MIB));
    assert.equal(error.reason, "files_busy");
    yield* guestShares.submit(session, { shareId, text: "One more thing" }, []);
    assert.equal((yield* waitingMessages).length, 3);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("deletes a waiting message's files when the owner dismisses it or stops sharing", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* guestShares.submit(
      session,
      { shareId, text: "First" },
      yield* uploadsOf([png("a.png")]),
    );
    yield* guestShares.submit(
      session,
      { shareId, text: "Second" },
      yield* uploadsOf([png("b.png")]),
    );
    const [first, second] = yield* waitingMessages;
    const fileOf = (message: typeof first) => message!.attachments![0]!.id;
    const stored = yield* storedFiles;
    assert.isTrue(stored.some((entry) => entry.startsWith(fileOf(first))));

    yield* orchestrator.dispatch({
      type: "thread.guest-message.dismiss",
      commandId: CommandId.make("dismiss-first"),
      threadId,
      guestMessageId: first!.id,
    });
    yield* worker.drain();
    const afterDismiss = yield* storedFiles;
    assert.isFalse(afterDismiss.some((entry) => entry.startsWith(fileOf(first))));
    assert.isTrue(afterDismiss.some((entry) => entry.startsWith(fileOf(second))));
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(guestShares.attachment(session, fileOf(first)))),
    );

    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-with-files"),
      threadId,
    });
    yield* worker.drain();
    assert.isFalse((yield* storedFiles).some((entry) => entry.startsWith(fileOf(second))));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect.each(["thread.archive", "thread.delete"] as const)(
  "deletes a waiting message's files on %s",
  (type) =>
    Effect.gen(function* () {
      const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const before = yield* storedFiles;
      yield* guestShares.submit(
        session,
        { shareId, text: "Look" },
        yield* uploadsOf([png("a.png")]),
      );
      assert.equal((yield* storedFiles).length, before.length + 1);
      yield* orchestrator.dispatch({
        type,
        commandId: CommandId.make(`${type}-with-files`),
        threadId,
      });
      yield* worker.drain();
      assert.deepEqual(yield* storedFiles, before);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("sends a guest's files as the guest's message and keeps them the guest's to load", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    yield* guestShares.submit(
      session,
      { shareId, text: "See this" },
      yield* uploadsOf([png("a.png")]),
    );
    const [message] = yield* waitingMessages;
    const pending = message!.attachments!;
    const served = yield* guestShares.attachment(session, pending[0]!.id);
    assert.equal(served.attachment.mimeType, "image/png");
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    sweepStalePendingAttachments({ attachmentsDir, nowMs: Number.MAX_SAFE_INTEGER });
    const copied = pending[0]!;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send-guest-files"),
      threadId,
      messageId: MessageId.make("message:guest-files"),
      guestMessageId: message!.id,
      text: "",
      attachments: [copied],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const items = (yield* orchestrator.getThreadSnapshotWindow(threadId, {
      rowLimit: 20,
    })).projection.visibleTurnItems.map((entry) => entry.item);
    const sent = items.find(
      (item) => item.type === "user_message" && item.context?.guest?.guestMessageId === message!.id,
    );
    assert.deepInclude(sent, { attachments: [copied] });
    if (sent?.type !== "user_message") return;
    assert.deepEqual(sent.context?.guest, {
      guestMessageId: message!.id,
      name: "Sam",
      text: "See this",
      shareId,
    });
    const fromRow = yield* guestShares.attachment(session, copied.id);
    assert.equal(fromRow.attachment.id, copied.id);
    for (let index = 0; index < 21; index += 1) {
      yield* guestShares.submit(session, { shareId, text: `note ${index}` }, []);
      const waiting = (yield* waitingMessages).find((next) => next.status === "pending");
      yield* orchestrator.dispatch({
        type: "thread.guest-message.dismiss",
        commandId: CommandId.make(`dismiss-note-${index}`),
        threadId,
        guestMessageId: waiting!.id,
      });
    }
    assert.isFalse((yield* waitingMessages).some((next) => next.id === message!.id));
    assert.equal((yield* guestShares.attachment(session, copied.id)).attachment.id, copied.id);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("serves the shared thread's files to its guest, never another thread's", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    const other = yield* shareThreadFor(ThreadId.make("thread:other-share"));
    const otherGuest = yield* guestShares.redeem({ credential: other.credential, name: "Eve" });
    yield* guestShares.submit(
      otherGuest.token,
      { shareId: otherGuest.shareId, text: "Mine" },
      yield* uploadsOf([png("eve.png")]),
    );
    const { thread: otherThread } = yield* orchestrator.getThreadRecords(
      ThreadId.make("thread:other-share"),
      [],
    );
    const othersFile = otherThread.guestShare!.messages[0]!.attachments![0]!.id;
    assert.isTrue(
      Exit.isSuccess(yield* Effect.exit(guestShares.attachment(otherGuest.token, othersFile))),
    );
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const ownerImage = {
      type: "image" as const,
      id: ChatAttachmentId.make(createAttachmentId(threadId)!),
      name: "secret.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    };
    yield* fileSystem.writeFile(
      resolveAttachmentPath({ attachmentsDir, attachment: ownerImage })!,
      PNG,
    );
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-image"),
      threadId,
      messageId: MessageId.make("message:owner-image"),
      text: "My screen",
      attachments: [ownerImage],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    assert.equal(
      (yield* guestShares.attachment(session, ownerImage.id)).attachment.id,
      ownerImage.id,
    );
    for (const id of [othersFile, "pending-missing"]) {
      const error = yield* Effect.flip(guestShares.attachment(session, id));
      assert.equal(error.reason, "unavailable");
    }
    assert.equal(
      (yield* Effect.flip(
        guestShares.submit(session, { shareId: otherGuest.shareId, text: "x" }, []),
      )).reason,
      "stale_page",
    );
    assert.isDefined(shareId);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("serves an image on the host only when an agent reply the guest sees shows it", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares } = yield* shareThread;
    const runId = yield* ownerRun;
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const shot = `${directory}/my shot.png`;
    const fileUrl = `${directory}/file-url.png`;
    const page = `${directory}/page.png`;
    const fromUser = `${directory}/from-user.png`;
    const unnamed = `${directory}/unnamed.png`;
    const later = `${directory}/later.png`;
    for (const path of [shot, fileUrl, fromUser, unnamed, later]) {
      yield* fileSystem.writeFile(path, PNG);
    }
    yield* fileSystem.writeFileString(page, "<script>alert(1)</script>");
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const run = (yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs[0];
    const item = (
      id: string,
      ordinal: number,
      fields:
        | { readonly type: "assistant_message"; readonly text: string }
        | { readonly type: "user_message"; readonly text: string },
      target: { readonly threadId: ThreadId; readonly runId: RunId } = { threadId, runId },
    ) => ({
      id: EventId.make(`event:${id}`),
      type: "turn-item.updated" as const,
      threadId: target.threadId,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: instanceId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make(id),
        threadId: target.threadId,
        runId: target.runId,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal,
        title: null,
        status: "completed" as const,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        messageId: MessageId.make(id),
        ...(fields.type === "assistant_message"
          ? { ...fields, streaming: false }
          : {
              ...fields,
              createdBy: "user" as const,
              creationSource: "web" as const,
              inputIntent: "turn_start" as const,
              attachments: [],
            }),
      },
    });
    yield* eventSink.write({
      events: [
        item("item:agent-images", 1, {
          type: "assistant_message",
          text: `Done: ![Shot](<${shot}>) ![Other](file://${encodeURI(fileUrl)}) ![Page](${page})`,
        }),
        item("item:guest-image", 2, { type: "user_message", text: `![Mine](${fromUser})` }),
        {
          id: EventId.make("event:run-done"),
          type: "run.updated" as const,
          threadId,
          runId,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: { ...run!, status: "completed" as const, completedAt: now },
        },
      ],
    });
    const forkId = ThreadId.make("thread:guest-share-fork");
    yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make("fork"),
      sourceThreadId: threadId,
      targetThreadId: forkId,
      sourcePoint: { type: "run", runId },
      createdBy: "user",
      creationSource: "web",
    });
    const { url } = yield* guestShares.create({ threadId: forkId, guestPageUrl: GUEST_PAGE_URL });
    const { token: session } = yield* guestShares.redeem({
      credential: credentialFromUrl(url),
      name: "Sam",
    });
    const sent = yield* Queue.unbounded<GuestStreamEvent>();
    yield* Stream.runForEach(yield* guestShares.stream(session), (event) =>
      Queue.offer(sent, event),
    ).pipe(Effect.forkScoped);
    const sentItem = Effect.fn(function* (id: string) {
      for (;;) {
        const event = yield* Queue.take(sent);
        if (
          event.type === "thread" &&
          event.item.kind === "event" &&
          event.item.event.type === "turn-item.updated" &&
          event.item.event.payload.id === id
        ) {
          return;
        }
      }
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("fork-message"),
      threadId: forkId,
      messageId: MessageId.make("message:fork"),
      text: "One more",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const forkRun = (yield* orchestrator.getThreadRecords(forkId, ["runs"])).runs.at(-1)!;
    const inFork = { threadId: forkId, runId: forkRun.id };
    yield* eventSink.write({
      events: [
        item(
          "item:later-image",
          1,
          { type: "assistant_message", text: `![Later](${later})` },
          inFork,
        ),
        ...Array.from({ length: 600 }, (_, index) =>
          item(
            `item:filler-${index}`,
            index + 2,
            { type: "assistant_message", text: "Working." },
            inFork,
          ),
        ),
      ],
    });
    yield* sentItem("item:later-image");
    for (const path of [shot, fileUrl, later]) {
      assert.deepStrictEqual(yield* guestShares.media(session, path), {
        path,
        mimeType: "image/png",
      });
    }
    for (const path of [page, fromUser, unnamed, `${directory}/missing.png`]) {
      assert.equal((yield* Effect.flip(guestShares.media(session, path))).reason, "unavailable");
    }
    yield* eventSink.write({
      events: [
        {
          ...item("item:later-image", 1, { type: "assistant_message", text: "Gone." }, inFork),
          id: EventId.make("event:later-image-edited"),
        },
      ],
    });
    yield* sentItem("item:later-image");
    assert.equal((yield* Effect.flip(guestShares.media(session, later))).reason, "unavailable");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("keeps a connected guest's images while other shares come and go", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const shot = `${directory}/shot.png`;
    yield* fileSystem.writeFile(shot, PNG);
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const sharedWithImage = Effect.fn(function* (id: ThreadId) {
      const { orchestrator, guestShares, credential } = yield* shareThreadFor(id);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`message:${id}`),
        threadId: id,
        messageId: MessageId.make(`message:${id}`),
        text: "Show me",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      const runId = (yield* orchestrator.getThreadRecords(id, ["runs"])).runs[0]!.id;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make(`event:reply:${id}`),
            type: "turn-item.updated",
            threadId: id,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: instanceId,
            occurredAt: now,
            payload: {
              id: TurnItemId.make(`item:reply:${id}`),
              threadId: id,
              runId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 1,
              title: null,
              status: "completed",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              type: "assistant_message",
              messageId: MessageId.make(`item:reply:${id}`),
              text: `![Shot](${shot})`,
              streaming: false,
            },
          },
        ],
      });
      const { token } = yield* guestShares.redeem({ credential, name: "Sam" });
      return { guestShares, token };
    });
    const { guestShares, token } = yield* sharedWithImage(threadId);
    const opened = yield* Deferred.make<void>();
    yield* Stream.runForEach(yield* guestShares.stream(token), () =>
      Deferred.succeed(opened, undefined),
    ).pipe(Effect.forkScoped);
    yield* Deferred.await(opened);
    const closedTokens: Array<string> = [];
    for (let index = 0; index < 65; index++) {
      const other = yield* sharedWithImage(ThreadId.make(`thread:other-${index}`));
      const events = yield* guestShares.stream(other.token);
      if (index > 0) yield* Stream.runDrain(Stream.take(events, 2));
      closedTokens.push(other.token);
    }
    assert.equal((yield* guestShares.media(token, shot)).mimeType, "image/png");
    for (const closed of closedTokens.slice(0, 2)) {
      assert.equal((yield* Effect.flip(guestShares.media(closed, shot))).reason, "unavailable");
    }
    const { url } = yield* guestShares.create({ threadId, guestPageUrl: GUEST_PAGE_URL });
    const next = yield* guestShares.redeem({
      credential: credentialFromUrl(url),
      name: "Kim",
    });
    assert.equal((yield* Effect.flip(guestShares.media(next.token, shot))).reason, "unavailable");
    yield* Stream.runDrain(Stream.take(yield* guestShares.stream(next.token), 2));
    assert.equal((yield* guestShares.media(next.token, shot)).mimeType, "image/png");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("joins and submits through the encrypted guest HTTP transport", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const http = yield* HttpRouter.toHttpEffect(GuestHttp.layer);
    const handler = yield* NodeHttpServer.makeHandler(http, { scope: yield* Effect.scope });
    const server = NodeHttp.createServer(handler);
    const secret = NodeCrypto.randomBytes(32);
    const handshake = createClientHandshake(relayPublicKey(secret), NodeCrypto.randomBytes);
    const accepted = acceptClientHandshake(handshake.hello, secret, NodeCrypto.randomBytes);
    const host = createTunnelSession({
      initiator: false,
      cipher: accepted.cipher,
      send: (bytes) => queueMicrotask(() => client.receive(bytes)),
      onStream: (stream) => server.emit("connection", new TunnelSocket(stream)),
    });
    const client = createTunnelSession({
      initiator: true,
      cipher: handshake.finish(accepted.welcome),
      send: (bytes) => queueMicrotask(() => host.receive(bytes)),
    });
    const transport = createGuestTransport(
      { address: relayHttpBaseUrl(relayPublicKey(secret)), relayUrl: "wss://relay.example" },
      null,
      () => ({
        open: async () => client.open(),
        session: async () => client,
        close: () => {
          client.close();
          host.close();
        },
      }),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        transport.close();
        server.close();
      }),
    );
    const joined = yield* Effect.promise(async () => {
      assert.equal((await transport.request("/api/guest/session?share=fixture")).status, 403);
      const response = await transport.request("/api/guest/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, name: "Local verification guest" }),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as { token: string; shareId: string };
    });
    transport.setToken(joined.token);
    yield* guestShares.check(joined.token);
    const failedEdit = yield* writeItem("item:failed-http-edit", {
      type: "file_change",
      status: "failed",
      fileName: "src/private.ts",
      diffStr: "-private-before\n+private-after\n",
      oldStr: "private-before",
      newStr: "private-after",
    });
    yield* Effect.promise(async () => {
      const detailResponse = await transport.request(
        `/api/guest/item?share=${joined.shareId}&item=${failedEdit}`,
      );
      assert.equal(detailResponse.status, 200);
      const detail = (await detailResponse.json()) as { item: unknown };
      assert.doesNotHaveAnyKeys(detail.item, ["diffStr", "oldStr", "newStr"]);
      assert.equal(
        (await transport.request(`/api/guest/session?share=${joined.shareId}`)).status,
        204,
      );
      const response = await transport.request(`/api/guest/messages?share=${joined.shareId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId: joined.shareId, text: "Please review this." }),
      });
      assert.equal(response.status, 204);
    });
    const [opening] = yield* (yield* guestShares.stream(joined.token)).pipe(
      Stream.take(1),
      Stream.runCollect,
    );
    if (opening?.type !== "view") return assert.fail("Expected the shared thread view.");
    assert.equal(opening.view.guestName, "Local verification guest");
    assert.deepInclude(opening.view.messages[0], {
      text: "Please review this.",
      status: "pending",
    });
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(layerTest, NodeHttpServer.layerHttpServices)),
  ),
);
