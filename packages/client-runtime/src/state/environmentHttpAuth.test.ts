import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  ProjectId,
  type AuthSessionState,
  type OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadDetailSnapshot,
  OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadTranscript,
  type OrchestrationV2ThreadHistoryPage,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import type { HttpClient } from "effect/http";

import {
  BearerConnectionTarget,
  type PreparedConnection,
  type PreparedHttpAuthorization,
} from "../connection/model.ts";
import { layerRemoteHttpClient, type RemoteEnvironmentRequestError } from "../rpc/http.ts";
import * as PullRequestDiffLoader from "./pullRequestDiffHttp.ts";
import { withOrchestrationProtocolHeader } from "./environmentHttpAuth.ts";
import { fetchEnvironmentSessionState } from "./session.ts";
import { fetchEnvironmentShellSnapshot } from "./shellSnapshotHttp.ts";
import * as ThreadSnapshotLoader from "./threadSnapshotHttp.ts";
import { fetchEnvironmentThreadTranscript } from "./threadTranscriptHttp.ts";
import { fetchEnvironmentBoundedThreadSnapshot } from "./boundedThreadSnapshotHttp.ts";

import { fetchEnvironmentThreadHistoryPage } from "./threadHistoryHttp.ts";
import { v2Projection } from "./orchestrationV2TestFixtures.ts";

const encodeThreadSnapshot = Schema.encodeSync(OrchestrationV2ThreadDetailSnapshot);
const encodeBoundedSnapshot = Schema.encodeSync(OrchestrationV2ThreadBoundedSnapshot);
const encodeThreadTranscript = Schema.encodeSync(OrchestrationV2ThreadTranscript);

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});
const ORIGIN = "https://remote.example.test";
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: ORIGIN,
  socketUrl: "wss://remote.example.test/ws",
  httpAuthorization: { _tag: "Bearer", token: "bearer-token" },
  target: TARGET,
};
const DIFF = {
  projectId: ProjectId.make("project-1"),
  repository: "owner/repository",
  number: 42,
};
const DIFF_RESULT = { patch: "diff --git a/file.ts b/file.ts", truncated: false, nextCursor: null };
const AUTH = {
  policy: "remote-reachable",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["bearer-access-token"],
  sessionCookieName: "supaterm_session",
} satisfies AuthSessionState["auth"];
const SESSION = {
  authenticated: true,
  auth: AUTH,
  scopes: ["orchestration:read", "orchestration:operate"],
  sessionMethod: "bearer-access-token",
} satisfies AuthSessionState;
const UNAUTHENTICATED_SESSION = { authenticated: false, auth: AUTH } satisfies AuthSessionState;
const SHELL = {
  schemaVersion: 1,
  snapshotSequence: 1,
  projects: [],
  threads: [],
  archivedThreads: [],
} satisfies OrchestrationV2ShellSnapshot;
const THREAD = {
  snapshotSequence: 2,
  projection: v2Projection,
} satisfies OrchestrationV2ThreadDetailSnapshot;
const TRANSCRIPT = {
  threadId: v2Projection.thread.id,
  title: v2Projection.thread.title,
  updatedAt: v2Projection.updatedAt,
  items: v2Projection.visibleTurnItems,
} satisfies OrchestrationV2ThreadTranscript;
const BOUNDED_THREAD = {
  ...THREAD,
  historyCursor: "older-page",
  hasMoreHistory: true,
  latestLocalTurnOrdinal: 3,
} satisfies OrchestrationV2ThreadBoundedSnapshot;
const THREAD_HISTORY = {
  snapshotSequence: 2,
  items: [],
  nextCursor: null,
  hasMoreHistory: false,
} satisfies OrchestrationV2ThreadHistoryPage;

function makeHarness(reply: (requestNumber: number) => Response | Promise<Response>) {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const fetchFn: typeof fetch = async (request, init) => {
    calls.push({ url: String(request), init: init ?? {} });
    return reply(calls.length);
  };
  return {
    calls,
    input: { prepared: PREPARED },
    layerHttp: layerRemoteHttpClient(fetchFn),
  };
}

