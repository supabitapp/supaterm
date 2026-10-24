import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  type AuthSessionId,
  type ClientActivityLease,
  EnvironmentId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import { DEFAULT_PUSH_KINDS, type PushRegisterInput } from "@supaterm/contracts/push";
import { pushHpkeSuite } from "@supaterm/shared/push/envelope";
import { encodeBase64 } from "@supaterm/shared/relay/protocol";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as PushAttention from "../PushAttention.ts";
import * as PushCandidateReactor from "../PushCandidateReactor.ts";
import * as PushDeliveryWorker from "../PushDeliveryWorker.ts";
import * as PushGatewayClient from "../PushGatewayClient.ts";
import * as PushIdentity from "../PushIdentity.ts";
import * as PushNotifications from "../PushNotifications.ts";
import * as PushRegistrations from "../PushRegistrations.ts";

export const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
export const GATEWAY_ORIGIN = "http://127.0.0.1:8787";
export const PROJECT_TITLE = "Supaterm";
const providerInstanceId = ProviderInstanceId.make("codex");

export interface GatewayCall {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GatewayReply {
  readonly status: number;
  readonly headers?: Record<string, string>;
}

export function threadShell(
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  const now = DateTime.makeUnsafe("2026-10-21T00:00:00.000Z");
  const threadId = ThreadId.make(id);
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: `Thread ${id}`,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: RunId.make(`${id}-run-1`),
    activeRunId: null,
    status: "running",
    activityRunStatus: "running",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 1,
    visibleItemCount: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

/** Builds a stored event from the few fields the push pipeline reads. */
function storedEvent(
  sequence: number,
  event: {
    readonly type: OrchestrationV2DomainEvent["type"];
    readonly threadId: string;
    readonly occurredAt: DateTime.Utc;
    readonly payload: Record<string, unknown>;
  },
  commandId: string | null = null,
): OrchestrationV2StoredEvent {
  return { sequence, commandId, event } as unknown as OrchestrationV2StoredEvent;
}

export const recipientKeyPair = Effect.promise(async () => {
  const pair = await pushHpkeSuite.kem.generateKeyPair();
  return {
    publicKey: encodeBase64(
      new Uint8Array(await pushHpkeSuite.kem.serializePublicKey(pair.publicKey)),
    ),
    privateKey: new Uint8Array(await pushHpkeSuite.kem.serializePrivateKey(pair.privateKey)),
  };
});

export function registerInput(
  registrationId: string,
  publicKey: string,
  overrides: Partial<PushRegisterInput> = {},
): PushRegisterInput {
  return {
    registrationId,
    gatewayOrigin: GATEWAY_ORIGIN,
    handle: "aGFuZGxlLWhhbmRsZS0xMg",
    recipientKey: { keyId: "0b9f8e7d-6c5b-4a39-8281-7f6e5d4c3b2a", publicKey },
    preview: "titles",
    kinds: DEFAULT_PUSH_KINDS,
    deviceName: "Phone",
    ...overrides,
  };
}

export const insertSession = Effect.fn("pushWorld.insertSession")(function* (
  sessionId: AuthSessionId,
  options: { readonly revoked?: boolean; readonly label?: string } = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* DateTime.now;
  yield* sql`
    INSERT INTO auth_sessions (
      session_id, subject, scopes, method, client_label, issued_at, expires_at, revoked_at
    )
    VALUES (
      ${sessionId}, 'subject', '[]', 'bearer-access-token', ${options.label ?? null},
      ${DateTime.formatIso(now)}, ${DateTime.formatIso(DateTime.add(now, { days: 30 }))},
      ${options.revoked === true ? DateTime.formatIso(now) : null}
    )
  `;
});

const makePushWorld = Effect.gen(function* () {
  const shells = yield* Ref.make(new Map<ThreadId, OrchestrationV2ThreadShell>());
  const subagents = yield* Ref.make(new Map<ThreadId, ReadonlyArray<OrchestrationV2Subagent>>());
  const runtimeRequests = yield* Ref.make(new Map<string, OrchestrationV2RuntimeRequest>());
  const turnItems = yield* Ref.make(new Map<ThreadId, ReadonlyArray<OrchestrationV2TurnItem>>());
  const messages = yield* Ref.make(
    new Map<ThreadId, ReadonlyArray<OrchestrationV2ConversationMessage>>(),
  );
  const events = yield* Ref.make<ReadonlyArray<OrchestrationV2StoredEvent>>([]);
  const leases = yield* Ref.make<ReadonlyArray<ClientActivityLease>>([]);
  const gatewayCalls = yield* Queue.unbounded<GatewayCall>();
  const sessionChanges = yield* Queue.unbounded<SessionStore.SessionCredentialChange>();
  const gatewayReply = yield* Ref.make<(call: GatewayCall) => GatewayReply>(() => ({
    status: 200,
  }));
  const secrets = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  const httpClient = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const body =
        request.body._tag === "Uint8Array"
          ? decoder.decode(request.body.body)
          : request.body._tag === "Raw"
            ? String(request.body.body)
            : "";
      const call: GatewayCall = { method: request.method, url, headers: request.headers, body };
      const reply = (yield* Ref.get(gatewayReply))(call);
      yield* Queue.offer(gatewayCalls, call);
      return HttpClientResponse.fromWeb(
        request,
        new Response(null, { status: reply.status, headers: reply.headers ?? {} }),
      );
    }),
  );

