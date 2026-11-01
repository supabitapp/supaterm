#!/usr/bin/env node
// Writes the database scripts/smoke-desktop-app.ts opens: one project and two threads, through
// the server's own event sink. Commit the result and keep it: packaged builds must migrate it
// forward as they do for upgrading users, so do not regenerate it on schema changes.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../src/orchestration-v2/EventSink.ts";
import * as EventStore from "../src/orchestration-v2/EventStore.ts";
import { planProjectCommand } from "../src/orchestration-v2/ProjectCommands.ts";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../src/persistence/Sqlite.ts";

const CREATED_AT = DateTime.makeUnsafe("2026-10-31T10:00:00.000Z");
const ANSWERED_AT = DateTime.makeUnsafe("2026-10-31T10:01:00.000Z");
const PROJECT_ID = ProjectId.make("launch-check-project");
const PROVIDER_INSTANCE_ID = ProviderInstanceId.make("codex");

const threadEvents = (input: {
  readonly id: string;
  readonly title: string;
  readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>;
}): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const threadId = ThreadId.make(input.id);
  const updatedAt = input.messages.length > 1 ? ANSWERED_AT : CREATED_AT;
  return [
    {
      id: EventId.make(`${input.id}:created`),
      type: "thread.created",
      threadId,
      providerInstanceId: PROVIDER_INSTANCE_ID,
      occurredAt: CREATED_AT,
      payload: {
        createdBy: "user",
        creationSource: "server",
        id: threadId,
        projectId: PROJECT_ID,
        title: input.title,
        providerInstanceId: PROVIDER_INSTANCE_ID,
        modelSelection: { instanceId: PROVIDER_INSTANCE_ID, model: DEFAULT_MODEL },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        branchPullRequest: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: CREATED_AT,
        updatedAt,
        archivedAt: null,
        doneOverride: null,
        doneAt: null,
        autoMarkDoneDisabledAt: CREATED_AT,
        lastVisitedAt: null,
        deletedAt: null,
      },
    },
    ...input.messages.flatMap(
      ({ role, text }, index): ReadonlyArray<OrchestrationV2DomainEvent> => {
        const at = index === 0 ? CREATED_AT : ANSWERED_AT;
        const messageId = MessageId.make(`${input.id}:message:${index}`);
        const item = {
          id: TurnItemId.make(`${input.id}:turn-item:${index}`),
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: index + 1,
          status: "completed",
          title: null,
          startedAt: at,
          completedAt: at,
          updatedAt: at,
          messageId,
          text,
          attachments: [],
        } as const;
        return [
          {
            id: EventId.make(`${input.id}:message:${index}`),
            type: "message.updated",
            threadId,
            occurredAt: at,
            payload: {
              createdBy: role === "user" ? "user" : "agent",
              creationSource: "server",
              id: messageId,
              threadId,
              runId: null,
              nodeId: null,
              role,
              text,
              attachments: [],
              streaming: false,
              createdAt: at,
              updatedAt: at,
            },
          },
          {
            id: EventId.make(`${input.id}:turn-item:${index}`),
            type: "turn-item.updated",
            threadId,
            occurredAt: at,
            payload:
              role === "user"
                ? {
                    ...item,
                    createdBy: "user",
                    creationSource: "server",
                    type: "user_message",
                    inputIntent: "turn_start",
                  }
                : { ...item, type: "assistant_message", streaming: false },
          },
        ];
      },
    ),
  ];
};

const seed = Effect.gen(function* () {
  const eventSink = yield* EventSink.EventSinkV2;
  const commandId = CommandId.make("launch-check-project:create");
  const project = planProjectCommand({
    command: {
      type: "project.create",
      commandId,
      projectId: PROJECT_ID,
      title: "Launch Check",
      workspaceRoot: "/tmp/supaterm-launch-check-workspace",
    },
    state: { project: undefined, workspaceOwner: undefined },
    eventId: EventId.make("launch-check-project:created"),
    now: CREATED_AT,
  });
  if (Result.isFailure(project)) return yield* Effect.die(project.failure);
  yield* eventSink.commitProjectCommand({
    commandId,
    projectId: PROJECT_ID,
    commandType: "project.create",
    acceptedAt: CREATED_AT,
    event: project.success,
  });
  yield* eventSink.write({
    events: [
      ...threadEvents({
        id: "launch-check-other",
        title: "Second thread",
        messages: [{ role: "user", text: "A second thread so the sidebar has a list." }],
      }),
      ...threadEvents({
        id: "launch-check-thread",
        title: "Release launch check",
        messages: [
          { role: "user", text: "Does the release open?" },
          { role: "assistant", text: "The release opens and shows this thread." },
        ],
      }),
    ],
  });
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const output = path.resolve(
    import.meta.dirname,
    "../../../scripts/fixtures/desktop-launch/statev2.sqlite",
  );
  yield* seed;
  yield* fs.makeDirectory(path.dirname(output), { recursive: true });
  yield* fs.remove(output, { force: true });
  const sql = yield* SqlClient.SqlClient;
  yield* sql`VACUUM INTO ${output}`;
  yield* Effect.log(`Wrote ${output}`);
});

const layer = EventSink.layer.pipe(
  Layer.provideMerge(Layer.merge(EventStore.layer, ProjectionStore.layer)),
  Layer.provideMerge(Layer.merge(SqlitePersistence.layerMemory, NodeServices.layer)),
);

program.pipe(Effect.provide(layer), NodeRuntime.runMain);