type HttpInput = ReturnType<typeof makeHarness>["input"];
const LOADERS: ReadonlyArray<{
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly response: unknown;
  readonly expected: unknown;
  readonly load: (
    input: HttpInput,
  ) => Effect.Effect<
    unknown,
    RemoteEnvironmentRequestError | PullRequestDiffLoader.PullRequestDiffCredentialRejectedError,
    HttpClient.HttpClient
  >;
}> = [
  {
    name: "PR diff",
    method: "POST",
    path: "/api/pull-requests/diff",
    response: DIFF_RESULT,
    expected: DIFF_RESULT,
    load: (input: HttpInput) =>
      PullRequestDiffLoader.fetchEnvironmentPullRequestDiff({ ...input, diff: DIFF }),
  },
  {
    name: "session permissions",
    method: "GET",
    path: "/api/auth/session",
    response: SESSION,
    expected: SESSION,
    load: fetchEnvironmentSessionState,
  },
  {
    name: "shell snapshot",
    method: "GET",
    path: "/api/orchestration/shell",
    response: SHELL,
    expected: SHELL,

    load: (input: HttpInput) =>
      fetchEnvironmentShellSnapshot(input).pipe(
        Effect.map(({ loadPullRequests: _links, ...snapshot }) => snapshot),
      ),
  },
  {
    name: "thread snapshot",
    method: "GET",
    path: `/api/orchestration/threads/${THREAD.projection.thread.id}`,
    response: encodeThreadSnapshot(THREAD),
    expected: THREAD,
    load: (input: HttpInput) =>
      ThreadSnapshotLoader.fetchEnvironmentThreadSnapshot({
        ...input,
        threadId: THREAD.projection.thread.id,
      }),
  },
  {
    name: "thread transcript",
    method: "GET",
    path: `/api/orchestration/threads/${TRANSCRIPT.threadId}/transcript`,
    response: encodeThreadTranscript(TRANSCRIPT),
    expected: TRANSCRIPT,
    load: (input: HttpInput) =>
      fetchEnvironmentThreadTranscript({ ...input, threadId: TRANSCRIPT.threadId }),
  },
  {
    name: "bounded thread snapshot",
    method: "GET",
    path: `/api/orchestration/threads/${THREAD.projection.thread.id}/bounded`,
    response: encodeBoundedSnapshot(BOUNDED_THREAD),
    expected: BOUNDED_THREAD,
    load: (input: HttpInput) =>
      fetchEnvironmentBoundedThreadSnapshot({ ...input, threadId: THREAD.projection.thread.id }),
  },
  {
    name: "older thread history",
    method: "GET",
    path: `/api/orchestration/threads/${THREAD.projection.thread.id}/history`,
    response: THREAD_HISTORY,
    expected: THREAD_HISTORY,
    load: (input: HttpInput) =>
      fetchEnvironmentThreadHistoryPage({
        ...input,
        threadId: THREAD.projection.thread.id,
        cursor: "older-page",
      }),
  },
];