  const services = Layer.mergeAll(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (threadId) =>
        Ref.get(shells).pipe(Effect.map((map) => map.get(threadId) ?? null)),
      getThreadRecords: (threadId, _fields, filter) =>
        Effect.gen(function* () {
          const children = (yield* Ref.get(subagents)).get(threadId) ?? [];
          const items = ((yield* Ref.get(turnItems)).get(threadId) ?? []).filter(
            (item) =>
              filter?.turnItemTypes === undefined || filter.turnItemTypes.includes(item.type),
          );
          const threadMessages = ((yield* Ref.get(messages)).get(threadId) ?? []).filter(
            (message) =>
              (filter?.messageRoles === undefined || filter.messageRoles.includes(message.role)) &&
              (filter?.messageRunIds === undefined ||
                (message.runId !== null && filter.messageRunIds.includes(message.runId))),
          );
          return { subagents: children, turnItems: items, messages: threadMessages } as never;
        }),
      getRuntimeRequest: (_threadId, requestId) =>
        Ref.get(runtimeRequests).pipe(Effect.map((map) => map.get(requestId))),
    }),
    Layer.mock(EventStore.EventStoreV2)({
      read: (input) =>
        Stream.unwrap(
          Ref.get(events).pipe(
            Effect.map((all) =>
              Stream.fromIterable(
                all
                  .filter((stored) => stored.sequence > (input?.afterSequence ?? 0))
                  .slice(0, input?.limit ?? Number.POSITIVE_INFINITY),
              ),
            ),
          ),
        ),
      latestSequence: () => Ref.get(events).pipe(Effect.map((all) => all.at(-1)?.sequence ?? 0)),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.never }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      getShell: (projectId) =>
        Effect.succeedSome({
          id: projectId,
          title: PROJECT_TITLE,
          workspaceRoot: "/workspace/supaterm",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
    }),
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      snapshot: Effect.gen(function* () {
        const now = yield* DateTime.now;
        return {
          hostPower: {} as never,
          leases: (yield* Ref.get(leases)).filter((lease) =>
            DateTime.isGreaterThan(lease.expiresAt, now),
          ),
          activeForegroundLeaseCount: 0,
          activeScopeKeys: [],
          shouldRunOpportunisticWork: false,
          updatedAt: now,
        };
      }),
      streamChanges: Stream.never,
    }),
    Layer.mock(SessionStore.SessionStore)({
      cookieName: "push-test",
      streamChanges: Stream.fromQueue(sessionChanges),
    }),
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      getOrCreateRandom: (name, bytes) =>
        Effect.sync(() => {
          const existing = secrets.get(name);
          if (existing !== undefined) return existing;
          const created = Uint8Array.from(
            { length: bytes },
            (_, index) => name.charCodeAt(index % name.length) ^ index,
          );
          secrets.set(name, created);
          return created;
        }),
    }),
    Layer.succeed(HttpClient.HttpClient, httpClient),
  );

  const putShell = (shell: OrchestrationV2ThreadShell) =>
    Ref.update(shells, (map) => new Map(map).set(shell.id, shell));

  const appendEvent = (event: Parameters<typeof storedEvent>[1], commandId: string | null = null) =>
    Ref.update(events, (all) => [
      ...all,
      storedEvent((all.at(-1)?.sequence ?? 0) + 1, event, commandId),
    ]);

  return {
    shells,
    subagents,
    runtimeRequests,
    turnItems,
    messages,
    events,
    leases,
    gatewayCalls,
    gatewayReply,
    sessionChanges,
    services,
    putShell,
    appendEvent,
  };
});

export type PushWorld = Effect.Success<typeof makePushWorld>;

/** Storage and fakes that survive a simulated restart. */
const layerPushBase = (
  world: PushWorld,
  settings: Parameters<typeof ServerSettings.layerTest>[0],
) =>
  Layer.mergeAll(
    world.services,
    ServerSettings.layerTest({ pushGatewayOrigins: [GATEWAY_ORIGIN], ...settings }),
  ).pipe(Layer.provideMerge(SqlitePersistence.layerMemory), Layer.provideMerge(NodeCrypto.layer));

/** Runs `body` against fresh storage and fakes. Provide `layerPushServices` per server lifetime. */
export const withPushWorld = <A, E, R>(
  body: (world: PushWorld) => Effect.Effect<A, E, R>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) =>
  makePushWorld.pipe(
    Effect.flatMap((world) => body(world).pipe(Effect.provide(layerPushBase(world, settings)))),
  );

/** One server lifetime of the push services. */
export const layerPushServices = Layer.mergeAll(
  PushNotifications.layer,
  PushCandidateReactor.layer,
).pipe(
  Layer.provideMerge(PushDeliveryWorker.layer),
  Layer.provideMerge(Layer.merge(PushGatewayClient.layer, PushAttention.layer)),
  Layer.provideMerge(Layer.merge(PushIdentity.layer, PushRegistrations.layer)),
);