describe("authenticated environment HTTP requests", () => {
  it.effect.each(["http://192.168.1.20:4389", "https://remote.example.ts.net"])(
    "uses the learned route origin %s for authenticated HTTP reads",
    (origin) =>
      Effect.gen(function* () {
        const harness = makeHarness(() => Response.json(SHELL));
        const prepared: PreparedConnection = {
          ...PREPARED,
          target: new BearerConnectionTarget({
            ...TARGET,
            connectionId: `learned:${TARGET.environmentId}:${origin}@connection-1`,
          }),
          httpBaseUrl: origin,
          socketUrl: `${origin.replace(/^http/, "ws")}/ws`,
        };
        yield* fetchEnvironmentShellSnapshot({ prepared }).pipe(Effect.provide(harness.layerHttp));
        expect(harness.calls).toHaveLength(1);
        expect(harness.calls[0]!.url).toBe(`${origin}/api/orchestration/shell`);
        expect(new Headers(harness.calls[0]!.init.headers).get("authorization")).toBe(
          "Bearer bearer-token",
        );
      }),
  );

  it.effect.each(LOADERS)("rejects an invalid $name response", (loader) =>
    Effect.gen(function* () {
      const harness = makeHarness(() => Response.json({}));
      const result = yield* loader
        .load(harness.input)
        .pipe(Effect.provide(harness.layerHttp), Effect.asVoid, Effect.flip);
      expect(result._tag).toBe("RemoteEnvironmentAuthInvalidJsonError");
      expect(harness.calls).toHaveLength(1);
    }),
  );

  it.effect.each(LOADERS)(
    "sends the bearer credential to the prepared endpoint for $name",
    (loader) =>
      Effect.gen(function* () {
        const harness = makeHarness(() => Response.json(loader.response));
        const result = yield* loader.load(harness.input).pipe(Effect.provide(harness.layerHttp));

        expect(result).toEqual(loader.response);
        expect(harness.calls).toHaveLength(1);
        const call = harness.calls[0]!;
        const url = new URL(call.url);
        expect(url.origin).toBe(ORIGIN);
        expect(url.pathname).toBe(loader.path);
        expect(call.init.method).toBe(loader.method);
        expect(new Headers(call.init.headers).get("authorization")).toBe("Bearer bearer-token");
        expect(call.init.credentials).toBeUndefined();
        if (loader.name === "older thread history") {
          expect(url.searchParams.get("cursor")).toBe("older-page");
        }
      }),
  );

  it.effect.each([
    { name: "cookie", authorization: null },
    { name: "bearer", authorization: { _tag: "Bearer", token: "bearer-token" } },
  ] satisfies ReadonlyArray<{ name: string; authorization: PreparedHttpAuthorization | null }>)(
    "returns an unauthenticated $name session as-is",
    ({ authorization }) =>
      Effect.gen(function* () {
        const harness = makeHarness(() => Response.json(UNAUTHENTICATED_SESSION));
        const result = yield* fetchEnvironmentSessionState({
          prepared: { ...PREPARED, httpAuthorization: authorization },
        }).pipe(Effect.provide(harness.layerHttp));

        expect(result).toEqual(UNAUTHENTICATED_SESSION);
        expect(harness.calls).toHaveLength(1);
        expect(new Headers(harness.calls[0]!.init.headers).get("authorization")).toBe(
          authorization === null ? null : "Bearer bearer-token",
        );
        expect(harness.calls[0]!.init.credentials).toBe(
          authorization === null ? "include" : undefined,
        );
      }),
  );

  it.effect("reports the request URL when the caller's timeout expires", () =>
    Effect.gen(function* () {
      const requested = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Response>();
      const harness = makeHarness(() => {
        requested.resolve();
        return response.promise;
      });
      const pending = yield* fetchEnvironmentSessionState({
        ...harness.input,
        timeoutMs: 100,
      }).pipe(Effect.provide(harness.layerHttp), Effect.flip, Effect.forkChild);
      yield* Effect.promise(() => requested.promise);
      yield* TestClock.adjust(100);

      expect(yield* Fiber.join(pending)).toMatchObject({
        _tag: "RemoteEnvironmentAuthTimeoutError",
        requestUrl: `${ORIGIN}/api/auth/session`,
        timeoutMs: 100,
      });
      response.resolve(Response.json(SESSION));
    }),
  );
});

describe("orchestration HTTP compatibility header", () => {
  it("announces the current protocol without replacing bearer authentication", () => {
    expect(
      withOrchestrationProtocolHeader({
        authorization: "Bearer access-token",
      }),
    ).toEqual({
      authorization: "Bearer access-token",
      [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
    });
  });
});
